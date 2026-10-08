const express = require('express');
const multer = require('multer');
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB limit

router.use(authMiddleware);

// NEW: Uploads image, runs AI OCR, and returns parsed JSON to Flutter
router.post('/prescriptions/scan', upload.single('prescription'), requirePatientAccess('MEDICATION_EDIT'), documentController.scanPrescription);

// NEW: Saves the user-verified medications to the database
router.post('/medications/confirm', requirePatientAccess('MEDICATION_EDIT'), documentController.confirmMedications);

// Existing generic document routes
router.post('/', upload.single('file'), requirePatientAccess('DOCUMENT_UPLOAD'), documentController.uploadDocument);
router.get('/patient/:patient_id', requirePatientAccess('DOCUMENT_VIEW'), documentController.getPatientDocuments);
router.patch('/:id/verify', documentController.verifyDocument); 

module.exports = router;