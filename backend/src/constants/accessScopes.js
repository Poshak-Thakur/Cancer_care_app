/**
 * Saathi v1 canonical access-scope vocabulary.
 *
 * These scope names are the final backend/mobile authorization contract for v1.
 * Flutter may safely use these exact string values.
 *
 * Scopes live in patientaccountlink.access_scopes (SELF / DELEGATE) and
 * patientcaregiverlink.access_scopes (caregivers).
 *
 * Edit THIS file to change the vocabulary - nothing else should hard-code
 * scope names.
 *
 * `ALL` is a special full-access wildcard for patient account links
 * (SELF / DELEGATE). It is NOT a caregiver scope and must never be granted
 * to FAMILY or VOLUNTEER caregivers.
 */
const S = Object.freeze({
    ALL: 'ALL',

    // Account-level authority
    ACCOUNT_OPERATE: 'ACCOUNT_OPERATE',
    ACCOUNT_DELEGATE_MANAGE: 'ACCOUNT_DELEGATE_MANAGE',   // non-transferable
    CARE_CIRCLE_MANAGE: 'CARE_CIRCLE_MANAGE',             // non-transferable

    // Patient data
    DASHBOARD_VIEW: 'DASHBOARD_VIEW',
    SYMPTOM_VIEW: 'SYMPTOM_VIEW',
    SYMPTOM_WRITE: 'SYMPTOM_WRITE',
    MEDICATION_VIEW: 'MEDICATION_VIEW',
    MEDICATION_EDIT: 'MEDICATION_EDIT',
    DOCUMENT_VIEW: 'DOCUMENT_VIEW',
    DOCUMENT_UPLOAD: 'DOCUMENT_UPLOAD',
    CARE_EVENT_VIEW: 'CARE_EVENT_VIEW',
    CARE_EVENT_EDIT: 'CARE_EVENT_EDIT'
});

/**
 * Scopes that cannot be granted onward by a delegate or caregiver.
 *
 * These are relationship-management capabilities and remain controlled by
 * the patient/authorized backend process.
 */
const NON_TRANSFERABLE_SCOPES = Object.freeze([
    S.ACCOUNT_DELEGATE_MANAGE,
    S.CARE_CIRCLE_MANAGE
]);

/**
 * Owner-level scopes.
 *
 * These belong to patient-account management and are not granted merely
 * because a user is a FAMILY or VOLUNTEER caregiver.
 */
const OWNER_ONLY_SCOPES = Object.freeze([
    S.ACCOUNT_OPERATE,
    ...NON_TRANSFERABLE_SCOPES
]);

/**
 * Every valid scope except the wildcard.
 */
const ALL_SCOPE_NAMES = Object.freeze(
    Object.values(S).filter((s) => s !== S.ALL)
);

/**
 * Scopes an authorised user may grant to a DELEGATE through the API.
 *
 * Non-transferable relationship-management scopes are intentionally excluded.
 */
const GRANTABLE_SCOPES = Object.freeze(
    ALL_SCOPE_NAMES.filter((s) => !NON_TRANSFERABLE_SCOPES.includes(s))
);

/**
 * Least-privilege default for a new delegate.
 *
 * A newly created delegate receives only ACCOUNT_OPERATE and does not receive
 * clinical/patient-data access unless additional scopes are explicitly granted.
 */
const DEFAULT_DELEGATE_SCOPES = Object.freeze([
    S.ACCOUNT_OPERATE
]);

/**
 * Default caregiver permissions for both FAMILY and VOLUNTEER caregivers.
 *
 * FAMILY and VOLUNTEER intentionally receive the same default v1 scope set.
 * The distinction between them is caregiver_type, while NGO recognition
 * determines whether the caregiver is eligible to be linked to a patient.
 *
 * Recognition is an eligibility switch; these scopes determine capability.
 * Patient-specific access is still controlled by the scopes stored on the
 * PatientCaregiverLink and enforced by the backend on every protected request.
 *
 * Caregivers do NOT receive ALL, owner-level authority, medication editing,
 * document upload, or care-circle management by default.
 */
const DEFAULT_CAREGIVER_SCOPES = Object.freeze([
    S.DASHBOARD_VIEW,
    S.SYMPTOM_VIEW,
    S.SYMPTOM_WRITE,
    S.MEDICATION_VIEW,
    S.CARE_EVENT_VIEW,
    S.CARE_EVENT_EDIT,
    S.DOCUMENT_VIEW
]);

/**
 * Guard against accidentally editing the caregiver defaults into an
 * over-privileged or invalid set.
 */
for (const scope of DEFAULT_CAREGIVER_SCOPES) {
    if (
        scope === S.ALL ||
        OWNER_ONLY_SCOPES.includes(scope) ||
        !ALL_SCOPE_NAMES.includes(scope)
    ) {
        throw new Error(
            `DEFAULT_CAREGIVER_SCOPES contains an invalid caregiver scope: ${scope}`
        );
    }
}

module.exports = {
    SCOPES: S,
    NON_TRANSFERABLE_SCOPES,
    OWNER_ONLY_SCOPES,
    ALL_SCOPE_NAMES,
    GRANTABLE_SCOPES,
    DEFAULT_DELEGATE_SCOPES,
    DEFAULT_CAREGIVER_SCOPES
};