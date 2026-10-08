const { getCentralCounsellorUserIds, listActiveCaregiverLinks, listActiveAccountLinks } = require('./authorizationService');

/**
 * ALERT LIFECYCLE (deduplication + cooldown)
 * ------------------------------------------------------------------
 * For one patient and one rule (alert.rule_id):
 *
 *   1. an alert is still active (OPEN / ACKNOWLEDGED / IN_PROGRESS)
 *        -> add an AlertUpdate to it. NO new alert, NO new push.
 *   2. the previous alert was closed (RESOLVED / CANCELLED / ESCALATION_EXHAUSTED) but we are still
 *      inside its cooldown (alert.rule_cooldown_until) = same episode
 *        -> reopen it as OPEN + add an AlertUpdate, and notify again
 *           (a patient who deteriorates right after "resolved" must not be hidden).
 *   3. otherwise -> create a new alert with rule_cooldown_until = now + cooldown.
 *
 * Cooldown length: ALERT_COOLDOWN_MINUTES (default 60).
 *
 * Reusable for "Help Now" as well: call raiseOrUpdateAlert() with another rule_id/type and the
 * repeated-press-while-open behaviour (AlertUpdate, not a second Alert) comes for free.
 */

const ACTIVE_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'IN_PROGRESS'];

const cooldownMs = () => {
    const minutes = parseInt(process.env.ALERT_COOLDOWN_MINUTES, 10);
    return (Number.isFinite(minutes) && minutes >= 0 ? minutes : 60) * 60 * 1000;
};

/**
 * Must run inside a prisma.$transaction (pass the tx client).
 * Returns { alert, created, reopened, notify }.
 */
const raiseOrUpdateAlert = async (tx, {
    patientId, type = 'DETERIORATION', ruleId, ruleVersion = 'v1', severity = 'HIGH',
    sourceType, sourceId, actorId, updateNote
}) => {
    // Serialise concurrent triggers for the same patient so two simultaneous check-ins
    // cannot both decide "no open alert" and create two alerts.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'alert:' + patientId}))`;

    const now = new Date();
    const latest = await tx.alert.findFirst({
        where: { patient_id: patientId, type, rule_id: ruleId },
        orderBy: { created_at: 'desc' }
    });

    const addUpdate = (alertId, updateType, note) => tx.alertupdate.create({
        data: { alert_id: alertId, created_by: actorId, type: updateType, note }
    });

    if (latest && ACTIVE_STATUSES.includes(latest.status)) {
        await addUpdate(latest.id, 'NEW_TRIGGER', updateNote || 'The same alert condition was recorded again.');
        const alert = await tx.alert.update({ where: { id: latest.id }, data: { updated_at: now } });
        return { alert, created: false, reopened: false, notify: false };
    }

    if (latest && latest.rule_cooldown_until && latest.rule_cooldown_until > now) {
        await addUpdate(latest.id, 'REOPENED', updateNote || 'The alert condition recurred within the cooldown window.');
        const alert = await tx.alert.update({ where: { id: latest.id }, data: { status: 'OPEN', updated_at: now } });
        return { alert, created: false, reopened: true, notify: true };
    }

    const alert = await tx.alert.create({
        data: {
            patient_id: patientId,
            type,
            severity,
            status: 'OPEN',
            source_type: sourceType || null,
            source_id: sourceId || null,
            rule_id: ruleId,
            rule_version: ruleVersion,
            rule_cooldown_until: new Date(now.getTime() + cooldownMs())
        }
    });
    return { alert, created: true, reopened: false, notify: true };
};

/**
 * Everyone who must hear about an alert for this patient:
 *   active patient account holders (SELF/DELEGATE) + active, NGO-recognised caregivers + central NGO.
 * Active = consent_status GRANTED and revoked_at NULL. Revoked links are excluded, so a revoked person stops receiving notifications immediately.
 */
const getAlertRecipientUserIds = async (tx, patientId, excludeUserId = null) => {
    const [accountLinks, caregiverLinks, centralIds] = await Promise.all([
        // consent_status GRANTED + revoked_at NULL (+ NGO-recognised for caregivers) - centralised.
        listActiveAccountLinks(patientId, tx),
        listActiveCaregiverLinks(patientId, tx),
        getCentralCounsellorUserIds()
    ]);
    return [...new Set([
        ...accountLinks.map((l) => l.user_id),
        ...caregiverLinks.map((l) => l.caregiver_user_id),
        ...centralIds
    ])].filter((id) => id !== excludeUserId);
};

module.exports = { raiseOrUpdateAlert, getAlertRecipientUserIds, ACTIVE_STATUSES };
