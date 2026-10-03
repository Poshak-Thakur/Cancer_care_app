const prisma = require('../config/db');
const crypto = require('crypto');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');

exports.submitCheckIn = async (req, res, next) => {
    try {
        const { patient_id, observations, source = 'ROUTINE', client_event_id } = req.body;
        const userId = req.user.userId;

        if (!patient_id) {
            return res.status(400).json({ status: 'error', message: 'patient_id is required.' });
        }

        if (!Array.isArray(observations) || observations.length === 0) {
            return res.status(400).json({ status: 'error', message: 'At least one symptom observation is required.' });
        }

        // Validate observation types and severity range
        for (const obs of observations) {
            if (!obs.observation_type || typeof obs.observation_type !== 'string') {
                return res.status(400).json({ status: 'error', message: 'Each observation must include an observation_type string.' });
            }
            if (obs.severity !== undefined && obs.severity !== null) {
                const sev = Number(obs.severity);
                if (isNaN(sev) || sev < 0 || sev > 10) {
                    return res.status(400).json({ status: 'error', message: 'Observation severity must be a numeric value between 0 and 10.' });
                }
            }
        }

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
        }

        const eventId = crypto.randomUUID();
        const eventUuid = client_event_id || crypto.randomUUID();

        const symptomEvent = await prisma.$transaction(async (tx) => {
            const event = await tx.symptomevent.create({
                data: {
                    id: eventId,
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
                observation_type: obs.observation_type,
                severity: obs.severity !== undefined && obs.severity !== null ? Number(obs.severity) : null,
                numeric_value: obs.numeric_value !== undefined && obs.numeric_value !== null ? obs.numeric_value : null,
                unit: obs.unit || null,
                note: obs.note || null
            }));

            await tx.symptomobservation.createMany({
                data: observationData
            });

            return event;
        });

        // Unintended side effect of completing care events has been removed

        return res.status(201).json({
            status: 'success',
            message: 'Check-in recorded safely.',
            data: symptomEvent
        });
    } catch (error) {
        next(error);
    }
};

exports.getTodayCheckInStatus = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;

        if (!patient_id) {
            return res.status(400).json({ status: 'error', message: 'patient_id is required.' });
        }

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
        }

        const startOfDay = new Date();
        startOfDay.setUTCHours(0, 0, 0, 0);

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
    } catch (error) {
        next(error);
    }
};

exports.getSymptomHistory = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;

        if (!patient_id) {
            return res.status(400).json({ status: 'error', message: 'patient_id is required.' });
        }

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
        }

        const history = await prisma.symptomevent.findMany({
            where: { patient_id },
            include: { symptomobservation: true },
            orderBy: { recorded_at: 'desc' },
            take: 30
        });

        return res.status(200).json({ status: 'success', data: history });
    } catch (error) {
        next(error);
    }
};