const prisma = require('../config/db');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const transporter = require('../config/mailer');
const { isCentralCounsellor } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');

// STAFF now means exactly one thing: the central NGO head/counsellor (same rule the whole
// backend uses for authorization). Per-patient staffassignment rows grant nothing.
const getUserRoles = async (userId) => {
    const roles = [];

    if (await isCentralCounsellor(userId)) roles.push('STAFF');

    const isPatient = await prisma.patientaccountlink.findFirst({
        where: { user_id: userId, relationship_type: { in: ['SELF', 'DELEGATE'] }, consent_status: 'GRANTED', revoked_at: null }
    });
    if (isPatient) roles.push('PATIENT');

    // Caregiver = linked to a patient OR registered caregiver profile
    const [isCaregiverLink, hasCaregiverProfile] = await Promise.all([
        prisma.patientcaregiverlink.findFirst({ where: { caregiver_user_id: userId, consent_status: 'GRANTED', revoked_at: null } }),
        prisma.caregiverprofile.findUnique({ where: { user_id: userId } })
    ]);
    if (isCaregiverLink || hasCaregiverProfile) roles.push('CAREGIVER');

    return roles.length > 0 ? roles : ['NEW_USER'];
};

// ONE definition of "profile completed", used by verify-otp, /me and PATCH /profile.
const isProfileCompleted = (user) => Boolean(user && typeof user.full_name === 'string' && user.full_name.trim().length > 0);

// ONE user shape for verify-otp, /me and PATCH /profile (never leaks fcm_token).
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
    caregiverprofile: true
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
        data: { user_id: userId, token_hash: tokenHash, expires_at: expiresAt }
    });
    return rawToken;
};

// ---- OTP input hardening --------------------------------------------------
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const OTP_REGEX = /^\d{6}$/;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;   // one OTP per email per minute (on top of the per-IP limiter)

// Returns the normalised email or null. Rejects non-strings (e.g. JSON arrays/objects).
const normalizeEmail = (value) => {
    if (typeof value !== 'string') return null;
    const email = value.trim().toLowerCase();
    if (email.length > 254 || !EMAIL_REGEX.test(email)) return null;
    return email;
};

exports.requestOtp = async (req, res, next) => {
    try {
        const cleanEmail = normalizeEmail(req.body?.email);
        if (!cleanEmail) return res.status(400).json({ status: 'error', message: 'A valid email address is required.' });

        // Per-email throttle: stops someone mail-bombing one address from many IPs.
        const lastOtp = await prisma.authotp.findFirst({ where: { email: cleanEmail }, orderBy: { created_at: 'desc' } });
        if (lastOtp && Date.now() - new Date(lastOtp.created_at).getTime() < OTP_RESEND_COOLDOWN_MS) {
            return res.status(429).json({ status: 'error', message: 'Please wait a minute before requesting another code.' });
        }

        const rawOtp = crypto.randomInt(100000, 1000000).toString();
        const otpHash = await argon2.hash(rawOtp);
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        await prisma.authotp.deleteMany({ where: { email: cleanEmail } });
        await prisma.authotp.create({
            data: { email: cleanEmail, otp_hash: otpHash, expires_at: expiresAt }
        });

        try {
            await transporter.sendMail({
                from: `"Saathi App" <${process.env.SMTP_USER}>`,
                to: cleanEmail,
                subject: 'Your Saathi App Login Code',
                text: `Your OTP code is: ${rawOtp}\n\nIt will expire in 10 minutes.`
            });
            console.log(`[EMAIL SENT] OTP sent to ${cleanEmail}`);
            return res.status(200).json({ status: 'success', message: 'OTP sent successfully.' });
        } catch (err) {
            console.error('[EMAIL ERROR] Failed to send OTP email:', err);
            // Strict failure: No console fallback allowed in production.
            return res.status(500).json({ status: 'error', message: 'Failed to send verification email. Please try again later.' });
        }
    } catch (error) { next(error); }
};

exports.verifyOtp = async (req, res, next) => {
    try {
        const cleanEmail = normalizeEmail(req.body?.email);
        const otpInput = (typeof req.body?.otp === 'string' || typeof req.body?.otp === 'number') ? String(req.body.otp).trim() : '';
        if (!cleanEmail || !OTP_REGEX.test(otpInput)) {
            return res.status(400).json({ status: 'error', message: 'A valid email and a 6-digit OTP are required.' });
        }

        const otpRecord = await prisma.authotp.findFirst({
            where: { email: cleanEmail },
            orderBy: { created_at: 'desc' }
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
                data: { attempts_count: { increment: 1 } }
            });
            return res.status(401).json({ status: 'error', message: 'Invalid OTP.' });
        }

        await prisma.authotp.delete({ where: { id: otpRecord.id } });

        let user = await prisma.useraccount.findUnique({ where: { email: cleanEmail }, select: { id: true, email: true } });
        if (!user) user = await prisma.useraccount.create({ data: { email: cleanEmail }, select: { id: true, email: true } });

        const userPayload = await buildUserPayload(user.id);
        const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = await generateRefreshToken(user.id);

        return res.status(200).json({
            status: 'success',
            token,
            refresh_token: refreshToken,
            user: userPayload
        });
    } catch (error) { next(error); }
};

exports.getMe = async (req, res, next) => {
    try {
        const payload = await buildUserPayload(req.user.userId);
        if (!payload) return res.status(404).json({ status: 'error', message: 'User not found.' });

        return res.status(200).json({ status: 'success', data: payload });
    } catch (error) { next(error); }
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
                return res.status(400).json({ status: 'error', message: 'date_of_birth is not a valid date.' });
            }
            updateData.date_of_birth = dob;
        }
        if (phone_number !== undefined) {
            updateData.phone_number = (typeof phone_number === 'string' && phone_number.trim() !== '')
                ? phone_number.trim().slice(0, 32)
                : null;
        }
        if (preferred_language !== undefined) {
            if (typeof preferred_language !== 'string' || preferred_language.trim() === '') {
                return res.status(400).json({ status: 'error', message: 'preferred_language is invalid.' });
            }
            updateData.preferred_language = preferred_language.trim().slice(0, 10);
        }
        if (caregiver_type !== undefined && !['FAMILY', 'VOLUNTEER'].includes(caregiver_type)) {
            return res.status(400).json({ status: 'error', message: 'caregiver_type must be FAMILY or VOLUNTEER.' });
        }

        if (Object.keys(updateData).length > 0) {
            await prisma.useraccount.update({ where: { id: userId }, data: updateData });
        }

        if (caregiver_type) {
            await prisma.caregiverprofile.upsert({
                where: { user_id: userId },
                update: { caregiver_type },
                // New caregivers always start NOT_RECOGNIZED (the schema default); only the NGO
                // can recognise them via PATCH /api/admin/caregivers/:user_id/recognition.
                create: {
                    user_id: userId,
                    caregiver_type
                }
            });
        }

        const payload = await buildUserPayload(userId);
        if (!payload) return res.status(404).json({ status: 'error', message: 'User not found.' });

        return res.status(200).json({
            status: 'success',
            message: 'Profile updated successfully.',
            data: payload
        });
    } catch (error) { next(error); }
};

exports.refreshToken = async (req, res, next) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token) return res.status(401).json({ status: 'error', message: 'Refresh token required.' });

        if (typeof refresh_token !== 'string') return res.status(401).json({ status: 'error', message: 'Invalid format.' });
        const [userId, rawString] = refresh_token.split('.');
        if (!userId || !rawString || !isUuid(userId)) return res.status(401).json({ status: 'error', message: 'Invalid format.' });

        const tokens = await prisma.refreshtoken.findMany({
            where: { user_id: userId, revoked: false, expires_at: { gt: new Date() } }
        });

        let validDbToken = null;
        for (const t of tokens) {
            if (await argon2.verify(t.token_hash, rawString)) {
                validDbToken = t;
                break;
            }
        }

        if (!validDbToken) return res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token.' });

        await prisma.refreshtoken.update({ where: { id: validDbToken.id }, data: { revoked: true } });
        const user = await prisma.useraccount.findUnique({ where: { id: userId } });
        if (!user) return res.status(401).json({ status: 'error', message: 'Invalid or expired refresh token.' });

        const newAccessToken = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const newRefreshToken = await generateRefreshToken(user.id);

        return res.status(200).json({ status: 'success', token: newAccessToken, refresh_token: newRefreshToken });
    } catch (error) { next(error); }
};

exports.logout = async (req, res, next) => {
    try {
        const { refresh_token } = req.body;
        if (refresh_token) {
            const [userId, rawString] = refresh_token.split('.');
            if (userId && rawString) {
                const tokens = await prisma.refreshtoken.findMany({ where: { user_id: userId, revoked: false } });
                for (const t of tokens) {
                    if (await argon2.verify(t.token_hash, rawString)) {
                        await prisma.refreshtoken.update({ where: { id: t.id }, data: { revoked: true } });
                        break;
                    }
                }
            }
        }
        
        // Remove FCM token to stop ringing this device after logout
        await prisma.useraccount.update({
            where: { id: req.user.userId },
            data: { fcm_token: null }
        });
        
        return res.status(200).json({ status: 'success', message: 'Logged out successfully.' });
    } catch (error) { next(error); }
};

exports.updateFcmToken = async (req, res, next) => {
    try {
        const { fcm_token } = req.body;
        const userId = req.user.userId;

        if (!fcm_token) return res.status(400).json({ status: 'error', message: 'fcm_token is required.' });

        // Wipe this token from any other user who might have logged in previously on this device
        await prisma.useraccount.updateMany({
            where: { fcm_token, NOT: { id: userId } },
            data: { fcm_token: null }
        });

        // Assign to current user
        await prisma.useraccount.update({
            where: { id: userId },
            data: { fcm_token }
        });

        return res.status(200).json({ status: 'success', message: 'FCM token registered successfully.' });
    } catch (error) { next(error); }
};
