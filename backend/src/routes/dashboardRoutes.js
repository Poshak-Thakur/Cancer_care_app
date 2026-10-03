const express = require('express');
const dashboardController = require('../controllers/dashboardController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/:patient_id', requirePatientAccess(), dashboardController.getDashboardOverview);

module.exports = router;