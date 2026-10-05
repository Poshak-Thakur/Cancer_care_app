const express = require('express');
const symptomController = require('../controllers/symptomController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/check-in', requirePatientAccess(), symptomController.submitCheckIn);
router.get('/today/:patient_id', requirePatientAccess(), symptomController.getTodayCheckInStatus);
router.get('/history/:patient_id', requirePatientAccess(), symptomController.getSymptomHistory);

module.exports = router;