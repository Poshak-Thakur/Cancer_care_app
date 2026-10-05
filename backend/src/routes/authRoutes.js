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

router.post('/request-otp', otpRequestLimiter, authController.requestOtp);
router.post('/verify-otp', otpVerifyLimiter, authController.verifyOtp);
router.post('/refresh', authController.refreshToken);

router.use(authMiddleware);

router.get('/me', authController.getMe);
router.post('/logout', authController.logout);
router.post('/fcm-token', authController.updateFcmToken);

module.exports = router;