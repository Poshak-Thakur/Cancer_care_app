const express = require('express');
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

router.use(authMiddleware);

// NEW: Get the directory of everyone the patient can chat/call with
router.get('/contacts/:patient_id', requirePatientAccess(), chatController.getCareTeamContacts);

// NEW: Create or open a specific chat thread
router.post('/thread', requirePatientAccess(), chatController.getOrCreateConversation);

// EXISTING: View conversation list[cite: 26]
router.get('/patient/:patient_id', requirePatientAccess(), chatController.getConversations);

// EXISTING: Message-level endpoints[cite: 26]
router.get('/:conversation_id', chatController.getMessages);
router.post('/send', chatController.sendMessage);

module.exports = router;