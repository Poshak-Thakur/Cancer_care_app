const { verifyPatientDataEventAccess } = require('../services/authorizationService');

const requirePatientAccess = () => {
    return async (req, res, next) => {
        try {
            const patientId = req.params.patient_id || req.body.patient_id || req.query.patient_id;
            
            if (!patientId) {
                return res.status(400).json({ status: 'error', message: 'patient_id is required for access check.' });
            }

            const hasAccess = await verifyPatientDataEventAccess(req.user.userId, patientId);
            if (!hasAccess) {
                return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
            }
            
            next();
        } catch (error) { 
            next(error); 
        }
    };
};

module.exports = requirePatientAccess;