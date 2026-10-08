const prisma = require('../config/db');
const { isUuid } = require('../utils/validators');
const { SCOPES, OWNER_ONLY_SCOPES } = require('../constants/accessScopes');

/**
 * CANONICAL AUTHORIZATION MODEL
 * ------------------------------------------------------------------
 * The NGO head and the NGO counsellor are ONE central account. Any active
 * staffprofile whose roles contain COUNSELLOR or ADMIN is that central
 * authority and has global access. There is deliberately NO per-patient staff
 * logic (staffassignment is not consulted for access decisions).
 *
 * Everyone else gets access to a patient only through:
 *   - an active patientaccountlink (SELF / DELEGATE)  -> role PATIENT
 *   - an active patientcaregiverlink + recognised caregiver -> role CAREGIVER
 *
 * Precedence: 1. central NGO  2. SELF / DELEGATE  3. CAREGIVER  4. no access.
 *
 * Access = relationship (above) + ACTIVE (consent_status GRANTED AND revoked_at NULL)
 *          + the SCOPE the operation needs (see constants/accessScopes.js).
 * Revoking a link takes effect on the very next request: every check below reads
 * the link fresh from the database.
 *
 * CAREGIVER RULE: a caregiver link only counts while the caregiver's own CaregiverProfile is
 * NGO-recognised (ngo_recognition_status = RECOGNIZED). Recognition decides ELIGIBILITY,
 * the link's access_scopes decide CAPABILITY. This is enforced ONLY here (findActiveCaregiverLink
 * / listActiveCaregiverLinks), never per controller. FAMILY and VOLUNTEER follow the same access rule
 * (a VOLUNTEER can additionally never manage the care circle - see canManagePatientCaregivers).
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

// "Active" = consent granted AND never revoked (defence in depth: both must agree).
const ACTIVE_LINK = Object.freeze({ consent_status: 'GRANTED', revoked_at: null });

// Active patient-account link (SELF / DELEGATE) or null. Revoked links never count.
const findActivePatientAccountLink = (userId, patientId) =>
    prisma.patientaccountlink.findFirst({
        where: {
            user_id: userId,
            patient_id: patientId,
            relationship_type: { in: PATIENT_LINK_TYPES },
            ...ACTIVE_LINK
        }
    });

// Is this user an NGO-recognised caregiver?
const isRecognizedCaregiver = async (userId, client = prisma) => {
    if (!isUuid(userId)) return false;
    const profile = await client.caregiverprofile.findUnique({
        where: { user_id: userId },
        select: { ngo_recognition_status: true }
    });
    return !!profile && profile.ngo_recognition_status === 'RECOGNIZED';
};

// Active caregiver link or null. NOT_RECOGNIZED caregivers never have an active link,
// whatever their patientcaregiverlink row says.
const findActiveCaregiverLink = async (userId, patientId) => {
    if (!(await isRecognizedCaregiver(userId))) return null;
    return prisma.patientcaregiverlink.findFirst({
        where: { caregiver_user_id: userId, patient_id: patientId, ...ACTIVE_LINK }
    });
};

// Every active, recognised caregiver link of a patient (alerts, chat contacts, ...).
const listActiveCaregiverLinks = async (patientId, client = prisma) => {
    const links = await client.patientcaregiverlink.findMany({
        where: { patient_id: patientId, ...ACTIVE_LINK }
    });
    if (links.length === 0) return [];
    const recognized = await client.caregiverprofile.findMany({
        where: {
            user_id: { in: links.map((l) => l.caregiver_user_id) },
            ngo_recognition_status: 'RECOGNIZED'
        },
        select: { user_id: true }
    });
    const ok = new Set(recognized.map((p) => p.user_id));
    return links.filter((l) => ok.has(l.caregiver_user_id));
};

// Every active SELF / DELEGATE account holder of a patient (oldest grant first).
const listActiveAccountLinks = (patientId, client = prisma) =>
    client.patientaccountlink.findMany({
        where: { patient_id: patientId, relationship_type: { in: PATIENT_LINK_TYPES }, ...ACTIVE_LINK },
        orderBy: { granted_at: 'asc' }
    });

const toScopeArray = (value) =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];

/**
 * Does a scope list satisfy `required` for this role?
 *   - exact match always satisfies
 *   - 'ALL' satisfies everything for the patient's own account (PATIENT)
 *   - for a CAREGIVER the 'ALL' wildcard is NEVER honoured: caregivers hold explicit scopes only
 */
const scopesSatisfy = (role, scopes, required) => {
    if (!required) return true;
    if (scopes.includes(required)) return true;
    if (role === 'CAREGIVER') return false;
    return scopes.includes(SCOPES.ALL);
};

/**
 * Resolves HOW a user may access a patient.
 * Returns { role, link, scopes } or null when there is no access.
 *   role: 'STAFF' (central NGO) | 'PATIENT' | 'CAREGIVER'
 * Precedence: 1. central NGO  2. SELF / DELEGATE  3. CAREGIVER (recognised)  4. none.
 * The central NGO account therefore always resolves as the central authority and is never
 * narrowed by an incidental account or caregiver link.
 */
const getPatientAccessContext = async (userId, patientId) => {
    if (!isUuid(userId) || !isUuid(patientId)) return null;

    if (await isCentralCounsellor(userId)) {
        return {
            role: 'STAFF',
            link: {
                staff_user_id: userId,
                role: 'COUNSELLOR',
                relationship_label: 'NGO Counsellor',
                access_scopes: [SCOPES.ALL]
            },
            scopes: [SCOPES.ALL]
        };
    }

    const accountLink = await findActivePatientAccountLink(userId, patientId);
    if (accountLink) {
        return { role: 'PATIENT', link: accountLink, scopes: toScopeArray(accountLink.access_scopes) };
    }

    const caregiverLink = await findActiveCaregiverLink(userId, patientId);
    if (caregiverLink) {
        return { role: 'CAREGIVER', link: caregiverLink, scopes: toScopeArray(caregiverLink.access_scopes) };
    }

    return null;
};

// Central NGO has every scope; everyone else is judged by their active link's scopes.
const contextHasScope = (ctx, requiredScope) => {
    if (!ctx) return false;
    if (ctx.role === 'STAFF') return true;
    return scopesSatisfy(ctx.role, ctx.scopes, requiredScope);
};

/**
 * THE scope-checking helper. Returns the access context when the user holds an
 * ACTIVE relationship to the patient AND the required scope, otherwise null.
 * Controllers ask for the specific capability they need.
 */
const requirePatientScope = async (userId, patientId, requiredScope) => {
    const ctx = await getPatientAccessContext(userId, patientId);
    return contextHasScope(ctx, requiredScope) ? ctx : null;
};

// Relationship-level access only (is the user in this patient's network at all?).
// Use requirePatientScope() for anything that reads or writes patient data.
const verifyPatientDataEventAccess = async (userId, patientId) => {
    const ctx = await getPatientAccessContext(userId, patientId);
    return !!ctx;
};

/**
 * May this user add / remove / rescope the patient's care circle (caregivers)?
 * Requires CARE_CIRCLE_MANAGE:
 *   - central NGO                -> always
 *   - SELF / DELEGATE            -> link must hold CARE_CIRCLE_MANAGE (or ALL)
 *   - FAMILY caregiver           -> only if CARE_CIRCLE_MANAGE was explicitly granted
 *   - VOLUNTEER caregiver        -> never
 * A plain SELF/DELEGATE relationship (e.g. ACCOUNT_OPERATE only) is NOT enough.
 */
const canManagePatientCaregivers = async (userId, patientId) => {
    if (!isUuid(userId) || !isUuid(patientId)) return false;

    if (await isCentralCounsellor(userId)) return true;

    const accountLink = await findActivePatientAccountLink(userId, patientId);
    if (accountLink) {
        return scopesSatisfy('PATIENT', toScopeArray(accountLink.access_scopes), SCOPES.CARE_CIRCLE_MANAGE);
    }

    // findActiveCaregiverLink already requires NGO recognition.
    const caregiverLink = await findActiveCaregiverLink(userId, patientId);
    if (caregiverLink) {
        const profile = await prisma.caregiverprofile.findUnique({ where: { user_id: userId } });
        if (profile?.caregiver_type === 'VOLUNTEER') return false;
        return toScopeArray(caregiverLink.access_scopes).includes(SCOPES.CARE_CIRCLE_MANAGE);
    }
    return false;
};

/**
 * Determines whether a user may add/manage DELEGATE links
 * for a patient.
 *
 * Rules:
 * - Central NGO account: allowed.
 * - SELF/DELEGATE account: must have ACCOUNT_DELEGATE_MANAGE.
 * - ACCOUNT_DELEGATE_MANAGE is non-transferable.
 * - CARE_CIRCLE_MANAGE is unrelated and must not grant
 *   delegate-management authority.
 */
const canManagePatientDelegates = async (userId, patientId) => {
    if (!isUuid(userId) || !isUuid(patientId)) return false;

    // Central NGO authority can manage delegates globally.
    if (await isCentralCounsellor(userId)) {
        return true;
    }

    const link = await findActivePatientAccountLink(userId, patientId);

    if (!link) return false;

    return scopesSatisfy('PATIENT', toScopeArray(link.access_scopes), SCOPES.ACCOUNT_DELEGATE_MANAGE);
};

/**
 * May callerId communicate with receiverId?
 *
 * Communication rules:
 *
 * 1. Central NGO -> central NGO
 *      ALLOW
 *
 * 2. Central NGO -> non-central user
 *      patient_id = null -> general helpline, ALLOW
 *      patient_id supplied -> receiver must have access to that patient.
 *
 * 3. Non-central user -> central NGO
 *      patient_id = null
 *          -> general NGO helpline, ALLOW
 *
 *      patient_id supplied
 *          -> caller must have access to that patient.
 *
 * 4. Non-central user -> non-central user
 *      patient_id is REQUIRED.
 *      Both users must have access to the SAME patient.
 */
const verifyCommunicationAccess = async (
    callerId,
    receiverId,
    patientId = null
) => {
    try {
        if (
            !isUuid(callerId) ||
            !isUuid(receiverId) ||
            callerId === receiverId
        ) {
            return false;
        }

        const [callerCentral, receiverCentral] = await Promise.all([
            isCentralCounsellor(callerId),
            isCentralCounsellor(receiverId)
        ]);

        /*
         * --------------------------------------------------------------
         * CENTRAL NGO -> CENTRAL NGO
         * --------------------------------------------------------------
         */
        if (callerCentral && receiverCentral) {
            return true;
        }

        /*
         * --------------------------------------------------------------
         * CENTRAL NGO -> NON-CENTRAL USER
         *
         * patient_id = null  -> general helpline, ALLOW (two-way).
         * patient_id supplied -> the receiver must have access to THAT patient.
         *
         * Example that MUST fail:
         *
         * NGO
         *   -> Patient B
         *      patient_id = Patient A
         *
         * because the receiver may not belong to Patient A's network.
         * --------------------------------------------------------------
         */
        if (callerCentral && !receiverCentral) {
            // patient_id = null -> general helpline (two-way, same as user -> NGO).
            if (!patientId) {
                return true;
            }
            if (!isUuid(patientId)) {
                return false;
            }

            return verifyPatientDataEventAccess(
                receiverId,
                patientId
            );
        }

        /*
         * --------------------------------------------------------------
         * NON-CENTRAL USER -> CENTRAL NGO
         *
         * patient_id = null
         * means the general NGO helpline.
         *
         * If patient_id is supplied, verify that the caller is
         * actually authorized for that patient.
         * --------------------------------------------------------------
         */
        if (!callerCentral && receiverCentral) {
            if (!patientId) {
                return true;
            }

            if (!isUuid(patientId)) {
                return false;
            }

            return verifyPatientDataEventAccess(
                callerId,
                patientId
            );
        }

        /*
         * --------------------------------------------------------------
         * NON-CENTRAL USER -> NON-CENTRAL USER
         *
         * Both sides must belong to the SAME patient context.
         * --------------------------------------------------------------
         */
        if (!isUuid(patientId)) {
            return false;
        }

        const [callerOk, receiverOk] = await Promise.all([
            verifyPatientDataEventAccess(
                callerId,
                patientId
            ),
            verifyPatientDataEventAccess(
                receiverId,
                patientId
            )
        ]);

        return callerOk && receiverOk;

    } catch (error) {
        console.error(
            'Communication auth check error:',
            error
        );

        return false;
    }
};

module.exports = {
    isCentralCounsellor,
    getCentralCounsellorUserIds,
    getPatientAccessContext,
    contextHasScope,
    requirePatientScope,
    verifyPatientDataEventAccess,
    isRecognizedCaregiver,
    findActiveCaregiverLink,
    listActiveCaregiverLinks,
    listActiveAccountLinks,
    ACTIVE_LINK,
    canManagePatientCaregivers,
    canManagePatientDelegates,
    verifyCommunicationAccess
};
