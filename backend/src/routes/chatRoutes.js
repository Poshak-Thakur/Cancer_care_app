const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');

// STRICT 10MB Limit implemented
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } 
});

router.use(authMiddleware);

router.get('/contacts/:patient_id', chatController.getContacts);
router.get('/conversations', chatController.getConversations);

router.post('/threads', chatController.openThread);
router.get('/messages/:conversation_id', chatController.getMessages);
router.post('/send', chatController.sendMessage);
router.post('/upload-audio', upload.single('audio'), chatController.uploadAudio);

module.exports = router;