const prisma = require('../config/db');
const { isUuid } = require('../utils/validators');

/**
 * CANONICAL AUTHORIZATION MODEL
 * ------------------------------------------------------------------
 * The NGO head and the NGO counsellor are ONE central account. Any active
 * staffprofile whose roles contain COUNSELLOR or ADMIN is that central
 * authority and has global access. There is deliberately NO per-patient staff
 * logic (staffassignment is not consulted for access decisions).
 *
 * Everyone else gets access to a patient only through:
 *   - a GRANTED patientaccountlink (SELF / DELEGATE)  -> role PATIENT
 *   - a GRANTED patientcaregiverlink                  -> role CAREGIVER
 *
 * All controllers and middleware must reuse the helpers below.
 */

const CENTRAL_ROLES = ['COUNSELLOR', 'ADMIN'];
const PATIENT_LINK_TYPES = ['SELF', 'DELEGATE'];

const hasCentralRole = (roles) =>
    Array.isArray(roles) &&
    roles.some((r) => typeof r === 'string' && CENTRAL_ROLES.includes(r.trim().toUpperCase()));

// True if this user is the single central NGO head / counsellor.
const isCentralCounsellor = async (userId) => {
    if (!isUuid(userId)) return false;
    const profile = await prisma.staffprofile.findFirst({
        where: { user_id: userId, is_active: true },
        select: { roles: true }
    });
    return !!profile && hasCentralRole(profile.roles);
};

// User ids of every active central NGO account (normally exactly one).
const getCentralCounsellorUserIds = async () => {
    const profiles = await prisma.staffprofile.findMany({
        where: { is_active: true },
        select: { user_id: true, roles: true }
    });
    return profiles.filter((p) => hasCentralRole(p.roles)).map((p) => p.user_id);
};

// Active patient-account link (SELF / DELEGATE) or null. Revoked links never count.
const findActivePatientAccountLink = (userId, patientId) =>
    prisma.patientaccountlink.findFirst({
        where: {
            user_id: userId,
            patient_id: patientId,
            relationship_type: { in: PATIENT_LINK_TYPES },
            consent_status: 'GRANTED'
        }
    });

const findActiveCaregiverLink = (userId, patientId) =>
    prisma.patientcaregiverlink.findFirst({
        where: { caregiver_user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
    });

/**
 * Resolves HOW a user may access a patient.
 * Returns { role, link } or null when there is no access.
 *   role: 'PATIENT' | 'STAFF' (central NGO) | 'CAREGIVER'
 * Precedence: patient link -> central NGO -> caregiver, so the central NGO is
 * never narrowed by an incidental caregiver scope list.
 */
const getPatientAccessContext = async (userId, patientId) => {
    if (!isUuid(userId) || !isUuid(patientId)) return null;

    const accountLink = await findActivePatientAccountLink(userId, patientId);
    if (accountLink) return { role: 'PATIENT', link: accountLink };

    if (await isCentralCounsellor(userId)) {
        return {
            role: 'STAFF',
            link: {
                staff_user_id: userId,
                role: 'COUNSELLOR',
                relationship_label: 'NGO Counsellor',
                access_scopes: ['ALL']
            }
        };
    }

    const caregiverLink = await findActiveCaregiverLink(userId, patientId);
    if (caregiverLink) return { role: 'CAREGIVER', link: caregiverLink };

    return null;
};

// Patient SELF/DELEGATE (GRANTED) + Caregiver (GRANTED) + central NGO.
const verifyPatientDataEventAccess = async (userId, patientId) => {
    const ctx = await getPatientAccessContext(userId, patientId);
    return !!ctx;
};

// Only the patient's own account holders (SELF/DELEGATE) or the central NGO may
// manage who else can see the patient (caregiver invites / revoking).
const canManagePatientCaregivers = async (userId, patientId) => {
    if (!isUuid(userId) || !isUuid(patientId)) return false;
    if (await findActivePatientAccountLink(userId, patientId)) return true;
    return isCentralCounsellor(userId);
};

/**
 * May `callerId` chat/call `receiverId`?
 *   - central NGO as caller              -> anyone
 *   - anyone -> central NGO              -> allowed (helpline). If a patient
 *                                           context is supplied, the caller must
 *                                           belong to that patient's network.
 *   - patient/caregiver <-> patient/caregiver -> both must be in the SAME
 *                                           patient's authorized network.
 */
const verifyCommunicationAccess = async (callerId, receiverId, patientId = null) => {
    try {
        if (!isUuid(callerId) || !isUuid(receiverId) || callerId === receiverId) return false;

        const [callerCentral, receiverCentral] = await Promise.all([
            isCentralCounsellor(callerId),
            isCentralCounsellor(receiverId)
        ]);

        if (callerCentral) return true;

        if (receiverCentral) {
            if (!patientId) return true;
            return verifyPatientDataEventAccess(callerId, patientId);
        }

        if (!isUuid(patientId)) return false;
        const [callerOk, receiverOk] = await Promise.all([
            verifyPatientDataEventAccess(callerId, patientId),
            verifyPatientDataEventAccess(receiverId, patientId)
        ]);
        return callerOk && receiverOk;
    } catch (error) {
        console.error('Communication auth check error:', error);
        return false;
    }
};

module.exports = {
    isCentralCounsellor,
    getCentralCounsellorUserIds,
    getPatientAccessContext,
    verifyPatientDataEventAccess,
    canManagePatientCaregivers,
    verifyCommunicationAccess
};
