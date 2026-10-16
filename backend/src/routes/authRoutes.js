const express = require('express');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

const otpRequestLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, 
    max: 20, 
    message: { status: 'error', message: 'Too many OTP requests from this IP, please try again after 5 minutes.' }
});

const otpVerifyLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: { status: 'error', message: 'Too many OTP verification attempts from this IP, please try again after 5 minutes.' }
});

// Rate limiter for patient claim codes (prevents brute forcing one-time invitation codes)
const claimCodeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 10, // Max 10 attempts per IP per hour
    message: { status: 'error', message: 'Too many invitation code attempts from this IP, please try again after an hour.' }
});

// ---------------- Public Auth Endpoints ----------------
// Path A: Standard email OTP login / register
router.post('/request-otp', otpRequestLimiter, authController.requestOtp);
router.post('/verify-otp', otpVerifyLimiter, authController.verifyOtp);
router.post('/refresh', authController.refreshToken);

// Path B: Direct NGO patient claim code bootstrap (No email or OTP required upfront)
router.post('/claim-code', claimCodeLimiter, authController.claimPatientByCodeBootstrap);

// ---------------- Authenticated Endpoints ----------------
router.use(authMiddleware);

router.get('/me', authController.getMe);
router.patch('/profile', authController.updateProfile);
router.post('/logout', authController.logout);
router.post('/fcm-token', authController.updateFcmToken);

// Attach & verify email later from Profile (for code-claimed patient accounts)
router.post('/link-email/request-otp', otpRequestLimiter, authController.requestLinkEmailOtp);
router.post('/link-email/verify-otp', otpVerifyLimiter, authController.verifyLinkEmailOtp);

module.exports = router;