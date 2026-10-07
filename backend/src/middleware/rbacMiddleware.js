const { isUuid } = require('../utils/validators');
const { getPatientAccessContext, isCentralCounsellor } = require('../services/authorizationService');

/**
 * Patient-scoped access guard. ALL rules live in authorizationService; this
 * file only translates the result into HTTP + req.accessContext.
 *
 *   Central NGO head/counsellor -> global patient access (role STAFF)
 *   Patient (SELF/DELEGATE)     -> own / delegated patient access (role PATIENT)
 *   Caregiver                   -> GRANTED link + access_scopes (role CAREGIVER)
 */
const requirePatientAccess = (requiredScope = null) => {
    return async (req, res, next) => {
        try {
            const patientId = req.params?.patient_id || req.body?.patient_id || req.query?.patient_id;
            const userId = req.user.userId;

            if (!patientId) {
                return res.status(400).json({ status: 'error', message: 'patient_id is required for access check.' });
            }
            if (!isUuid(patientId)) {
                return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
            }

            const ctx = await getPatientAccessContext(userId, patientId);
            if (!ctx) {
                return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
            }

            if (ctx.role === 'CAREGIVER' && requiredScope) {
                const scopes = Array.isArray(ctx.link.access_scopes) ? ctx.link.access_scopes : [];
                if (!scopes.includes('ALL') && !scopes.includes(requiredScope)) {
                    return res.status(403).json({ status: 'error', message: `Access denied. Requires scope: ${requiredScope}` });
                }
            }

            req.accessContext = ctx;
            next();
        } catch (error) {
            next(error);
        }
    };
};

// Guard for the NGO web admin API: only the single central NGO head/counsellor.
const requireCentralCounsellor = async (req, res, next) => {
    try {
        if (!(await isCentralCounsellor(req.user.userId))) {
            return res.status(403).json({ status: 'error', message: 'Only the central NGO head/counsellor can access this resource.' });
        }
        next();
    } catch (error) {
        next(error);
    }
};

module.exports = requirePatientAccess;
module.exports.requireCentralCounsellor = requireCentralCounsellor;
