const express = require('express');
const caregiverController = require('../controllers/caregiverController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.post('/profile', caregiverController.createProfile);
router.post('/invite', requirePatientAccess(), caregiverController.generateInvite);
router.post('/accept-invite', caregiverController.acceptInvite);
router.get('/patients', caregiverController.getMyLinkedPatients);
router.patch('/availability/:patient_id', requirePatientAccess(), caregiverController.updateAvailability);

module.exports = router;