const express = require('express');
const communityController = require('../controllers/communityController');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');

const router = express.Router();

// Configure multer for memory storage.
// Enforce a 50MB file size limit to handle short videos and high-res images.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 } 
});

router.use(authMiddleware);

// Feed & Post Creation
router.get('/feed', communityController.getPublicFeed);
router.post('/posts', upload.array('media', 5), communityController.createPost);

// Moderation
router.get('/moderation-queue', communityController.getModerationQueue);
router.patch('/posts/:id/moderate', communityController.moderatePost);

// Reports: any signed-in user can report; only the central NGO reviews (checked in the controller).
router.post('/posts/:id/report', communityController.reportPost);
router.patch('/reports/:id/status', communityController.updateReportStatus);

// Post Engagement
router.post('/posts/:id/like', communityController.toggleLike);
router.post('/posts/:id/comment', communityController.addComment);
router.get('/posts/:id/comments', communityController.getComments);

// Poll Interaction
router.post('/poll/:option_id/vote', communityController.votePoll);

module.exports = router;