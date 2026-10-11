const express = require('express');
const checkInFormController = require('../controllers/checkInFormController');
const authMiddleware = require('../middleware/authMiddleware');

// Flutter-facing: mounted at /api/symptoms/check-in  ->  GET /api/symptoms/check-in/form
// Authenticated users only; returns the PUBLISHED configuration (never a draft).
// Form MANAGEMENT lives in adminRoutes behind requireCentralCounsellor.
const router = express.Router();

router.use(authMiddleware);
router.get('/form', checkInFormController.getPublishedForm);

module.exports = router;
