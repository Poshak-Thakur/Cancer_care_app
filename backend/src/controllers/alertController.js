const prisma = require('../config/db');
const { getPatientAccessContext, ACTIVE_LINK } = require('../services/authorizationService');
const { raiseOrUpdateAlert, getAlertRecipientUserIds } = require('../services/alertService');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');
const { recordPushDeliveries, notifyInBackground } = require('../services/alertNotificationService');
const { isUuid } = require('../utils/validators');
const HttpError = require('../utils/httpError');

/**
 * MANUAL "HELP NOW" (mobile app)
 * ------------------------------------------------------------------
 *   POST  /api/alerts/help-now        { patient_id, client_event_id, note? }
 *   PATCH /api/alerts/:id/cancel      { note? }
 *
 * WHO MAY PRESS IT: anyone with a CURRENT relationship to the patient - SELF / DELEGATE account
 * holders and active, NGO-recognised caregivers (all resolved by authorizationService). NO
 * particular access scope is required: asking for help must work for every member of the care
 * circle, including a delegate or caregiver with very limited scopes. The central NGO does not
 * raise Help Now requests - it responds to them through /api/admin/alerts.
 *
 * DEDUPLICATION: each requester gets their own rule (HELP_NOW:<user id>), so
 *   - the same person pressing again while their alert is still open adds an AlertUpdate
 *     (no second alert, no second push);
 *   - another person's press creates their own alert, which only THEY can cancel;
 *   - after an alert closes, a new press always starts a fresh alert (no cooldown re-opening).
 *
 * IDEMPOTENCY: client_event_id is unique. A retry of the same request returns the same alert
 * (HTTP 200) instead of creating a duplicate.
 *
 * NOTIFICATIONS are privacy-safe: no patient name, no note text - details are only visible inside
 * the authenticated app. The delivery rows record the real outcome (services/alertNotificationService):
 * FAILED (no device token / Firebase refused it, with a reason) or SENT (Firebase accepted it). SENT is
 * NOT proof that a device displayed the notification - no delivery receipt is available.
 */

const MAX_NOTE_LENGTH = 1000;
const CANCELLABLE_STATUSES = ['OPEN', 'ACKNOWLEDGED']; // once staff is IN_PROGRESS, staff resolves it

const ELIGIBLE_ROLES = ['PATIENT', 'CAREGIVER'];

const hasEligibleRelationship = async (userId, patientId) => {
    const ctx = await getPatientAccessContext(userId, patientId);
    return !!ctx && ELIGIBLE_ROLES.includes(ctx.role);
};

// Finds an earlier request with this client_event_id. Returns:
//   { alert, merged }  when it belongs to this caller + patient (a retry)
//   { conflict: true } when the key was used by someone else / another patient
//   null               when the key is new
const findReplay = async (client, { clientEventId, userId, patientId }) => {
    const alert = await client.alert.findUnique({ where: { client_event_id: clientEventId } });
    if (alert) {
        const mine = alert.patient_id === patientId && alert.requested_by_user_id === userId;
        return mine ? { alert, merged: false } : { conflict: true };
    }
    const update = await client.alertupdate.findUnique({ where: { client_event_id: clientEventId } });
    if (update) {
        const parent = await client.alert.findUnique({ where: { id: update.alert_id } });
        const mine = parent && parent.patient_id === patientId && update.created_by === userId;
        return mine ? { alert: parent, merged: true } : { conflict: true };
    }
    return null;
};

const replyReplay = (res, replay) => {
    if (replay.conflict) {
        return res.status(409).json({
            status: 'error',
            code: 'CLIENT_EVENT_ID_REUSED',
            message: 'This client_event_id was already used for a different request.'
        });
    }
    return res.status(200).json({
        status: 'success',
        message: 'Help request already recorded.',
        data: replay.alert,
        meta: { created: false, merged: replay.merged, replay: true }
    });
};

// POST /api/alerts/help-now
exports.createHelpNow = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { patient_id, client_event_id } = req.body || {};

        if (!isUuid(patient_id)) {
            return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
        }
        if (!isUuid(client_event_id)) {
            return res.status(400).json({ status: 'error', message: 'client_event_id must be a valid UUID.' });
        }
        let note = null;
        if (req.body.note !== undefined && req.body.note !== null) {
            if (typeof req.body.note !== 'string') {
                return res.status(400).json({ status: 'error', message: 'note must be a string.' });
            }
            note = req.body.note.trim() || null;
            if (note && note.length > MAX_NOTE_LENGTH) {
                return res.status(400).json({ status: 'error', message: `note must be at most ${MAX_NOTE_LENGTH} characters.` });
            }
        }

        if (!(await hasEligibleRelationship(userId, patient_id))) {
            return res.status(403).json({ status: 'error', message: 'You do not have an active relationship with this patient.' });
        }

        const earlier = await findReplay(prisma, { clientEventId: client_event_id, userId, patientId: patient_id });
        if (earlier) return replyReplay(res, earlier);

        let pending = null;
        let outcome;
        try {
            outcome = await prisma.$transaction(async (tx) => {
                const result = await raiseOrUpdateAlert(tx, {
                    patientId: patient_id,
                    type: 'HELP_REQUEST',
                    ruleId: `HELP_NOW:${userId}`,
                    ruleVersion: 'v1',
                    severity: 'HIGH', // same vocabulary as automatic alerts; type HELP_REQUEST tells them apart
                    sourceType: 'HELP_NOW',
                    actorId: userId,
                    updateNote: note || 'Help Now was pressed again.',
                    requestedByUserId: userId,
                    clientEventId: client_event_id,
                    useCooldown: false
                });

                // A brand-new alert keeps the optional note as its first timeline entry.
                if (result.created && note) {
                    await tx.alertupdate.create({
                        data: { alert_id: result.alert.id, created_by: userId, type: 'HELP_NOW_NOTE', note }
                    });
                }

                if (result.notify) {
                    // Account holders + recognised caregivers + central NGO, revoked links excluded,
                    // and never the person who pressed the button.
                    const recipientIds = await getAlertRecipientUserIds(tx, patient_id, userId);
                    const queued = await recordPushDeliveries(tx, result.alert.id, recipientIds);
                    pending = { alertId: result.alert.id, queued };
                }

                await recordAudit(tx, {
                    actorId: userId,
                    action: AUDIT_ACTIONS.HELP_NOW_CREATED,
                    targetResource: RESOURCES.ALERT,
                    targetId: result.alert.id,
                    patientId: patient_id,
                    extra: { created: result.created, merged_into_open_alert: !result.created, has_note: !!note },
                    req
                });
                return result;
            });
        } catch (txError) {
            // Two identical requests raced past the replay check: the loser hits the unique constraint.
            if (txError.code === 'P2002') {
                const raced = await findReplay(prisma, { clientEventId: client_event_id, userId, patientId: patient_id });
                if (raced) return replyReplay(res, raced);
            }
            throw txError;
        }

        if (pending) {
            // PRIVACY: no patient name and no note in the notification text. SENT / FAILED is recorded on
            // the delivery rows once Firebase answers (SENT does not prove the device displayed it).
            notifyInBackground(pending.queued, {
                title: 'Care circle alert',
                alertId: pending.alertId,
                patientId: patient_id,
                body: 'Someone in your Saathi care circle needs help.'
            });
        }

        return res.status(outcome.created ? 201 : 200).json({
            status: 'success',
            message: outcome.created ? 'Help request sent.' : 'Help request added to your open alert.',
            data: outcome.alert,
            meta: { created: outcome.created, merged: !outcome.created, replay: false }
        });
    } catch (error) { next(error); }
};

// PATCH /api/alerts/:id/cancel
exports.cancelHelpNow = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid alert id.' });

        let note = null;
        if (req.body && req.body.note !== undefined && req.body.note !== null) {
            if (typeof req.body.note !== 'string') {
                return res.status(400).json({ status: 'error', message: 'note must be a string.' });
            }
            note = req.body.note.trim() || null;
            if (note && note.length > MAX_NOTE_LENGTH) {
                return res.status(400).json({ status: 'error', message: `note must be at most ${MAX_NOTE_LENGTH} characters.` });
            }
        }

        const alert = await prisma.alert.findUnique({ where: { id } });
        // Only manual Help Now alerts can be cancelled here; anything else is "not found".
        if (!alert || alert.type !== 'HELP_REQUEST' || !alert.requested_by_user_id) {
            return res.status(404).json({ status: 'error', message: 'Help request not found.' });
        }

        // Only the person who pressed Help Now. Not other relatives, not the NGO (staff use
        // acknowledge / in-progress / resolve).
        if (alert.requested_by_user_id !== userId) {
            return res.status(403).json({
                status: 'error',
                code: 'REQUESTER_ONLY',
                message: 'Only the person who sent this help request can cancel it.'
            });
        }
        if (!(await hasEligibleRelationship(userId, alert.patient_id))) {
            return res.status(403).json({ status: 'error', message: 'You no longer have an active relationship with this patient.' });
        }

        if (alert.status === 'CANCELLED') {
            return res.status(200).json({ status: 'success', message: 'Help request was already cancelled.', data: alert });
        }
        if (!CANCELLABLE_STATUSES.includes(alert.status)) {
            return res.status(409).json({
                status: 'error',
                code: 'NOT_CANCELLABLE',
                message: `A help request that is ${alert.status} can no longer be cancelled.`
            });
        }

        const updated = await prisma.$transaction(async (tx) => {
            // Atomic: only flips while it is still OPEN / ACKNOWLEDGED.
            const changed = await tx.alert.updateMany({
                where: { id, status: { in: CANCELLABLE_STATUSES } },
                data: { status: 'CANCELLED', updated_at: new Date() }
            });
            if (changed.count !== 1) {
                throw new HttpError(409, 'Help request can no longer be cancelled.', 'NOT_CANCELLABLE');
            }
            await tx.alertupdate.create({
                data: {
                    alert_id: id,
                    created_by: userId,
                    type: 'STATUS_CHANGE',
                    note: note ? `${alert.status} -> CANCELLED (by requester): ${note}` : `${alert.status} -> CANCELLED (by requester)`
                }
            });
            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.HELP_NOW_CANCELLED,
                targetResource: RESOURCES.ALERT,
                targetId: id,
                patientId: alert.patient_id,
                extra: { previous_status: alert.status },
                req
            });
            return tx.alert.findUnique({ where: { id } });
        });

        return res.status(200).json({ status: 'success', message: 'Help request cancelled.', data: updated });
    } catch (error) { next(error); }
};
