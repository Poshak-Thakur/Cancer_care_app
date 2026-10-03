const prisma = require('../config/db');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');

const VALID_EVENT_TYPES = ['MEDICATION_DOSE', 'APPOINTMENT', 'THERAPY_SESSION', 'COUNSELLOR_FOLLOWUP', 'HOME_VISIT', 'OTHER'];
const VALID_COMPLETION_STATUSES = ['SCHEDULED', 'DUE', 'COMPLETED', 'MISSED', 'SNOOZED', 'CANCELLED'];

exports.getDailyEvents = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const { date } = req.query;
        const userId = req.user.userId;

        if (!patient_id) {
            return res.status(400).json({ status: 'error', message: 'patient_id is required.' });
        }

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
        }

        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(targetDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const events = await prisma.careevent.findMany({
            where: { 
                patient_id, 
                schedule_time: { gte: startOfDay, lte: endOfDay } 
            },
            include: { 
                patientmedication: { select: { name: true, instructions: true, strength: true, form: true } } 
            },
            orderBy: { schedule_time: 'asc' }
        });

        return res.status(200).json({ status: 'success', data: events });
    } catch (error) { 
        next(error); 
    }
};

exports.createEvent = async (req, res, next) => {
    try {
        const { patient_id, type, schedule_time, reminder_rule, patient_medication_id } = req.body;
        const userId = req.user.userId;

        if (!patient_id || !type || !schedule_time) {
            return res.status(400).json({ status: 'error', message: 'patient_id, type, and schedule_time are required.' });
        }

        if (!VALID_EVENT_TYPES.includes(type)) {
            return res.status(400).json({ status: 'error', message: `Invalid care event type: ${type}.` });
        }

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient record.' });
        }

        const event = await prisma.careevent.create({
            data: {
                patient_id,
                type,
                schedule_time: new Date(schedule_time),
                reminder_rule: reminder_rule || null,
                patient_medication_id: patient_medication_id || null,
                assignee_user_id: userId
            }
        });

        return res.status(201).json({ status: 'success', data: event });
    } catch (error) { 
        next(error); 
    }
};

exports.updateEventStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { completion_status } = req.body;
        const userId = req.user.userId;

        if (!VALID_COMPLETION_STATUSES.includes(completion_status)) {
            return res.status(400).json({ status: 'error', message: `Invalid completion_status: ${completion_status}.` });
        }

        const event = await prisma.careevent.findUnique({ where: { id } });
        if (!event) return res.status(404).json({ status: 'error', message: 'Care event not found.' });

        // Access check uses the event's immutable patient_id
        const hasAccess = await verifyPatientDataEventAccess(userId, event.patient_id);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to modify this event.' });
        }

        const updatedEvent = await prisma.careevent.update({
            where: { id },
            data: { 
                completion_status, 
                completed_at: completion_status === 'COMPLETED' ? new Date() : null 
            }
        });

        return res.status(200).json({ status: 'success', data: updatedEvent });
    } catch (error) { 
        next(error); 
    }
};