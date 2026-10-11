const prisma = require('../config/db');
const crypto = require('crypto');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');
const { raiseOrUpdateAlert, getAlertRecipientUserIds } = require('../services/alertService');
const { recordPushDeliveries, notifyInBackground } = require('../services/alertNotificationService');
const { validateAnswers } = require('../services/checkInFormService');
const { getISTDayBoundaries } = require('../utils/timezoneHelper');
const { isUuid } = require('../utils/validators');

// Configured answers come back with the field label/type they were answered under, so old
// submissions stay readable after the NGO changes the form (additive key on the existing payload).
const ANSWER_INCLUDE = {
    include: {
        field: { select: { id: true, field_key: true, label: true, field_type: true } },
        option: { select: { id: true, option_value: true, label: true } }
    }
};

/**
 * POST /api/symptoms/check-in
 *
 * Two payload styles, both supported (the old Flutter app keeps working):
 *   LEGACY      { patient_id, observations: [...], source?, client_event_id? }
 *   CONFIGURED  { patient_id, client_event_id, form_version_id, answers: [{ field_id, value }], observations?: [...] }
 *
 * - `answers` are validated against the exact form version (field types, required fields, choice
 *   options, numeric limits, duplicates) and stored in checkinanswer together with form_version_id.
 *   A version that was PUBLISHED when the user filled the form is still accepted after the NGO
 *   publishes a newer one (offline retries), but a DRAFT is never accepted.
 * - `observations` stay the ONLY input of the deterioration-alert rule. Custom NGO-configured
 *   questions are stored and shown, but can never silently raise, change or suppress a medical alert.
 * - client_event_id keeps the whole submission idempotent (offline retries).
 */
exports.submitCheckIn = async (req, res, next) => {
    try {
        const { patient_id, source = 'ROUTINE', client_event_id, form_version_id } = req.body;
        const answers = req.body.answers;
        const hasAnswers = answers !== undefined && answers !== null;
        const observations = req.body.observations === undefined || req.body.observations === null ? [] : req.body.observations;
        const userId = req.user.userId;

        if (!patient_id) return res.status(400).json({ status: 'error', message: 'patient_id is required.' });
        if (!Array.isArray(observations)) return res.status(400).json({ status: 'error', message: 'observations must be a list.' });
        if (hasAnswers && !Array.isArray(answers)) return res.status(400).json({ status: 'error', message: 'answers must be a list.' });
        if (observations.length === 0 && !(hasAnswers && answers.length > 0)) {
            return res.status(400).json({ status: 'error', message: 'At least one symptom observation is required.' });
        }
        if (hasAnswers && answers.length > 0 && !isUuid(form_version_id)) {
            return res.status(400).json({ status: 'error', message: 'form_version_id (a valid UUID) is required when answers are submitted.' });
        }

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

        // Configured answers: validate against the exact form version BEFORE anything is written.
        let answerRows = [];
        let formVersionId = null;
        if (hasAnswers && answers.length > 0) {
            const version = await prisma.checkinformversion.findUnique({
                where: { id: form_version_id },
                include: { fields: { include: { options: true } } }
            });
            if (!version || version.status === 'DRAFT') {
                return res.status(400).json({ status: 'error', code: 'UNKNOWN_FORM_VERSION', message: 'form_version_id does not match a published check-in form version.' });
            }
            const { errors, rows } = validateAnswers(version.fields, answers);
            if (errors.length > 0) {
                return res.status(400).json({ status: 'error', code: 'VALIDATION_FAILED', message: 'Some answers are not valid.', errors });
            }
            answerRows = rows;
            formVersionId = version.id;
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
                        recorded_at: new Date(),
                        ...(formVersionId ? { form_version_id: formVersionId } : {})
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

                if (observationData.length > 0) {
                    await tx.symptomobservation.createMany({ data: observationData });
                }
                if (answerRows.length > 0) {
                    await tx.checkinanswer.createMany({
                        data: answerRows.map((r) => ({ ...r, symptom_event_id: event.id }))
                    });
                }

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

                        // alertrecipient + one alertdelivery row per recipient (QUEUED, or FAILED when the
                        // recipient has no device token). Real outcomes are recorded after the commit.
                        const queued = await recordPushDeliveries(tx, outcome.alert.id, recipientIds);

                        pendingAlert = { alertId: outcome.alert.id, queued };
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
            const { alertId, queued } = pendingAlert;
            // PRIVACY: no patient name, symptom or severity in the notification text.
            // Details are only visible inside the authenticated app. SENT / FAILED is written to
            // alertdelivery once Firebase has answered (SENT does not prove the device displayed it).
            notifyInBackground(queued, {
                title: 'Care circle alert',
                alertId,
                patientId: patient_id,
                body: 'Someone in your Saathi care circle may need attention.'
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
            include: { symptomobservation: true, checkinanswer: ANSWER_INCLUDE },
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
            include: { symptomobservation: true, checkinanswer: ANSWER_INCLUDE },
            orderBy: { recorded_at: 'desc' },
            take: 30
        });

        return res.status(200).json({ status: 'success', data: history });
    } catch (error) { next(error); }
};
