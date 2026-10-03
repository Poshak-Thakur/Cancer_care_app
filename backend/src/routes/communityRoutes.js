const express = require('express');
const communityController = require('../controllers/communityController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.use(authMiddleware);

router.get('/feed', communityController.getPublicFeed);
router.post('/posts', communityController.createPost);
router.get('/moderation-queue', communityController.getModerationQueue);
router.patch('/posts/:id/moderate', communityController.moderatePost);

module.exports = router;