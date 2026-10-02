const prisma = require('../config/db');
const argon2 = require('argon2');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

exports.requestOtp = async (req, res, next) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ status: 'error', message: 'Email is required' });
        }

        // Generate a cryptographically secure 6-digit OTP
        const rawOtp = crypto.randomInt(100000, 999999).toString();
        
        // Hash with Argon2 for secure database storage
        const otpHash = await argon2.hash(rawOtp);
        
        // Set expiration to 10 minutes from now
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

        // Delete any existing unused OTPs for this email to prevent spam/clutter
        // Note: Using the exact lowercase model name Prisma generated
        await prisma.authotp.deleteMany({ where: { email } });

        // Store the new hashed OTP record
        await prisma.authotp.create({
            data: {
                email,
                otp_hash: otpHash,
                expires_at: expiresAt
            }
        });

        // Mock Email Delivery (To be replaced with a mailing service later)
        console.log(`\n[MOCK EMAIL DELIVERY] To: ${email} | OTP: ${rawOtp}\n`);

        return res.status(200).json({ 
            status: 'success', 
            message: 'OTP generated and sent successfully' 
        });
    } catch (error) {
        next(error);
    }
};

exports.verifyOtp = async (req, res, next) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ status: 'error', message: 'Email and OTP are required' });
        }

        // Find the latest OTP record for this email
        const otpRecord = await prisma.authotp.findFirst({
            where: { email },
            orderBy: { created_at: 'desc' }
        });

        if (!otpRecord) {
            return res.status(401).json({ status: 'error', message: 'No pending OTP found for this email' });
        }

        // Enforce expiration
        if (new Date() > otpRecord.expires_at) {
            await prisma.authotp.delete({ where: { id: otpRecord.id } });
            return res.status(401).json({ status: 'error', message: 'OTP has expired. Please request a new one.' });
        }

        // Verify the provided OTP against the Argon2 hash
        const isValid = await argon2.verify(otpRecord.otp_hash, otp);
        if (!isValid) {
            await prisma.authotp.update({
                where: { id: otpRecord.id },
                data: { attempts_count: { increment: 1 } }
            });
            return res.status(401).json({ status: 'error', message: 'Invalid OTP' });
        }

        // OTP is valid. Delete the record to prevent reuse
        await prisma.authotp.delete({ where: { id: otpRecord.id } });

        // Find the useraccount, or create a new one if it is their first time logging in
        let user = await prisma.useraccount.findUnique({ where: { email } });
        if (!user) {
            user = await prisma.useraccount.create({
                data: { email }
            });
        }

        // Generate the JWT 
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.status(200).json({ 
            status: 'success', 
            message: 'Authentication successful',
            token,
            user 
        });
    } catch (error) {
        next(error);
    }
};

exports.getMe = async (req, res, next) => {
    try {
        const user = await prisma.userAccount.findUnique({
            where: { id: req.user.userId },
            select: {
                id: true,
                email: true,
                phone_number: true,
                preferred_language: true,
                status: true,
                created_at: true
            }
        });

        if (!user) {
            return res.status(404).json({ status: 'error', message: 'User not found' });
        }

        return res.status(200).json({ status: 'success', data: user });
    } catch (error) {
        next(error);
    }
};