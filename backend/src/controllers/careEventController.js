const prisma = require('../config/db');

// Helper function to enforce Role-Based Access Control (RBAC)
const verifyAccess = async (userId, patientId) => {
    return await prisma.patientaccountlink.findFirst({
        where: { user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
    });
};

exports.getDailyEvents = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const { date } = req.query; // Expected format: YYYY-MM-DD
        const userId = req.user.userId;

        if (!await verifyAccess(userId, patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient.' });
        }

        // Default to today if no date is provided
        const targetDate = date ? new Date(date) : new Date();
        const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

        const events = await prisma.careevent.findMany({
            where: {
                patient_id,
                schedule_time: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            },
            include: {
                patientmedication: {
                    select: { name: true, strength: true, form: true, instructions: true }
                }
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
        const { patient_id, type, schedule_time, patient_medication_id, reminder_rule } = req.body;
        const userId = req.user.userId;

        if (!await verifyAccess(userId, patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient.' });
        }

        const newEvent = await prisma.careevent.create({
            data: {
                patient_id,
                type, // Enum: MEDICATION_DOSE, APPOINTMENT, THERAPY_SESSION, OTHER
                schedule_time: new Date(schedule_time),
                patient_medication_id: patient_medication_id || null,
                assignee_user_id: userId,
                reminder_rule: reminder_rule || null
            }
        });

        return res.status(201).json({ status: 'success', data: newEvent });
    } catch (error) {
        next(error);
    }
};

exports.updateEventStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { completion_status } = req.body; // Enum: COMPLETED, MISSED, SNOOZED, CANCELLED
        const userId = req.user.userId;

        // Fetch event to get patient_id for RBAC check
        const event = await prisma.careevent.findUnique({ where: { id } });
        if (!event) return res.status(404).json({ status: 'error', message: 'Event not found' });

        if (!await verifyAccess(userId, event.patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });
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