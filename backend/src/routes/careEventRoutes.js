const express = require('express');
const careEventController = require('../controllers/careEventController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/daily/:patient_id', careEventController.getDailyEvents);
router.post('/', careEventController.createEvent);
router.patch('/:id/status', careEventController.updateEventStatus);

module.exports = router;