const prisma = require('../config/db');

const { isUuid, normalizeLabel } = require('../utils/validators');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');

const {
    canManagePatientDelegates,
    getPatientAccessContext,
    contextHasScope,
    isCentralCounsellor
} = require('../services/authorizationService');

const {
    ALL_SCOPE_NAMES,
    NON_TRANSFERABLE_SCOPES,
    DEFAULT_DELEGATE_SCOPES
} = require('../constants/accessScopes');

/**
 * POST /api/patients - registers the caller's OWN patient record (relationship SELF).
 *
 * This endpoint can ONLY create SELF. Delegates are never created here (and never receive
 * access_scopes ['ALL']); they are added through POST /api/patients/:patient_id/delegates,
 * which validates scopes against the grantor.
 */
exports.createPatientProfile = async (req, res, next) => {
    try {
        const {
            full_name, date_of_birth, preferred_language = 'en', cancer_type,
            cancer_stage, diagnosis_date, care_plan_summary,
            relationship_type, relationship_label
        } = req.body;

        if (relationship_type !== undefined && relationship_type !== null &&
            String(relationship_type).trim().toUpperCase() !== 'SELF') {
            return res.status(400).json({
                status: 'error',
                code: 'DELEGATE_NOT_ALLOWED_HERE',
                message: 'POST /api/patients only creates a SELF patient profile. Add delegates with POST /api/patients/:patient_id/delegates.'
            });
        }

        const checkedLabel = normalizeLabel(relationship_label, 'Self');
        if (checkedLabel.error) return res.status(400).json({ status: 'error', message: checkedLabel.error });

        const userId = req.user.userId;

        if (!full_name || !date_of_birth) {
            return res.status(400).json({ status: 'error', message: 'full_name and date_of_birth are required.' });
        }

        const existingLink = await prisma.patientaccountlink.findFirst({
            where: { user_id: userId, relationship_type: 'SELF' },
            include: { patient: true }
        });

        if (existingLink) {
            return res.status(409).json({
                status: 'error',
                message: 'A SELF patient profile already exists for this account.',
                data: { patient: existingLink.patient, link: existingLink }
            });
        }

        const result = await prisma.$transaction(async (tx) => {
            const newPatient = await tx.patient.create({
                data: {
                    full_name,
                    date_of_birth: new Date(date_of_birth),
                    preferred_language,
                    cancer_type: cancer_type || null,
                    cancer_stage: cancer_stage || null,
                    diagnosis_date: diagnosis_date ? new Date(diagnosis_date) : null,
                    care_plan_summary: care_plan_summary || null
                }
            });

            const link = await tx.patientaccountlink.create({
                data: {
                    user_id: userId,
                    patient_id: newPatient.id,
                    relationship_type: 'SELF',
                    relationship_label: checkedLabel.value,
                    access_scopes: ['ALL'], // the patient's own account, never a delegate
                    consent_status: 'GRANTED',
                    granted_by: userId
                }
            });
            return { patient: newPatient, link };
        });

        return res.status(201).json({ status: 'success', data: result });
    } catch (error) {
        next(error);
    }
};

exports.getMyPatients = async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const links = await prisma.patientaccountlink.findMany({
            where: {
                user_id: userId,
                relationship_type: { in: ['SELF', 'DELEGATE'] },
                consent_status: 'GRANTED',
                revoked_at: null
            },
            include: {
                patient: true
            }
        });

        return res.status(200).json({
            status: 'success',
            data: links.map(link => ({
                relationship_type: link.relationship_type,
                relationship_label: link.relationship_label,
                access_scopes: link.access_scopes,
                patient: link.patient
            }))
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Validates a requested scope list against the canonical vocabulary.
 * Returns { scopes } or { error: { status, message, code, data? } }.
 *   - unknown names are rejected (nothing arbitrary reaches the database)
 *   - 'ALL' and the non-transferable scopes can never be handed out through this API
 */
const validateRequestedScopes = (raw) => {
    if (!Array.isArray(raw) || raw.length === 0) {
        return { error: { status: 400, code: 'INVALID_SCOPES', message: 'access_scopes must be a non-empty array of scope names.' } };
    }
    if (raw.some((x) => typeof x !== 'string' || x.trim() === '')) {
        return { error: { status: 400, code: 'INVALID_SCOPES', message: 'Every access scope must be a non-empty string.' } };
    }
    const scopes = [...new Set(raw.map((x) => x.trim()))];

    const nonTransferable = scopes.filter((x) => NON_TRANSFERABLE_SCOPES.includes(x) || x === 'ALL');
    if (nonTransferable.length > 0) {
        return { error: { status: 400, code: 'NON_TRANSFERABLE_SCOPE', message: 'These scopes cannot be granted to a delegate.', data: { scopes: nonTransferable } } };
    }
    const unknown = scopes.filter((x) => !ALL_SCOPE_NAMES.includes(x));
    if (unknown.length > 0) {
        return { error: { status: 400, code: 'UNKNOWN_SCOPE', message: 'Unknown access scope(s).', data: { unknown_scopes: unknown, valid_scopes: ALL_SCOPE_NAMES } } };
    }
    return { scopes };
};

const sendScopeError = (res, error) =>
    res.status(error.status).json({
        status: 'error',
        code: error.code,
        message: error.message,
        ...(error.data ? { data: error.data } : {})
    });

// A non-central grantor may only hand on scopes they currently hold themselves.
// Returns the offending scopes (empty array = fine).
const scopesBeyondGrantor = async (grantorId, patientId, scopes) => {
    if (await isCentralCounsellor(grantorId)) return [];
    const ctx = await getPatientAccessContext(grantorId, patientId);
    return scopes.filter((scope) => !contextHasScope(ctx, scope));
};

/**
 * Add a DELEGATE to an existing patient record (or RESTORE a revoked one).
 *
 * POST /api/patients/:patient_id/delegates
 * Body: { "user_id": "<UUID>", "relationship_label": "Daughter", "access_scopes": ["ACCOUNT_OPERATE"] }
 *
 * Caller: central NGO, or a SELF/DELEGATE account holder with ACCOUNT_DELEGATE_MANAGE.
 * Default scopes = ["ACCOUNT_OPERATE"] (least privilege; no clinical access until scopes are granted).
 */
exports.addPatientDelegate = async (req, res, next) => {
    try {
        const patientId = req.params.patient_id;
        const grantorId = req.user.userId;
        const { user_id: delegateUserId, relationship_label, access_scopes } = req.body;

        if (!isUuid(patientId)) return res.status(400).json({ status: 'error', message: 'Invalid patient_id.' });
        if (!isUuid(delegateUserId)) return res.status(400).json({ status: 'error', message: 'user_id must be a valid UUID.' });
        if (grantorId === delegateUserId) {
            return res.status(400).json({ status: 'error', message: 'A user cannot add themselves as their own delegate.' });
        }

        if (!(await canManagePatientDelegates(grantorId, patientId))) {
            return res.status(403).json({ status: 'error', message: 'You are not authorized to manage delegates for this patient.' });
        }

        const checkedLabel = normalizeLabel(relationship_label, undefined);
        if (checkedLabel.error) return res.status(400).json({ status: 'error', message: checkedLabel.error });

        const patient = await prisma.patient.findUnique({ where: { id: patientId } });
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const delegateUser = await prisma.useraccount.findUnique({ where: { id: delegateUserId } });
        if (!delegateUser) return res.status(404).json({ status: 'error', message: 'Delegate user account not found.' });

        // Scopes: canonical list only; default is least-privilege.
        let finalScopes = [...DEFAULT_DELEGATE_SCOPES];
        if (access_scopes !== undefined) {
            const checked = validateRequestedScopes(access_scopes);
            if (checked.error) return sendScopeError(res, checked.error);
            finalScopes = checked.scopes;
        }

        const beyond = await scopesBeyondGrantor(grantorId, patientId, finalScopes);
        if (beyond.length > 0) {
            return res.status(403).json({
                status: 'error',
                code: 'SCOPE_ESCALATION',
                message: 'You cannot grant access scopes that you do not possess.',
                data: { unauthorized_scopes: beyond }
            });
        }

        const existingLink = await prisma.patientaccountlink.findFirst({
            where: { user_id: delegateUserId, patient_id: patientId }
        });

        if (existingLink) {
            // Active link (SELF or DELEGATE) -> duplicate. A revoked SELF link is never restorable here.
            const existingActive = existingLink.consent_status === 'GRANTED' && existingLink.revoked_at === null;
            if (existingActive || existingLink.relationship_type !== 'DELEGATE') {
                return res.status(409).json({
                    status: 'error',
                    code: 'LINK_EXISTS',
                    message: 'This user already has a patient account link for this patient.',
                    data: { link: existingLink }
                });
            }

            // Revoked DELEGATE -> restore with exactly the newly validated scopes (never the old ones).
            const restored = await prisma.$transaction(async (tx) => {
                const row = await tx.patientaccountlink.update({
                    where: { id: existingLink.id },
                    data: {
                        consent_status: 'GRANTED',
                        revoked_at: null,
                        relationship_label: checkedLabel.value || existingLink.relationship_label || 'Delegate',
                        access_scopes: finalScopes,
                        granted_by: grantorId,
                        granted_at: new Date()
                    }
                });
                await recordAudit(tx, {
                    actorId: grantorId,
                    action: AUDIT_ACTIONS.DELEGATE_CREATED,
                    targetResource: RESOURCES.ACCOUNT_LINK,
                    targetId: row.id,
                    targetUserId: delegateUserId,
                    patientId,
                    scopesBefore: Array.isArray(existingLink.access_scopes) ? existingLink.access_scopes : [],
                    scopesAfter: finalScopes,
                    extra: { restored: true },
                    req
                });
                return row;
            });
            return res.status(200).json({
                status: 'success',
                message: 'Delegate restored successfully.',
                data: { patient, link: restored }
            });
        }

        const link = await prisma.$transaction(async (tx) => {
            const row = await tx.patientaccountlink.create({
                data: {
                    user_id: delegateUserId,
                    patient_id: patientId,
                    relationship_type: 'DELEGATE',
                    relationship_label: checkedLabel.value || 'Delegate',
                    access_scopes: finalScopes,
                    consent_status: 'GRANTED',
                    granted_by: grantorId
                }
            });
            await recordAudit(tx, {
                actorId: grantorId,
                action: AUDIT_ACTIONS.DELEGATE_CREATED,
                targetResource: RESOURCES.ACCOUNT_LINK,
                targetId: row.id,
                targetUserId: delegateUserId,
                patientId,
                scopesBefore: [],
                scopesAfter: finalScopes,
                extra: { restored: false },
                req
            });
            return row;
        });

        return res.status(201).json({ status: 'success', message: 'Delegate added successfully.', data: { patient, link } });
    } catch (error) {
        next(error);
    }
};

/**
 * Rescope / relabel an ACTIVE delegate.
 * PATCH /api/patients/:patient_id/delegates/:user_id
 * Body: { "access_scopes": [...], "relationship_label": "..." }  (either field optional)
 */
exports.updatePatientDelegate = async (req, res, next) => {
    try {
        const { patient_id: patientId, user_id: delegateUserId } = req.params;
        const grantorId = req.user.userId;
        const { access_scopes, relationship_label } = req.body;

        if (!isUuid(patientId) || !isUuid(delegateUserId)) {
            return res.status(400).json({ status: 'error', message: 'patient_id and user_id must be valid UUIDs.' });
        }
        if (access_scopes === undefined && relationship_label === undefined) {
            return res.status(400).json({ status: 'error', message: 'Provide access_scopes and/or relationship_label.' });
        }
        // Nobody rescopes their own link (would be a self-escalation path).
        if (grantorId === delegateUserId) {
            return res.status(403).json({ status: 'error', message: 'You cannot change your own access scopes.' });
        }
        if (!(await canManagePatientDelegates(grantorId, patientId))) {
            return res.status(403).json({ status: 'error', message: 'You are not authorized to manage delegates for this patient.' });
        }

        const link = await prisma.patientaccountlink.findFirst({
            where: { user_id: delegateUserId, patient_id: patientId, relationship_type: 'DELEGATE', consent_status: 'GRANTED', revoked_at: null }
        });
        if (!link) return res.status(404).json({ status: 'error', message: 'Active delegate not found for this patient.' });

        const data = {};
        if (access_scopes !== undefined) {
            const checked = validateRequestedScopes(access_scopes);
            if (checked.error) return sendScopeError(res, checked.error);

            const beyond = await scopesBeyondGrantor(grantorId, patientId, checked.scopes);
            if (beyond.length > 0) {
                return res.status(403).json({
                    status: 'error',
                    code: 'SCOPE_ESCALATION',
                    message: 'You cannot grant access scopes that you do not possess.',
                    data: { unauthorized_scopes: beyond }
                });
            }
            data.access_scopes = checked.scopes;
        }
        if (relationship_label !== undefined) {
            const checkedLabel = normalizeLabel(relationship_label, link.relationship_label || 'Delegate');
            if (checkedLabel.error) return res.status(400).json({ status: 'error', message: checkedLabel.error });
            data.relationship_label = checkedLabel.value;
        }

        const updated = await prisma.$transaction(async (tx) => {
            const row = await tx.patientaccountlink.update({ where: { id: link.id }, data });
            // Scope changes are audited; a label-only change is not a privilege change.
            if (data.access_scopes) {
                await recordAudit(tx, {
                    actorId: grantorId,
                    action: AUDIT_ACTIONS.DELEGATE_RESCOPED,
                    targetResource: RESOURCES.ACCOUNT_LINK,
                    targetId: row.id,
                    targetUserId: delegateUserId,
                    patientId,
                    scopesBefore: Array.isArray(link.access_scopes) ? link.access_scopes : [],
                    scopesAfter: data.access_scopes,
                    req
                });
            }
            return row;
        });
        return res.status(200).json({ status: 'success', message: 'Delegate updated.', data: { link: updated } });
    } catch (error) { next(error); }
};

/**
 * Revoke a delegate. Takes effect on the very next request (every check reads the link fresh).
 * DELETE /api/patients/:patient_id/delegates/:user_id
 * Allowed: central NGO, an account holder with ACCOUNT_DELEGATE_MANAGE, or the delegate removing themselves.
 * A SELF link can never be revoked through this endpoint.
 */
exports.revokePatientDelegate = async (req, res, next) => {
    try {
        const { patient_id: patientId, user_id: delegateUserId } = req.params;
        const actorId = req.user.userId;

        if (!isUuid(patientId) || !isUuid(delegateUserId)) {
            return res.status(400).json({ status: 'error', message: 'patient_id and user_id must be valid UUIDs.' });
        }

        const isSelfRemoval = actorId === delegateUserId;
        if (!isSelfRemoval && !(await canManagePatientDelegates(actorId, patientId))) {
            return res.status(403).json({ status: 'error', message: 'You are not authorized to manage delegates for this patient.' });
        }

        const link = await prisma.patientaccountlink.findFirst({
            where: { user_id: delegateUserId, patient_id: patientId, relationship_type: 'DELEGATE', consent_status: 'GRANTED', revoked_at: null }
        });
        if (!link) return res.status(404).json({ status: 'error', message: 'Active delegate not found for this patient.' });

        await prisma.$transaction(async (tx) => {
            await tx.patientaccountlink.update({
                where: { id: link.id },
                data: { consent_status: 'REVOKED', revoked_at: new Date() }
            });
            await recordAudit(tx, {
                actorId,
                action: AUDIT_ACTIONS.DELEGATE_REVOKED,
                targetResource: RESOURCES.ACCOUNT_LINK,
                targetId: link.id,
                targetUserId: delegateUserId,
                patientId,
                scopesBefore: Array.isArray(link.access_scopes) ? link.access_scopes : [],
                scopesAfter: [],
                extra: { self_removal: isSelfRemoval },
                req
            });
        });

        return res.status(200).json({ status: 'success', message: 'Delegate access revoked.' });
    } catch (error) { next(error); }
};
