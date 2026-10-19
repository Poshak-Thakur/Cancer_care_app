const prisma = require('../config/db');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const transporter = require('../config/mailer');
const { isCentralCounsellor } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');
const HttpError = require('../utils/httpError');
const { lockPatientSelf } = require('../services/patientSelfLockService');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');
const { SCOPES } = require('../constants/accessScopes');

// STAFF means the central NGO head/counsellor.
const getUserRoles = async (userId) => {
  const roles = [];

  if (await isCentralCounsellor(userId)) roles.push('STAFF');

  const isPatient = await prisma.patientaccountlink.findFirst({
    where: {
      user_id: userId,
      relationship_type: { in: ['SELF', 'DELEGATE'] },
      consent_status: 'GRANTED',
      revoked_at: null,
    },
  });
  if (isPatient) roles.push('PATIENT');

  // Caregiver = linked to a patient OR registered caregiver profile
  const [isCaregiverLink, hasCaregiverProfile] = await Promise.all([
    prisma.patientcaregiverlink.findFirst({
      where: { caregiver_user_id: userId, consent_status: 'GRANTED', revoked_at: null },
    }),
    prisma.caregiverprofile.findUnique({ where: { user_id: userId } }),
  ]);
  if (isCaregiverLink || hasCaregiverProfile) roles.push('CAREGIVER');

  return roles.length > 0 ? roles : ['NEW_USER'];
};

// ONE definition of "profile completed", used by verify-otp, claim-code, /me and PATCH /profile.
const isProfileCompleted = (user) =>
  Boolean(user && typeof user.full_name === 'string' && user.full_name.trim().length > 0);

// ONE user shape for verify-otp, claim-code, /me and PATCH /profile (never leaks fcm_token).
const USER_SELECT = {
  id: true,
  email: true,
  full_name: true,
  date_of_birth: true,
  avatar_url: true,
  phone_number: true,
  preferred_language: true,
  status: true,
  created_at: true,
  updated_at: true,
  caregiverprofile: true,
};

const buildUserPayload = async (userId) => {
  const user = await prisma.useraccount.findUnique({ where: { id: userId }, select: USER_SELECT });
  if (!user) return null;
  const roles = await getUserRoles(userId);
  return { ...user, roles, is_profile_completed: isProfileCompleted(user) };
};

const generateRefreshToken = async (userId) => {
  const rawString = crypto.randomBytes(32).toString('hex');
  const rawToken = `${userId}.${rawString}`;
  const tokenHash = await argon2.hash(rawString);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await prisma.refreshtoken.create({
    data: { user_id: userId, token_hash: tokenHash, expires_at: expiresAt },
  });
  return rawToken;
};

// ---- OTP & Claim Code input validation ------------------------------------
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OTP_REGEX = /^\d{6}$/;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const CLAIM_CODE_REGEX = /^[0-9A-Z]{8}$/;
const CLAIM_MAX_FAILED_ATTEMPTS = 5;
const CLAIM_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;
const CLAIM_INVALID_MESSAGE = 'Invalid or expired code.';

const normalizeEmail = (value) => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_REGEX.test(email)) return null;
  return email;
};

// ---- PATH A: Standard Email/OTP Login -------------------------------------

exports.requestOtp = async (req, res, next) => {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);
    if (!cleanEmail) {
      return res.status(400).json({ status: 'error', message: 'A valid email address is required.' });
    }

    const lastOtp = await prisma.authotp.findFirst({
      where: { email: cleanEmail },
      orderBy: { created_at: 'desc' },
    });
    if (lastOtp && Date.now() - new Date(lastOtp.created_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
      return res
        .status(429)
        .json({ status: 'error', message: 'Please wait a minute before requesting another code.' });
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await argon2.hash(rawOtp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.authotp.deleteMany({ where: { email: cleanEmail } });
    await prisma.authotp.create({
      data: { email: cleanEmail, otp_hash: otpHash, expires_at: expiresAt },
    });

    try {
      if (typeof transporter.sendOtpEmail === 'function') {
        await transporter.sendOtpEmail(cleanEmail, rawOtp, 'Your Dost Login Code');
      } else {
        await transporter.sendMail({
          from: `"Dost - The cancer care companion" <${process.env.SMTP_USER}>`,
          to: cleanEmail,
          subject: 'Your Dost Login Code',
          text: `Your OTP code is: ${rawOtp}\n\nIt will expire in 10 minutes.`,
        });
      }
      console.log(`[EMAIL SENT] OTP sent to ${cleanEmail}`);
      return res.status(200).json({ status: 'success', message: 'OTP sent successfully.' });
    } catch (err) {
      console.error('[EMAIL ERROR] Failed to send OTP email:', err.message || err);
      // In local development, print the OTP to the terminal if SMTP is blocked/unreachable
      if (process.env.NODE_ENV !== 'production') {
        console.log('\n========================================');
        console.log(`[LOCAL DEV OTP] ${cleanEmail} -> ${rawOtp}`);
        console.log('========================================\n');
        return res.status(200).json({
          status: 'success',
          message: 'OTP generated (check backend terminal in dev mode).',
        });
      }
      return res.status(500).json({
        status: 'error',
        message: 'Failed to send verification email. Please try again later.',
      });
    }
  } catch (error) {
    next(error);
  }
};

exports.verifyOtp = async (req, res, next) => {
  try {
    const cleanEmail = normalizeEmail(req.body?.email);
    const otpInput =
      typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number'
        ? String(req.body.otp).trim()
        : '';
    if (!cleanEmail || !OTP_REGEX.test(otpInput)) {
      return res
        .status(400)
        .json({ status: 'error', message: 'A valid email and a 6-digit OTP are required.' });
    }

    const otpRecord = await prisma.authotp.findFirst({
      where: { email: cleanEmail },
      orderBy: { created_at: 'desc' },
    });

    if (!otpRecord) return res.status(401).json({ status: 'error', message: 'No pending OTP.' });

    if (otpRecord.attempts_count >= 5) {
      await prisma.authotp.delete({ where: { id: otpRecord.id } });
      return res.status(429).json({ status: 'error', message: 'Too many failed attempts.' });
    }

    if (new Date() > otpRecord.expires_at) {
      await prisma.authotp.delete({ where: { id: otpRecord.id } });
      return res.status(401).json({ status: 'error', message: 'OTP expired.' });
    }

    const isValid = await argon2.verify(otpRecord.otp_hash, otpInput);
    if (!isValid) {
      await prisma.authotp.update({
        where: { id: otpRecord.id },
        data: { attempts_count: { increment: 1 } },
      });
      return res.status(401).json({ status: 'error', message: 'Invalid OTP.' });
    }

    await prisma.authotp.delete({ where: { id: otpRecord.id } });

    let user = await prisma.useraccount.findUnique({
      where: { email: cleanEmail },
      select: { id: true, email: true },
    });
    if (!user) {
      user = await prisma.useraccount.create({
        data: { email: cleanEmail },
        select: { id: true, email: true },
      });
    }

    const userPayload = await buildUserPayload(user.id);
    const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });
    const refreshToken = await generateRefreshToken(user.id);

    return res.status(200).json({
      status: 'success',
      token,
      refresh_token: refreshToken,
      user: userPayload,
    });
  } catch (error) {
    next(error);
  }
};

// ---- PATH B: Direct Code Claim Bootstrap (No Email/OTP Upfront) -----------

exports.claimPatientByCodeBootstrap = async (req, res, next) => {
  try {
    const raw = req.body?.code;
    const code = typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[\s\-]/g, '') : '';
    const ipAddress = String(req.ip || req.headers['x-forwarded-for'] || 'unknown').slice(0, 45);

    const outcome = await prisma.$transaction(async (tx) => {
      const now = Date.now();
      const windowStart = new Date(now - CLAIM_ATTEMPT_WINDOW_MS);

      const failures = await tx.patientclaimattempt.count({
        where: { ip_address: ipAddress, attempted_at: { gte: windowStart } },
      });
      if (failures >= CLAIM_MAX_FAILED_ATTEMPTS) return { type: 'RATE_LIMITED' };

      const recordFailure = async () => {
        await tx.patientclaimattempt.create({ data: { ip_address: ipAddress } });
        await tx.patientclaimattempt.deleteMany({
          where: { ip_address: ipAddress, attempted_at: { lt: windowStart } },
        });
        return { type: 'INVALID' };
      };

      if (!CLAIM_CODE_REGEX.test(code)) return recordFailure();

      const invite = await tx.caregiverinvite.findFirst({
        where: {
          code,
          invite_kind: 'PATIENT_CLAIM',
          is_used: false,
          expires_at: { gt: new Date() },
        },
      });
      if (!invite) return recordFailure();

      // Serialise against concurrent claims on the same patient record
      await lockPatientSelf(tx, invite.patient_id);

      const activeSelf = await tx.patientaccountlink.findFirst({
        where: {
          patient_id: invite.patient_id,
          relationship_type: 'SELF',
          consent_status: 'GRANTED',
          revoked_at: null,
        },
        select: { id: true },
      });
      if (activeSelf) {
        throw new HttpError(409, 'This patient already has an account.', 'SELF_LINK_EXISTS');
      }

      const patient = await tx.patient.findUnique({ where: { id: invite.patient_id } });
      if (!patient || patient.deleted_at) return recordFailure();

      const claimed = await tx.caregiverinvite.updateMany({
        where: {
          id: invite.id,
          invite_kind: 'PATIENT_CLAIM',
          is_used: false,
          expires_at: { gt: new Date() },
        },
        data: { is_used: true },
      });
      if (claimed.count !== 1) return recordFailure();

      // Create the patient's useraccount without requiring an email upfront
      const newUser = await tx.useraccount.create({
        data: {
          email: null,
          full_name: patient.full_name,
          date_of_birth: patient.date_of_birth,
          preferred_language: patient.preferred_language || 'en',
          status: 'ACTIVE',
        },
      });

      // Create the SELF patientaccountlink with canonical ['ALL'] scope
      const link = await tx.patientaccountlink.create({
        data: {
          user_id: newUser.id,
          patient_id: patient.id,
          relationship_type: 'SELF',
          relationship_label: 'Self',
          access_scopes: [SCOPES.ALL],
          consent_status: 'GRANTED',
          granted_by: newUser.id,
        },
      });

      await recordAudit(tx, {
        actorId: newUser.id,
        action: AUDIT_ACTIONS.PATIENT_CLAIMED,
        targetResource: RESOURCES.ACCOUNT_LINK,
        targetId: link.id,
        targetUserId: newUser.id,
        patientId: patient.id,
        scopesBefore: [],
        scopesAfter: [SCOPES.ALL],
        extra: { invite_id: invite.id, issued_by: invite.created_by || null, bootstrap: true },
        req,
      });

      return { type: 'CLAIMED', newUser, patient, link };
    });

    if (outcome.type === 'RATE_LIMITED') {
      return res.status(429).json({
        status: 'error',
        code: 'TOO_MANY_CLAIM_ATTEMPTS',
        message: 'Too many failed attempts. Please try again in an hour.',
      });
    }
    if (outcome.type === 'INVALID') {
      return res.status(400).json({
        status: 'error',
        code: 'INVALID_CLAIM_CODE',
        message: CLAIM_INVALID_MESSAGE,
      });
    }

    const token = jwt.sign(
      { userId: outcome.newUser.id, email: null },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const refreshToken = await generateRefreshToken(outcome.newUser.id);
    const userPayload = await buildUserPayload(outcome.newUser.id);

    return res.status(200).json({
      status: 'success',
      app_name: 'Dost - The cancer care companion',
      token,
      refresh_token: refreshToken,
      user: userPayload,
      patient: outcome.patient,
      access_scopes: [SCOPES.ALL],
      active_patient_id: outcome.patient.id,
      requires_onboarding: false,
    });
  } catch (error) {
    if (error && error.code === 'P2002') {
      return res.status(409).json({
        status: 'error',
        code: 'SELF_LINK_EXISTS',
        message: 'This patient already has an account.',
      });
    }
    next(error);
  }
};

// ---- Authenticated Endpoints ----------------------------------------------

exports.getMe = async (req, res, next) => {
  try {
    const payload = await buildUserPayload(req.user.userId);
    if (!payload) return res.status(404).json({ status: 'error', message: 'User not found.' });

    return res.status(200).json({ status: 'success', data: payload });
  } catch (error) {
    next(error);
  }
};

exports.updateProfile = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { full_name, date_of_birth, phone_number, preferred_language, caregiver_type } = req.body;

    const updateData = {};

    if (full_name !== undefined) {
      if (typeof full_name !== 'string' || full_name.trim() === '') {
        return res.status(400).json({ status: 'error', message: 'full_name cannot be empty.' });
      }
      updateData.full_name = full_name.trim().slice(0, 255);
    }
    if (date_of_birth !== undefined) {
      const dob = new Date(date_of_birth);
      if (Number.isNaN(dob.getTime())) {
        return res
          .status(400)
          .json({ status: 'error', message: 'date_of_birth is not a valid date.' });
      }
      updateData.date_of_birth = dob;
    }
    if (phone_number !== undefined) {
      updateData.phone_number =
        typeof phone_number === 'string' && phone_number.trim() !== ''
          ? phone_number.trim().slice(0, 32)
          : null;
    }
    if (preferred_language !== undefined) {
      if (typeof preferred_language !== 'string' || preferred_language.trim() === '') {
        return res
          .status(400)
          .json({ status: 'error', message: 'preferred_language is invalid.' });
      }
      updateData.preferred_language = preferred_language.trim().slice(0, 10);
    }
    if (caregiver_type !== undefined && !['FAMILY', 'VOLUNTEER'].includes(caregiver_type)) {
      return res
        .status(400)
        .json({ status: 'error', message: 'caregiver_type must be FAMILY or VOLUNTEER.' });
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.useraccount.update({ where: { id: userId }, data: updateData });
    }

    if (caregiver_type) {
      await prisma.caregiverprofile.upsert({
        where: { user_id: userId },
        update: { caregiver_type },
        create: {
          user_id: userId,
          caregiver_type,
        },
      });
    }

    const payload = await buildUserPayload(userId);
    if (!payload) return res.status(404).json({ status: 'error', message: 'User not found.' });

    return res.status(200).json({
      status: 'success',
      message: 'Profile updated successfully.',
      data: payload,
    });
  } catch (error) {
    next(error);
  }
};

exports.refreshToken = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      return res.status(401).json({ status: 'error', message: 'Refresh token required.' });
    }

    if (typeof refresh_token !== 'string') {
      return res.status(401).json({ status: 'error', message: 'Invalid format.' });
    }
    const [userId, rawString] = refresh_token.split('.');
    if (!userId || !rawString || !isUuid(userId)) {
      return res.status(401).json({ status: 'error', message: 'Invalid format.' });
    }

    const tokens = await prisma.refreshtoken.findMany({
      where: { user_id: userId, revoked: false, expires_at: { gt: new Date() } },
    });

    let validDbToken = null;
    for (const t of tokens) {
      if (await argon2.verify(t.token_hash, rawString)) {
        validDbToken = t;
        break;
      }
    }

    if (!validDbToken) {
      return res
        .status(401)
        .json({ status: 'error', message: 'Invalid or expired refresh token.' });
    }

    await prisma.refreshtoken.update({ where: { id: validDbToken.id }, data: { revoked: true } });
    const user = await prisma.useraccount.findUnique({ where: { id: userId } });
    if (!user) {
      return res
        .status(401)
        .json({ status: 'error', message: 'Invalid or expired refresh token.' });
    }

    const newAccessToken = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const newRefreshToken = await generateRefreshToken(user.id);

    return res.status(200).json({
      status: 'success',
      token: newAccessToken,
      refresh_token: newRefreshToken,
    });
  } catch (error) {
    next(error);
  }
};

exports.logout = async (req, res, next) => {
  try {
    const { refresh_token } = req.body;
    if (refresh_token) {
      const [userId, rawString] = refresh_token.split('.');
      if (userId && rawString) {
        const tokens = await prisma.refreshtoken.findMany({
          where: { user_id: userId, revoked: false },
        });
        for (const t of tokens) {
          if (await argon2.verify(t.token_hash, rawString)) {
            await prisma.refreshtoken.update({ where: { id: t.id }, data: { revoked: true } });
            break;
          }
        }
      }
    }

    await prisma.useraccount.update({
      where: { id: req.user.userId },
      data: { fcm_token: null },
    });

    return res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
  } catch (error) {
    next(error);
  }
};

exports.updateFcmToken = async (req, res, next) => {
  try {
    const { fcm_token } = req.body;
    const userId = req.user.userId;

    if (!fcm_token) {
      return res.status(400).json({ status: 'error', message: 'fcm_token is required.' });
    }

    await prisma.useraccount.updateMany({
      where: { fcm_token, NOT: { id: userId } },
      data: { fcm_token: null },
    });

    await prisma.useraccount.update({
      where: { id: userId },
      data: { fcm_token },
    });

    return res
      .status(200)
      .json({ status: 'success', message: 'FCM token registered successfully.' });
  } catch (error) {
    next(error);
  }
};

// ---- Profile Email Linking for Code-Activated Users -----------------------

exports.requestLinkEmailOtp = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cleanEmail = normalizeEmail(req.body?.email);

    if (!cleanEmail) {
      return res
        .status(400)
        .json({ status: 'error', message: 'A valid email address is required.' });
    }

    const existingOwner = await prisma.useraccount.findUnique({ where: { email: cleanEmail } });
    if (existingOwner && existingOwner.id !== userId) {
      return res.status(409).json({
        status: 'error',
        message: 'This email is already registered to another Dost account.',
      });
    }

    const lastOtp = await prisma.authotp.findFirst({
      where: { email: cleanEmail },
      orderBy: { created_at: 'desc' },
    });
    if (lastOtp && Date.now() - new Date(lastOtp.created_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
      return res
        .status(429)
        .json({ status: 'error', message: 'Please wait a minute before requesting another code.' });
    }

    const rawOtp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await argon2.hash(rawOtp);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.authotp.deleteMany({ where: { email: cleanEmail } });
    await prisma.authotp.create({
      data: { email: cleanEmail, otp_hash: otpHash, expires_at: expiresAt },
    });

    try {
      if (typeof transporter.sendOtpEmail === 'function') {
        await transporter.sendOtpEmail(
          cleanEmail,
          rawOtp,
          'Verify your email address for Dost'
        );
      } else {
        await transporter.sendMail({
          from: `"Dost - The cancer care companion" <${process.env.SMTP_USER}>`,
          to: cleanEmail,
          subject: 'Verify your email address for Dost',
          text: `Your verification code is: ${rawOtp}\n\nIt will expire in 10 minutes.`,
        });
      }
      return res.status(200).json({
        status: 'success',
        message: 'Verification code sent to your email.',
        email: cleanEmail,
      });
    } catch (err) {
      console.error('[EMAIL ERROR] Failed to send linking OTP email:', err.message || err);
      // In local development, print the OTP to the terminal if SMTP is blocked/unreachable
      if (process.env.NODE_ENV !== 'production') {
        console.log('\n========================================');
        console.log(`[LOCAL DEV LINK-EMAIL OTP] ${cleanEmail} -> ${rawOtp}`);
        console.log('========================================\n');
        return res.status(200).json({
          status: 'success',
          message: 'Verification code generated (check backend terminal in dev mode).',
          email: cleanEmail,
        });
      }
      return res
        .status(500)
        .json({ status: 'error', message: 'Failed to send verification email.' });
    }
  } catch (error) {
    next(error);
  }
};

exports.verifyLinkEmailOtp = async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const cleanEmail = normalizeEmail(req.body?.email);
    const otpInput =
      typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number'
        ? String(req.body.otp).trim()
        : '';

    if (!cleanEmail || !OTP_REGEX.test(otpInput)) {
      return res
        .status(400)
        .json({ status: 'error', message: 'A valid email and a 6-digit OTP are required.' });
    }

    const otpRecord = await prisma.authotp.findFirst({
      where: { email: cleanEmail },
      orderBy: { created_at: 'desc' },
    });

    if (!otpRecord) return res.status(401).json({ status: 'error', message: 'No pending OTP.' });

    if (otpRecord.attempts_count >= 5) {
      await prisma.authotp.delete({ where: { id: otpRecord.id } });
      return res.status(429).json({ status: 'error', message: 'Too many failed attempts.' });
    }

    if (new Date() > otpRecord.expires_at) {
      await prisma.authotp.delete({ where: { id: otpRecord.id } });
      return res.status(401).json({ status: 'error', message: 'OTP expired.' });
    }

    const isValid = await argon2.verify(otpRecord.otp_hash, otpInput);
    if (!isValid) {
      await prisma.authotp.update({
        where: { id: otpRecord.id },
        data: { attempts_count: { increment: 1 } },
      });
      return res.status(401).json({ status: 'error', message: 'Invalid OTP.' });
    }

    const existingOwner = await prisma.useraccount.findUnique({ where: { email: cleanEmail } });
    if (existingOwner && existingOwner.id !== userId) {
      return res.status(409).json({
        status: 'error',
        message: 'This email is already registered to another Dost account.',
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.authotp.deleteMany({ where: { email: cleanEmail } });
      await tx.useraccount.update({
        where: { id: userId },
        data: { email: cleanEmail, updated_at: new Date() },
      });
    });

    const userPayload = await buildUserPayload(userId);

    return res.status(200).json({
      status: 'success',
      message: 'Email linked successfully.',
      data: userPayload,
      user: userPayload,
    });
  } catch (error) {
    next(error);
  }
};