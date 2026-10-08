const express = require('express');
const careEventController = require('../controllers/careEventController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

// Enforce JWT validation for all routes
router.use(authMiddleware);

// NEW: AI Parser for both Voice Dictation and Typed Text commands
router.post('/parse-command', careEventController.parseCommand);

// Existing CRUD for Care Events
router.get('/daily/:patient_id', requirePatientAccess('CARE_EVENT_VIEW'), careEventController.getDailyEvents);
router.post('/', requirePatientAccess('CARE_EVENT_EDIT'), careEventController.createEvent);
router.patch('/:id/status', careEventController.updateEventStatus); 

module.exports = router;