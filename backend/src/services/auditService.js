/**
 * AUDIT + CONSENT-HISTORY SERVICE
 * ------------------------------------------------------------------
 * The ONE place that writes auditlogentry rows for caregiver / delegate / recognition
 * changes. Uses the existing auditlogentry model (no extra table).
 *
 * Call it only AFTER a state change has succeeded, and pass the transaction client
 * (`tx`) when the change happened inside prisma.$transaction so the change and its
 * audit record commit (or roll back) together. Failed attempts are never audited as
 * successful actions because the caller only reaches this line on success.
 *
 * Every record answers: who (actor_id), what (action), on whom (payload.target_user_id),
 * for which patient (payload.patient_id), what changed (payload.scopes_before/after),
 * and when (created_at + payload.at).
 */

const AUDIT_ACTIONS = Object.freeze({
    CAREGIVER_RECOGNIZED: 'CAREGIVER_RECOGNIZED',
    CAREGIVER_RECOGNITION_REVOKED: 'CAREGIVER_RECOGNITION_REVOKED',
    CAREGIVER_LINK_CREATED: 'CAREGIVER_LINK_CREATED',
    CAREGIVER_LINK_REVOKED: 'CAREGIVER_LINK_REVOKED',
    CAREGIVER_LINK_RESCOPE: 'CAREGIVER_LINK_RESCOPE',
    DELEGATE_CREATED: 'DELEGATE_CREATED',
    DELEGATE_RESCOPED: 'DELEGATE_RESCOPED',
    DELEGATE_REVOKED: 'DELEGATE_REVOKED',
    // NGO web
    PATIENT_CREATED: 'PATIENT_CREATED',
    PATIENT_UPDATED: 'PATIENT_UPDATED',
    CASE_NOTE_CREATED: 'CASE_NOTE_CREATED',
    DOCUMENT_FILE_ACCESSED: 'DOCUMENT_FILE_ACCESSED',
    PRESCRIPTION_FILE_ACCESSED: 'PRESCRIPTION_FILE_ACCESSED',
    // Community
    COMMUNITY_REPORT_CREATED: 'COMMUNITY_REPORT_CREATED',
    COMMUNITY_REPORT_REVIEWED: 'COMMUNITY_REPORT_REVIEWED',
    COMMUNITY_POST_MODERATED: 'COMMUNITY_POST_MODERATED',
    // Manual Help Now
    HELP_NOW_CREATED: 'HELP_NOW_CREATED',
    HELP_NOW_CANCELLED: 'HELP_NOW_CANCELLED',
    // Alert lifecycle (NGO staff)
    ALERT_STATUS_CHANGED: 'ALERT_STATUS_CHANGED',
    // Document verification
    DOCUMENT_VERIFICATION_CHANGED: 'DOCUMENT_VERIFICATION_CHANGED',
    MEDICATION_VERIFICATION_CHANGED: 'MEDICATION_VERIFICATION_CHANGED',
    // Patient claim flow (the claim CODE itself is never written to audit payloads)
    PATIENT_CLAIM_CODE_CREATED: 'PATIENT_CLAIM_CODE_CREATED',
    PATIENT_CLAIMED: 'PATIENT_CLAIMED',
    // Dynamic Today's Check-in form (no patient data is ever put in these payloads)
    CHECKIN_FORM_CREATED: 'CHECKIN_FORM_CREATED',
    CHECKIN_DRAFT_CREATED: 'CHECKIN_DRAFT_CREATED',
    CHECKIN_FIELD_ADDED: 'CHECKIN_FIELD_ADDED',
    CHECKIN_FIELD_UPDATED: 'CHECKIN_FIELD_UPDATED',
    CHECKIN_FIELD_REMOVED: 'CHECKIN_FIELD_REMOVED',
    CHECKIN_VERSION_PUBLISHED: 'CHECKIN_VERSION_PUBLISHED',
    CHECKIN_VERSION_ARCHIVED: 'CHECKIN_VERSION_ARCHIVED'
});

const RESOURCES = Object.freeze({
    CAREGIVER_PROFILE: 'caregiverprofile',
    CAREGIVER_LINK: 'patientcaregiverlink',
    ACCOUNT_LINK: 'patientaccountlink',
    INVITE: 'caregiverinvite',
    PATIENT: 'patient',
    CASE_NOTE: 'patientcasenote',
    DOCUMENT: 'medicaldocument',
    PRESCRIPTION: 'prescription',
    MEDICATION: 'patientmedication',
    COMMUNITY_POST: 'communitypost',
    COMMUNITY_REPORT: 'communityreport',
    ALERT: 'alert',
    CHECKIN_FORM: 'checkinform',
    CHECKIN_VERSION: 'checkinformversion',
    CHECKIN_FIELD: 'checkinfield'
});

/**
 * @param {object} client  prisma or a transaction client
 * @param {object} entry
 *   actorId         user who performed the action
 *   action          one of AUDIT_ACTIONS
 *   targetResource  one of RESOURCES
 *   targetId        id of the row that changed (uuid)
 *   targetUserId    the user the action was about
 *   patientId       patient involved, if any
 *   scopesBefore / scopesAfter  for scope changes
 *   extra           any additional JSON-safe fields
 *   req             optional express request (captures ip + user agent)
 */
const recordAudit = (client, {
    actorId, action, targetResource, targetId, targetUserId = null, patientId = null,
    scopesBefore, scopesAfter, extra = {}, req = null
}) => {
    if (!Object.values(AUDIT_ACTIONS).includes(action)) {
        throw new Error(`Unknown audit action: ${action}`);
    }
    const payload = {
        target_user_id: targetUserId,
        patient_id: patientId,
        at: new Date().toISOString(),
        ...(scopesBefore !== undefined ? { scopes_before: scopesBefore } : {}),
        ...(scopesAfter !== undefined ? { scopes_after: scopesAfter } : {}),
        ...extra
    };
    return client.auditlogentry.create({
        data: {
            actor_id: actorId,
            target_resource: targetResource,
            target_id: targetId,
            action,
            payload,
            ip_address: req && req.ip ? String(req.ip).slice(0, 45) : null,
            user_agent: req && typeof req.get === 'function' ? (req.get('user-agent') || null) : null
        }
    });
};

/**
 * CONSENT HISTORY (consentrecord)
 * ------------------------------------------------------------------
 * One consentrecord row per (patient, grantee, data_scope). The patient-specific links
 * (patientaccountlink / patientcaregiverlink) stay the source of truth for ACCESS; the
 * consentrecord rows are the dependable HISTORY of who granted which scope to whom and when.
 *
 *   syncConsentRecords   after a grant / re-grant / rescope: scopes no longer granted are marked
 *                        REVOKED (history kept), newly granted scopes get a GRANTED row attributed
 *                        to the actual grantor. Scopes that stay granted are left untouched.
 *   revokeConsentRecords after a link is revoked: every active row is marked REVOKED.
 *
 * NGO recognition is an eligibility switch and must NEVER call these.
 * Always call inside the same transaction as the link change.
 */
const syncConsentRecords = async (client, { patientId, granteeId, grantedBy, scopes }) => {
    const wanted = [...new Set((Array.isArray(scopes) ? scopes : []).filter((s) => typeof s === 'string'))];
    const active = await client.consentrecord.findMany({
        where: { patient_id: patientId, grantee_id: granteeId, status: 'GRANTED', revoked_at: null }
    });
    const now = new Date();
    const activeScopes = new Set(active.map((r) => r.data_scope));

    const toRevoke = active.filter((r) => !wanted.includes(r.data_scope));
    if (toRevoke.length > 0) {
        await client.consentrecord.updateMany({
            where: { id: { in: toRevoke.map((r) => r.id) } },
            data: { status: 'REVOKED', revoked_at: now }
        });
    }

    const toGrant = wanted.filter((s) => !activeScopes.has(s));
    for (const scope of toGrant) {
        await client.consentrecord.create({
            data: {
                patient_id: patientId,
                grantee_id: granteeId,
                data_scope: scope,
                status: 'GRANTED',
                granted_by: grantedBy,
                granted_at: now
            }
        });
    }
    return { granted: toGrant, revoked: toRevoke.map((r) => r.data_scope) };
};

const revokeConsentRecords = async (client, { patientId, granteeId }) => {
    const result = await client.consentrecord.updateMany({
        where: { patient_id: patientId, grantee_id: granteeId, status: 'GRANTED', revoked_at: null },
        data: { status: 'REVOKED', revoked_at: new Date() }
    });
    return result.count;
};

module.exports = { recordAudit, AUDIT_ACTIONS, RESOURCES, syncConsentRecords, revokeConsentRecords };
