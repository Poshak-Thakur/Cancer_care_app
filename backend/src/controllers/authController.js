const prisma = require('../config/db');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const transporter = require('../config/mailer');

const getUserRoles = async (userId) => {
    const roles = [];
    const isStaff = await prisma.staffassignment.findFirst({ where: { staff_user_id: userId, status: 'ACTIVE' } });
    if (isStaff) roles.push('STAFF');

    const isPatient = await prisma.patientaccountlink.findFirst({ 
        where: { user_id: userId, relationship_type: { in: ['SELF', 'DELEGATE'] } } 
    });
    if (isPatient) roles.push('PATIENT');

    const isCaregiver = await prisma.patientcaregiverlink.findFirst({ where: { caregiver_user_id: userId } });
    if (isCaregiver) roles.push('CAREGIVER');

    return roles.length > 0 ? roles : ['NEW_USER'];
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

exports.requestOtp = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ status: 'error', message: 'Email is required' });

        const cleanEmail = email.trim().toLowerCase();
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
        } catch (err) {
            console.error('[EMAIL ERROR] Failed to send OTP email:', err);
            console.log(`\n[MOCK FALLBACK] To: ${cleanEmail} | OTP: ${rawOtp}\n`);
        }
        
        return res.status(200).json({ status: 'success', message: 'OTP generated' });
    } catch (error) { next(error); }
};

exports.verifyOtp = async (req, res, next) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) return res.status(400).json({ status: 'error', message: 'Email and OTP required' });

        const cleanEmail = email.trim().toLowerCase();

        const otpRecord = await prisma.authotp.findFirst({
            where: { email: cleanEmail },
            orderBy: { created_at: 'desc' }
        });

        if (!otpRecord) return res.status(401).json({ status: 'error', message: 'No pending OTP' });

        if (otpRecord.attempts_count >= 5) {
            await prisma.authotp.delete({ where: { id: otpRecord.id } });
            return res.status(429).json({ status: 'error', message: 'Too many failed attempts.' });
        }

        if (new Date() > otpRecord.expires_at) {
            await prisma.authotp.delete({ where: { id: otpRecord.id } });
            return res.status(401).json({ status: 'error', message: 'OTP expired' });
        }

        const isValid = await argon2.verify(otpRecord.otp_hash, otp.toString().trim());
        if (!isValid) {
            await prisma.authotp.update({
                where: { id: otpRecord.id },
                data: { attempts_count: { increment: 1 } }
            });
            return res.status(401).json({ status: 'error', message: 'Invalid OTP' });
        }

        await prisma.authotp.delete({ where: { id: otpRecord.id } });

        let user = await prisma.useraccount.findUnique({ where: { email: cleanEmail } });
        if (!user) user = await prisma.useraccount.create({ data: { email: cleanEmail } });

        const roles = await getUserRoles(user.id);
        const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const refreshToken = await generateRefreshToken(user.id);
        
        return res.status(200).json({ status: 'success', token, refresh_token: refreshToken, user: { ...user, roles } });
    } catch (error) { next(error); }
};

exports.getMe = async (req, res, next) => {
    try {
        const user = await prisma.useraccount.findUnique({
            where: { id: req.user.userId },
            select: { id: true, email: true, phone_number: true, preferred_language: true, status: true, created_at: true }
        });
        if (!user) return res.status(404).json({ status: 'error', message: 'User not found' });
        const roles = await getUserRoles(user.id);
        return res.status(200).json({ status: 'success', data: { ...user, roles } });
    } catch (error) { next(error); }
};

exports.refreshToken = async (req, res, next) => {
    try {
        const { refresh_token } = req.body;
        if (!refresh_token) return res.status(401).json({ status: 'error', message: 'Refresh token required' });

        const [userId, rawString] = refresh_token.split('.');
        if (!userId || !rawString) return res.status(401).json({ status: 'error', message: 'Invalid format' });

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
        return res.status(200).json({ status: 'success', message: 'Logged out successfully' });
    } catch (error) { next(error); }
};

exports.updateFcmToken = async (req, res, next) => {
    try {
        const { fcm_token } = req.body;
        const userId = req.user.userId;

        if (!fcm_token) return res.status(400).json({ status: 'error', message: 'fcm_token is required.' });

        await prisma.useraccount.update({
            where: { id: userId },
            data: { fcm_token }
        });

        return res.status(200).json({ status: 'success', message: 'FCM token registered successfully.' });
    } catch (error) { next(error); }
};