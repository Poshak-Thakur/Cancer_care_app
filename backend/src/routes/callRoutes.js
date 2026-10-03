const express = require('express');
const callController = require('../controllers/callController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// All call routes require basic authentication
router.use(authMiddleware);

router.post('/initiate', callController.initiateCall);
router.get('/incoming', callController.getIncomingCalls);
router.patch('/:id/status', callController.updateCallStatus);

module.exports = router;