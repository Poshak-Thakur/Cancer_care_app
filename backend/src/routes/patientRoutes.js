const express = require('express');
const patientController = require('../controllers/patientController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Enforce JWT validation across all patient endpoints
router.use(authMiddleware);

router.post('/', patientController.createPatientProfile);
router.get('/me', patientController.getMyPatients);

router.post(
    '/:patient_id/delegates',
    patientController.addPatientDelegate
);

router.patch(
    '/:patient_id/delegates/:user_id',
    patientController.updatePatientDelegate
);

router.delete(
    '/:patient_id/delegates/:user_id',
    patientController.revokePatientDelegate
);

module.exports = router;
