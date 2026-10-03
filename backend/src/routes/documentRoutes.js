const express = require('express');
const multer = require('multer');
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.use(authMiddleware);

router.post('/', upload.single('file'), requirePatientAccess(), documentController.uploadDocument);
router.get('/patient/:patient_id', requirePatientAccess(), documentController.getPatientDocuments);
router.patch('/:id/verify', documentController.verifyDocument); 

module.exports = router;