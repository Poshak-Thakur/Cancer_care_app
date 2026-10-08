const prisma = require('../config/db');
const crypto = require('crypto');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');
const { raiseOrUpdateAlert, getAlertRecipientUserIds } = require('../services/alertService');
const { sendEmergencyAlertNotification } = require('../config/firebase');
const { getISTDayBoundaries } = require('../utils/timezoneHelper');
const { isUuid } = require('../utils/validators');

exports.submitCheckIn = async (req, res, next) => {
    try {
        const { patient_id, observations, source = 'ROUTINE', client_event_id } = req.body;
        const userId = req.user.userId;

        if (!patient_id) return res.status(400).json({ status: 'error', message: 'patient_id is required.' });
        if (!Array.isArray(observations) || observations.length === 0) return res.status(400).json({ status: 'error', message: 'At least one symptom observation is required.' });

        for (const obs of observations) {
            if (!obs.observation_type || typeof obs.observation_type !== 'string') return res.status(400).json({ status: 'error', message: 'Each observation must include an observation_type string.' });
            if (obs.severity !== undefined && obs.severity !== null) {
                const sev = Number(obs.severity);
                if (isNaN(sev) || sev < 0 || sev > 10) return res.status(400).json({ status: 'error', message: 'Observation severity must be a numeric value between 0 and 10.' });
            }
        }

        if (client_event_id !== undefined && client_event_id !== null && !isUuid(client_event_id)) {
            return res.status(400).json({ status: 'error', message: 'client_event_id must be a valid UUID.' });
        }

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });

        const eventUuid = client_event_id || crypto.randomUUID();

        // Idempotency: the Flutter app retries offline-queued check-ins with the same client_event_id.
        // A replay returns the event that was already stored instead of failing on the unique constraint.
        const findReplay = async () => {
            const existing = await prisma.symptomevent.findUnique({ where: { client_event_id: eventUuid } });
            if (!existing) return null;
            // Never reveal / return an event that belongs to a different patient.
            if (existing.patient_id !== patient_id) {
                return { conflict: true };
            }
            return { event: existing };
        };

        if (client_event_id) {
            const replay = await findReplay();
            if (replay?.conflict) {
                return res.status(409).json({ status: 'error', message: 'client_event_id is already used by another record.' });
            }
            if (replay?.event) {
                return res.status(200).json({ status: 'success', message: 'Check-in already recorded.', data: replay.event });
            }
        }

        // Push notification is collected inside the transaction but only SENT after it has committed,
        // so a rolled-back check-in can never trigger an emergency alert.
        let pendingAlert = null;

        let symptomEvent;
        try {
            symptomEvent = await prisma.$transaction(async (tx) => {
                const event = await tx.symptomevent.create({
                    data: {
                        id: crypto.randomUUID(),
                        patient_id,
                        recorded_by: userId,
                        source: ['ROUTINE', 'UPDATE'].includes(source) ? source : 'ROUTINE',
                        client_event_id: eventUuid,
                        sync_state: 'SYNCED',
                        recorded_at: new Date()
                    }
                });

                const observationData = observations.map(obs => ({
                    symptom_event_id: event.id,
                    observation_type: obs.observation_type.toUpperCase(),
                    severity: obs.severity !== undefined && obs.severity !== null ? Number(obs.severity) : null,
                    numeric_value: obs.numeric_value !== undefined && obs.numeric_value !== null ? obs.numeric_value : null,
                    unit: obs.unit || null,
                    note: obs.note || null
                }));

                await tx.symptomobservation.createMany({ data: observationData });

                // Evaluate for severe deterioration
                const highSeverityObs = observationData.filter(o => o.severity && o.severity >= 8);
                if (highSeverityObs.length > 0) {
                    // Deduplicated: an already-open alert for this patient/rule gets an AlertUpdate
                    // instead of a second alert (see services/alertService.js).
                    const outcome = await raiseOrUpdateAlert(tx, {
                        patientId: patient_id,
                        type: 'DETERIORATION',
                        ruleId: 'SEVERE_SYMPTOM_SCORE',
                        ruleVersion: 'v1',
                        severity: 'HIGH',
                        sourceType: 'CHECK_IN',
                        sourceId: event.id,
                        actorId: userId,
                        updateNote: 'Another severe check-in was recorded.'
                    });

                    if (outcome.notify) {
                        // Who must hear about it: account holders + caregivers + central NGO
                        // (revoked links excluded; the person who recorded the check-in is skipped).
                        const recipientIds = await getAlertRecipientUserIds(tx, patient_id, userId);

                        let tokens = [];
                        if (recipientIds.length > 0) {
                            // Record who was alerted (shows up in the NGO admin alert detail view).
                            await tx.alertrecipient.createMany({
                                data: recipientIds.map(id => ({ alert_id: outcome.alert.id, recipient_user_id: id })),
                                skipDuplicates: true
                            });

                            const recipientUsers = await tx.useraccount.findMany({
                                where: { id: { in: recipientIds } },
                                select: { fcm_token: true }
                            });
                            tokens = [...new Set(recipientUsers.map(u => u.fcm_token).filter(Boolean))];
                        }

                        pendingAlert = { alertId: outcome.alert.id, tokens };
                    }
                }

                return event;
            });
        } catch (txError) {
            // Two identical requests raced past the replay check: the loser hits the unique constraint.
            if (txError.code === 'P2002' && client_event_id) {
                const replay = await findReplay();
                if (replay?.event) {
                    return res.status(200).json({ status: 'success', message: 'Check-in already recorded.', data: replay.event });
                }
            }
            throw txError;
        }

        if (pendingAlert) {
            const { alertId, tokens } = pendingAlert;
            tokens.forEach(fcmToken => {
                // PRIVACY: no patient name, symptom or severity in the notification text.
                // Details are only visible inside the authenticated app.
                sendEmergencyAlertNotification(fcmToken, {
                    title: 'Care circle alert',
                    alertId,
                    patientId: patient_id,
                    body: 'Someone in your Saathi care circle may need attention.'
                }).catch(console.error);
            });
        }

        return res.status(201).json({ status: 'success', message: 'Check-in recorded safely.', data: symptomEvent });
    } catch (error) { next(error); }
};

exports.getTodayCheckInStatus = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;

        if (!patient_id) return res.status(400).json({ status: 'error', message: 'patient_id is required.' });

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });

        // NEW: Enforce India Standard Time boundary check
        const { startOfDay } = getISTDayBoundaries();

        const todayCheckIn = await prisma.symptomevent.findFirst({
            where: {
                patient_id: patient_id,
                recorded_at: { gte: startOfDay }
            },
            include: { symptomobservation: true },
            orderBy: { recorded_at: 'desc' }
        });

        return res.status(200).json({ 
            status: 'success', 
            data: todayCheckIn ? { completed: true, details: todayCheckIn } : { completed: false }
        });
    } catch (error) { next(error); }
};

exports.getSymptomHistory = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;

        if (!patient_id) return res.status(400).json({ status: 'error', message: 'patient_id is required.' });

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });

        const history = await prisma.symptomevent.findMany({
            where: { patient_id },
            include: { symptomobservation: true },
            orderBy: { recorded_at: 'desc' },
            take: 30
        });

        return res.status(200).json({ status: 'success', data: history });
    } catch (error) { next(error); }
};
