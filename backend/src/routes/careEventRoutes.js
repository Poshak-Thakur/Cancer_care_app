const express = require('express');
const careEventController = require('../controllers/careEventController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/daily/:patient_id', requirePatientAccess(), careEventController.getDailyEvents);
router.post('/', requirePatientAccess(), careEventController.createEvent);
router.patch('/:id/status', careEventController.updateEventStatus); 

module.exports = router;