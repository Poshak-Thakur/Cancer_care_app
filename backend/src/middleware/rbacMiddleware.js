const prisma = require('../config/db');
const { isCentralCounsellor, verifyPatientDataEventAccess } = require('../services/authorizationService');

const requirePatientAccess = (requiredScope = null) => {
    return async (req, res, next) => {
        try {
            const patientId = req.params.patient_id || req.body.patient_id || req.query.patient_id;
            const userId = req.user.userId;

            if (!patientId) {
                return res.status(400).json({ status: 'error', message: 'patient_id is required for access check.' });
            }

            // 1. Verify access using the unified service
            const hasAccess = await verifyPatientDataEventAccess(userId, patientId);
            if (!hasAccess) {
                return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
            }

            // 2. Populate req.accessContext for controllers expecting role and link metadata
            const accountLink = await prisma.patientaccountlink.findFirst({
                where: { user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
            });

            if (accountLink) {
                req.accessContext = { role: 'PATIENT', link: accountLink };
                return next();
            }

            const caregiverLink = await prisma.patientcaregiverlink.findFirst({
                where: { caregiver_user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
            });

            if (caregiverLink) {
                const scopes = caregiverLink.access_scopes || [];
                if (requiredScope && !scopes.includes('ALL') && !scopes.includes(requiredScope)) {
                    return res.status(403).json({ status: 'error', message: `Access denied. Requires scope: ${requiredScope}` });
                }
                req.accessContext = { role: 'CAREGIVER', link: caregiverLink };
                return next();
            }

            const isCentral = await isCentralCounsellor(userId);
            const staffAssignment = await prisma.staffassignment.findFirst({
                where: { staff_user_id: userId, patient_id: patientId, status: 'ACTIVE' }
            });

            if (isCentral || staffAssignment) {
                req.accessContext = { 
                    role: 'STAFF', 
                    link: staffAssignment || { staff_user_id: userId, role: 'COUNSELLOR' } 
                };
                return next();
            }

            req.accessContext = { role: 'PATIENT', link: null };
            next();
        } catch (error) { 
            next(error); 
        }
    };
};

module.exports = requirePatientAccess;