const express = require('express');
const alertController = require('../controllers/alertController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Manual Help Now (mobile). Authorisation is done inside the controller through the central
// authorization service (current patient relationship; no specific scope is required).
router.use(authMiddleware);

router.post('/help-now', alertController.createHelpNow);
router.patch('/:id/cancel', alertController.cancelHelpNow);

module.exports = router;
