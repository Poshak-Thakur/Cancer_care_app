const prisma = require('../config/db');

const { isUuid, normalizeLabel } = require('../utils/validators');
const HttpError = require('../utils/httpError');
const { parsePatientBody } = require('../utils/patientFields');
const { lockUserSelf, lockPatientSelf } = require('../services/patientSelfLockService');
const { recordAudit, AUDIT_ACTIONS, RESOURCES, syncConsentRecords, revokeConsentRecords } = require('../services/auditService');

const {
    canManagePatientDelegates,
    getPatientAccessContext,
    contextHasScope,
    isCentralCounsellor
} = require('../services/authorizationService');

const {
    SCOPES,
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
        const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : null;
        if (!body) return res.status(400).json({ status: 'error', message: 'Request body must be a JSON object.' });

        // Relationship fields belong to this endpoint's own logic; everything else is a patient field.
        const { relationship_type, relationship_label, ...patientBody } = body;

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

        if (!patientBody.full_name || !patientBody.date_of_birth) {
            return res.status(400).json({ status: 'error', message: 'full_name and date_of_birth are required.' });
        }

        // Same field rules as the NGO portal and PATCH /api/patients/:id (valid dates, no future dates,
        // unknown fields rejected) so bad input is a clean 400, never a Prisma 500.
        const parsed = parsePatientBody(patientBody, { requireAll: true });
        if (parsed.error) return res.status(400).json({ status: 'error', message: parsed.error });

        const outcome = await prisma.$transaction(async (tx) => {
            // Lock FIRST, check SECOND: two simultaneous registrations of one account are serialised here,
            // so the second one sees the first one's SELF link.
            await lockUserSelf(tx, userId);

            const existingLink = await tx.patientaccountlink.findFirst({
                where: { user_id: userId, relationship_type: 'SELF' },
                include: { patient: true }
            });
            if (existingLink) return { conflict: existingLink };

            const newPatient = await tx.patient.create({
                data: {
                    full_name: parsed.data.full_name,
                    date_of_birth: parsed.data.date_of_birth,
                    preferred_language: parsed.data.preferred_language || 'en',
                    cancer_type: parsed.data.cancer_type || null,
                    cancer_stage: parsed.data.cancer_stage || null,
                    diagnosis_date: parsed.data.diagnosis_date || null,
                    care_plan_summary: parsed.data.care_plan_summary || null
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
            return { created: { patient: newPatient, link } };
        });

        if (outcome.conflict) {
            return res.status(409).json({
                status: 'error',
                message: 'A SELF patient profile already exists for this account.',
                data: { patient: outcome.conflict.patient, link: outcome.conflict }
            });
        }
        return res.status(201).json({ status: 'success', data: outcome.created });
    } catch (error) {
        // DB backstop (uq_one_self_per_user) lost a race the lock should already have prevented.
        if (error && error.code === 'P2002') {
            return res.status(409).json({ status: 'error', code: 'SELF_PROFILE_EXISTS', message: 'A SELF patient profile already exists for this account.' });
        }
        next(error);
    }
};

// ------------------------------------------------------------------
// POST /api/patients/claim   body: { code }
// The real patient claims an NGO-created record: the PATIENT_CLAIM code issued by the NGO
// (POST /api/admin/patients/:id/claim-code) turns that record into the caller's SELF account.
// Same result shape as POST /api/patients ({ patient, link }) so Flutter reuses its parsing.
// Like createPatientProfile, SELF is created with access_scopes ['ALL'] and no consentrecord rows.
// ------------------------------------------------------------------
const CLAIM_INVALID_MESSAGE = 'Invalid or expired code.';          // ONE message for wrong / used / expired
const CLAIM_MAX_FAILED_ATTEMPTS = 5;                               // per user ...
const CLAIM_ATTEMPT_WINDOW_MS = 60 * 60 * 1000;                    // ... per hour
const CLAIM_CODE_REGEX = /^[0-9A-F]{8}$/;

const SELF_PROFILE_EXISTS_BODY = { status: 'error', code: 'SELF_PROFILE_EXISTS', message: 'A SELF patient profile already exists for this account.' };
const SELF_LINK_EXISTS_BODY = { status: 'error', code: 'SELF_LINK_EXISTS', message: 'This patient already has an account.' };

// P2002 can now come from several unique constraints. Decide which one by looking at the state AFTER the
// failed transaction rolled back (reliable across Prisma versions / adapters), never by echoing DB details.
const classifyClaimConflict = async (userId, patientId) => {
    if (await prisma.patientaccountlink.findFirst({ where: { user_id: userId, relationship_type: 'SELF' }, select: { id: true } })) {
        return 'SELF_PROFILE_EXISTS';
    }
    if (patientId && await prisma.patientaccountlink.findFirst({
        where: { patient_id: patientId, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null }, select: { id: true }
    })) {
        return 'SELF_LINK_EXISTS';
    }
    return null;
};

exports.claimPatient = async (req, res, next) => {
    let claimedPatientId = null;   // for conflict classification after a rolled-back transaction
    const userId = req.user.userId;
    try {
        const raw = req.body?.code;
        const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';

        // ONE transaction: user lock -> count failures -> validate -> (record failure | claim).
        // A rejected code must COMMIT its failed-attempt row, so INVALID / RATE_LIMITED are returned as
        // results (commit), never thrown (rollback). Only real conflicts throw.
        const outcome = await prisma.$transaction(async (tx) => {
            await lockUserSelf(tx, userId);

            const now = Date.now();
            const windowStart = new Date(now - CLAIM_ATTEMPT_WINDOW_MS);

            // Brute-force guard (DB-backed, so it survives restarts and works across instances).
            const failures = await tx.patientclaimattempt.count({ where: { user_id: userId, attempted_at: { gte: windowStart } } });
            if (failures >= CLAIM_MAX_FAILED_ATTEMPTS) return { type: 'RATE_LIMITED' };

            const recordFailure = async () => {
                await tx.patientclaimattempt.create({ data: { user_id: userId } });
                await tx.patientclaimattempt.deleteMany({ where: { user_id: userId, attempted_at: { lt: windowStart } } });
                return { type: 'INVALID' };
            };

            if (!CLAIM_CODE_REGEX.test(code)) return recordFailure();

            const invite = await tx.caregiverinvite.findFirst({
                where: { code, invite_kind: 'PATIENT_CLAIM', is_used: false, expires_at: { gt: new Date() } }
            });
            if (!invite) return recordFailure();
            claimedPatientId = invite.patient_id;

            // Lock order: user (above) first, patient second. Serialises with other claims and with new codes.
            await lockPatientSelf(tx, invite.patient_id);

            const activeSelf = await tx.patientaccountlink.findFirst({
                where: { patient_id: invite.patient_id, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null },
                select: { id: true }
            });
            if (activeSelf) throw new HttpError(409, 'This patient already has an account.', 'SELF_LINK_EXISTS');

            // Same rule as createPatientProfile: one SELF patient profile per account.
            const ownSelf = await tx.patientaccountlink.findFirst({
                where: { user_id: userId, relationship_type: 'SELF' },
                select: { id: true }
            });
            if (ownSelf) throw new HttpError(409, 'A SELF patient profile already exists for this account.', 'SELF_PROFILE_EXISTS');

            // Checked BEFORE the code is consumed, so a deleted record never burns the code.
            const patient = await tx.patient.findUnique({ where: { id: invite.patient_id } });
            if (!patient || patient.deleted_at) return recordFailure();

            // Atomic claim: of two simultaneous requests with the same code exactly one gets count 1.
            const claimed = await tx.caregiverinvite.updateMany({
                where: { id: invite.id, invite_kind: 'PATIENT_CLAIM', is_used: false, expires_at: { gt: new Date() } },
                data: { is_used: true }
            });
            if (claimed.count !== 1) return recordFailure();

            const link = await tx.patientaccountlink.create({
                data: {
                    user_id: userId,
                    patient_id: invite.patient_id,
                    relationship_type: 'SELF',
                    relationship_label: 'Self',
                    access_scopes: ['ALL'],          // the patient's own account, never a delegate
                    consent_status: 'GRANTED',
                    granted_by: userId               // the patient themselves
                }
            });
            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.PATIENT_CLAIMED,
                targetResource: RESOURCES.ACCOUNT_LINK,
                targetId: link.id,
                targetUserId: userId,
                patientId: invite.patient_id,
                scopesBefore: [],
                scopesAfter: ['ALL'],
                extra: { invite_id: invite.id, issued_by: invite.created_by || null },   // never the code
                req
            });
            return { type: 'CLAIMED', data: { patient, link } };
        });

        if (outcome.type === 'RATE_LIMITED') {
            return res.status(429).json({ status: 'error', code: 'TOO_MANY_CLAIM_ATTEMPTS', message: 'Too many failed attempts. Please try again in an hour.' });
        }
        if (outcome.type === 'INVALID') {
            return res.status(400).json({ status: 'error', code: 'INVALID_CLAIM_CODE', message: CLAIM_INVALID_MESSAGE });
        }
        return res.status(201).json({ status: 'success', data: outcome.data });
    } catch (error) {
        if (error && error.code === 'P2002') {
            const kind = await classifyClaimConflict(userId, claimedPatientId).catch(() => null);
            if (kind === 'SELF_PROFILE_EXISTS') return res.status(409).json(SELF_PROFILE_EXISTS_BODY);
            if (kind === 'SELF_LINK_EXISTS') return res.status(409).json(SELF_LINK_EXISTS_BODY);
            // unrelated / unexpected unique violation: generic internal error, no DB details to the client
        }
        next(error);
    }
};

// ------------------------------------------------------------------
// PATCH /api/patients/:patient_id   (the patient's own SELF / DELEGATE account only)
// The patient may correct their own details. care_plan_summary is deliberately NOT editable here:
// it stays with the NGO (PATCH /api/admin/patients/:id).
// ------------------------------------------------------------------
const PATIENT_EDITABLE_FIELDS = ['full_name', 'date_of_birth', 'preferred_language', 'cancer_type', 'cancer_stage', 'diagnosis_date'];

exports.updatePatientProfile = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;
        if (!isUuid(patient_id)) return res.status(400).json({ status: 'error', message: 'Invalid patient id.' });

        // role PATIENT = an active SELF / DELEGATE account link (caregivers and NGO staff resolve to other roles).
        const ctx = await getPatientAccessContext(userId, patient_id);
        if (!ctx || ctx.role !== 'PATIENT' || !contextHasScope(ctx, SCOPES.ACCOUNT_OPERATE)) {
            return res.status(403).json({ status: 'error', message: 'You do not have permission to edit this patient.' });
        }

        const parsed = parsePatientBody(req.body, { requireAll: false, allowedFields: PATIENT_EDITABLE_FIELDS });
        if (parsed.error) return res.status(400).json({ status: 'error', message: parsed.error });
        if (Object.keys(parsed.data).length === 0) {
            return res.status(400).json({ status: 'error', message: 'Provide at least one field to update.' });
        }

        const patient = await prisma.$transaction(async (tx) => {
            const updated = await tx.patient.update({
                where: { id: patient_id },
                data: { ...parsed.data, updated_at: new Date() }
            });
            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.PATIENT_UPDATED,
                targetResource: RESOURCES.PATIENT,
                targetId: patient_id,
                patientId: patient_id,
                extra: { fields: Object.keys(parsed.data), by: ctx.link.relationship_type },   // field NAMES only
                req
            });
            return updated;
        });

        return res.status(200).json({ status: 'success', data: patient });
    } catch (error) { next(error); }
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
                await syncConsentRecords(tx, { patientId, granteeId: delegateUserId, grantedBy: grantorId, scopes: finalScopes });
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
            await syncConsentRecords(tx, { patientId, granteeId: delegateUserId, grantedBy: grantorId, scopes: finalScopes });
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
                await syncConsentRecords(tx, { patientId, granteeId: delegateUserId, grantedBy: grantorId, scopes: data.access_scopes });
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
            await revokeConsentRecords(tx, { patientId, granteeId: delegateUserId });
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
