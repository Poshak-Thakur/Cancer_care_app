const express = require('express');
const multer = require('multer');
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// Store files in memory buffer before pushing to Supabase Storage
const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.use(authMiddleware);

// Notice `upload.single('file')` intercepts the file data
router.post('/', upload.single('file'), documentController.uploadDocument);
router.get('/patient/:patient_id', documentController.getPatientDocuments);
router.patch('/:id/verify', documentController.verifyDocument);

module.exports = router;