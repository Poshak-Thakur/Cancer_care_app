/**
 * AUDIT SERVICE
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
    DELEGATE_REVOKED: 'DELEGATE_REVOKED'
});

const RESOURCES = Object.freeze({
    CAREGIVER_PROFILE: 'caregiverprofile',
    CAREGIVER_LINK: 'patientcaregiverlink',
    ACCOUNT_LINK: 'patientaccountlink'
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

module.exports = { recordAudit, AUDIT_ACTIONS, RESOURCES };
