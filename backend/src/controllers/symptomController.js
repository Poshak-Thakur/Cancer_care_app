const prisma = require('../config/db');
const crypto = require('crypto');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');
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
                    const alert = await tx.alert.create({
                        data: {
                            patient_id,
                            type: 'DETERIORATION',
                            severity: 'HIGH',
                            status: 'OPEN',
                            source_type: 'CHECK_IN',
                            source_id: event.id
                        }
                    });

                    const patient = await tx.patient.findUnique({ where: { id: patient_id } });

                    const alertRecipients = await tx.patientaccountlink.findMany({
                        where: { patient_id, consent_status: 'GRANTED' },
                        include: { useraccount_patientaccountlink_user_idTouseraccount: true }
                    });

                    pendingAlert = {
                        alertId: alert.id,
                        patientName: patient?.full_name || 'A patient',
                        tokens: alertRecipients
                            .filter(r => r.user_id !== userId)
                            .map(r => r.useraccount_patientaccountlink_user_idTouseraccount?.fcm_token)
                            .filter(Boolean)
                    };
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
            const { alertId, patientName, tokens } = pendingAlert;
            tokens.forEach(fcmToken => {
                sendEmergencyAlertNotification(fcmToken, {
                    title: 'Severe symptoms reported',
                    alertId,
                    patientId: patient_id,
                    body: `${patientName} has reported severe symptoms and requires immediate attention.`
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
