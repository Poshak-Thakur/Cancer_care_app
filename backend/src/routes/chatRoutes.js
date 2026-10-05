const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

router.use(authMiddleware);

// Fetch contacts associated with a specific patient
router.get('/contacts/:patient_id', chatController.getContacts);

// NEW: Fetch all chat threads for the logged-in user (Helpline + Care threads)
router.get('/conversations', chatController.getConversations);

// Thread Management & Messaging
router.post('/threads', chatController.openThread);
router.get('/messages/:conversation_id', chatController.getMessages);
router.post('/send', chatController.sendMessage);
router.post('/upload-audio', upload.single('audio'), chatController.uploadAudio);

module.exports = router;