const express = require('express');
const adminController = require('../controllers/adminController');
const caseNoteController = require('../controllers/caseNoteController');
const checkInFormController = require('../controllers/checkInFormController');
const documentController = require('../controllers/documentController');
const authMiddleware = require('../middleware/authMiddleware');
const { requireCentralCounsellor } = require('../middleware/rbacMiddleware');

const router = express.Router();

// Every admin route: valid JWT + the single central NGO head/counsellor.
router.use(authMiddleware);
router.use(requireCentralCounsellor);

// Dashboard
router.get('/overview', adminController.getOverview);

// Patients (global view + NGO-managed records; no delete in v1)
router.get('/patients', adminController.listPatients);
router.post('/patients', adminController.createPatient);
router.get('/patients/:id', adminController.getPatient);
router.patch('/patients/:id', adminController.updatePatient);
router.post('/patients/:id/claim-code', adminController.createPatientClaimCode);

// Case notes (append-only)
router.get('/patients/:id/case-notes', caseNoteController.listCaseNotes);
router.post('/patients/:id/case-notes', caseNoteController.createCaseNote);

// Document verification queue (never returns file_path) + medication verification
router.get('/documents', adminController.listDocuments);
router.patch('/medications/:id/verify', adminController.verifyMedication);

// Care events across all patients
router.get('/care-events', adminController.listCareEvents);

// Secure (short-lived signed) URLs for private files
router.get('/documents/:id/file-url', documentController.getAdminDocumentFileUrl);
router.get('/prescriptions/:id/file-url', documentController.getAdminPrescriptionFileUrl);

// Audit log (read-only)
router.get('/audit-logs', adminController.listAuditLogs);

// Caregiver NGO recognition (central NGO only)
router.get('/caregivers', adminController.listCaregivers);
router.patch('/caregivers/:user_id/recognition', adminController.setCaregiverRecognition);

// Alerts
router.get('/alerts', adminController.listAlerts);
router.get('/alerts/:id', adminController.getAlert);
router.patch('/alerts/:id/status', adminController.updateAlertStatus);
router.post('/alerts/:id/updates', adminController.addAlertUpdate);

// Today's Check-in form management (central NGO only; drafts -> publish; fully audited)
router.get('/check-in-forms/current', checkInFormController.getCurrentForm);
router.post('/check-in-forms/drafts', checkInFormController.createDraft);
router.post('/check-in-forms/:versionId/fields', checkInFormController.addField);
router.post('/check-in-forms/:versionId/publish', checkInFormController.publishVersion);
router.patch('/check-in-fields/:fieldId', checkInFormController.updateField);
router.delete('/check-in-fields/:fieldId', checkInFormController.removeField);

module.exports = router;
