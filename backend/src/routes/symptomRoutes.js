const express = require('express');
const symptomController = require('../controllers/symptomController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/check-in', symptomController.submitCheckIn);
router.get('/today/:patient_id', symptomController.getTodayCheckInStatus);

module.exports = router;