const express = require('express');
const patientController = require('../controllers/patientController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Enforce JWT validation across all patient endpoints
router.use(authMiddleware);

router.post('/', patientController.createPatientProfile);
router.get('/me', patientController.getMyPatients);

module.exports = router;