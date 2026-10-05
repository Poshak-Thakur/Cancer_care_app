const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

router.use(authMiddleware);

router.get('/contacts/:patient_id', chatController.getContacts);
router.post('/threads', chatController.openThread);
router.get('/messages/:conversation_id', chatController.getMessages);
router.post('/send', chatController.sendMessage);
router.post('/upload-audio', upload.single('audio'), chatController.uploadAudio);

module.exports = router;