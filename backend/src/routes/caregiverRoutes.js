const express = require('express');
const multer = require('multer');
const caregiverController = require('../controllers/caregiverController');
const authMiddleware = require('../middleware/authMiddleware');
const requirePatientAccess = require('../middleware/rbacMiddleware');

const router = express.Router();

// 5MB limit for profile pictures
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authMiddleware);

// NEW: Profile Management (Onboarding & Editing)
router.post('/profile', caregiverController.upsertProfile);
router.get('/profile', caregiverController.getProfile);
router.post('/avatar', upload.single('avatar'), caregiverController.uploadAvatar);

// Existing Patient Linking & Invites
router.post('/invite', requirePatientAccess(), caregiverController.generateInvite);
router.post('/accept-invite', caregiverController.acceptInvite);
router.get('/patients', caregiverController.getMyLinkedPatients);
router.patch('/availability/:patient_id', requirePatientAccess(), caregiverController.updateAvailability);
router.post('/revoke', requirePatientAccess(), caregiverController.revokeCaregiver);

module.exports = router;