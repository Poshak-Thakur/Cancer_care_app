const prisma = require('../config/db');
const { sendEmergencyAlertNotification } = require('../config/firebase');

/**
 * PUSH DELIVERY TRACKING FOR ALERTS (Help Now + automatic deterioration alerts)
 * ------------------------------------------------------------------
 * Two steps, so a rolled-back check-in can never push and every push leaves a trace:
 *
 *   1. recordPushDeliveries(tx, ...)   INSIDE the transaction: alertrecipient rows + one alertdelivery
 *                                      row per recipient.
 *                                        - device token present -> QUEUED
 *                                        - no device token      -> FAILED (NO_DEVICE_TOKEN)
 *   2. notifyInBackground(queued, ...) AFTER the commit: hands each message to Firebase and then
 *                                      updates the row:
 *                                        - FCM accepted it      -> SENT   (sent_at)
 *                                        - FCM refused / error  -> FAILED (failed_at, failure_reason)
 *
 * SENT only means "Firebase accepted the message". It is NOT proof that a device displayed it;
 * DELIVERED / SEEN are reserved for real device receipts (not available yet).
 */

const inFlight = new Set();

const recordPushDeliveries = async (tx, alertId, recipientIds) => {
    if (!Array.isArray(recipientIds) || recipientIds.length === 0) return [];

    // Record who was alerted (shows up in the NGO admin alert detail view).
    await tx.alertrecipient.createMany({
        data: recipientIds.map((id) => ({ alert_id: alertId, recipient_user_id: id })),
        skipDuplicates: true
    });
    const [recipientRows, users] = await Promise.all([
        tx.alertrecipient.findMany({ where: { alert_id: alertId, recipient_user_id: { in: recipientIds } } }),
        tx.useraccount.findMany({ where: { id: { in: recipientIds } }, select: { id: true, fcm_token: true } })
    ]);
    const tokenByUser = new Map(users.map((u) => [u.id, u.fcm_token]));
    const now = new Date();
    const queued = [];
    for (const row of recipientRows) {
        const token = tokenByUser.get(row.recipient_user_id);
        if (token) {
            const delivery = await tx.alertdelivery.create({
                data: { alert_recipient_id: row.id, channel: 'PUSH', delivery_status: 'QUEUED' }
            });
            queued.push({ deliveryId: delivery.id, token });
        } else {
            await tx.alertdelivery.create({
                data: { alert_recipient_id: row.id, channel: 'PUSH', delivery_status: 'FAILED', failure_reason: 'NO_DEVICE_TOKEN', failed_at: now }
            });
        }
    }
    return queued;
};

const dispatchPushDeliveries = async (queued, payload) => {
    // One device token can belong to several recipient rows; send once per token.
    const byToken = new Map();
    for (const q of queued) {
        if (!byToken.has(q.token)) byToken.set(q.token, []);
        byToken.get(q.token).push(q.deliveryId);
    }
    await Promise.all([...byToken.entries()].map(async ([token, deliveryIds]) => {
        let outcome;
        try {
            outcome = await sendEmergencyAlertNotification(token, payload);
        } catch (err) {
            outcome = { ok: false, reason: 'SEND_EXCEPTION' };
        }
        const now = new Date();
        const ok = !!outcome && outcome.ok === true;
        const reason = ok ? null : String((outcome && outcome.reason) || 'UNKNOWN_RESULT').slice(0, 200);
        try {
            await prisma.alertdelivery.updateMany({
                where: { id: { in: deliveryIds }, delivery_status: 'QUEUED' },   // never overwrite a later status
                data: ok
                    ? { delivery_status: 'SENT', sent_at: now }
                    : { delivery_status: 'FAILED', failed_at: now, failure_reason: reason }
            });
        } catch (err) {
            console.error('[alert delivery] could not record the push outcome:', err.message);
        }
    }));
};

// Fire-and-forget for the HTTP response, but tracked so tests (and graceful shutdown) can wait for it.
const notifyInBackground = (queued, payload) => {
    if (!queued || queued.length === 0) return Promise.resolve();
    const p = dispatchPushDeliveries(queued, payload)
        .catch((err) => console.error('[alert delivery] dispatch failed:', err.message))
        .finally(() => inFlight.delete(p));
    inFlight.add(p);
    return p;
};

const whenNotificationsSettled = async () => {
    while (inFlight.size > 0) await Promise.all([...inFlight]);
};

module.exports = { recordPushDeliveries, notifyInBackground, whenNotificationsSettled };
