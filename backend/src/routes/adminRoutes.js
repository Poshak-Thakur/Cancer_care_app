const express = require('express');
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireCentralCounsellor } = require('../middleware/rbacMiddleware');

const router = express.Router();

// Every admin route: valid JWT + the single central NGO head/counsellor.
router.use(authMiddleware);
router.use(requireCentralCounsellor);

// Patients (global view)
router.get('/patients', adminController.listPatients);
router.get('/patients/:id', adminController.getPatient);

// Alerts
router.get('/alerts', adminController.listAlerts);
router.get('/alerts/:id', adminController.getAlert);
router.patch('/alerts/:id/status', adminController.updateAlertStatus);
router.post('/alerts/:id/updates', adminController.addAlertUpdate);

module.exports = router;
