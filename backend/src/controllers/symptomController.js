const prisma = require('../config/db');
const crypto = require('crypto');

// Helper to enforce Role-Based Access Control
const verifyAccess = async (userId, patientId) => {
    return await prisma.patientaccountlink.findFirst({
        where: { user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
    });
};

exports.submitCheckIn = async (req, res, next) => {
    try {
        const { patient_id, overall_feeling, observations } = req.body; 
        const userId = req.user.userId;

        if (!await verifyAccess(userId, patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });
        }

        // 1. Create the parent event (The Check-in)
        const symptomEvent = await prisma.symptomevent.create({
            data: {
                patient_id: patient_id,
                recorded_by: userId,
                source: 'ROUTINE',
                client_event_id: crypto.randomUUID(),
                // 2. Map the array of observations (e.g., mood, nausea, pain) to the nested table
                symptomobservation: {
                    create: observations.map(obs => ({
                        observation_type: obs.observation_type, // e.g., 'MOOD', 'NAUSEA'
                        severity: obs.severity,                 // 1-10 scale
                        note: obs.note || null
                    }))
                }
            },
            include: { symptomobservation: true }
        });

        // 3. Mark the "Daily Check-in" care event as completed if one was scheduled for today
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        
        await prisma.careevent.updateMany({
            where: {
                patient_id: patient_id,
                type: 'OTHER', // Assuming "Check-in" is stored as an OTHER task
                schedule_time: { gte: startOfDay },
                completion_status: 'SCHEDULED'
            },
            data: {
                completion_status: 'COMPLETED',
                completed_at: new Date()
            }
        });

        return res.status(201).json({
            status: 'success',
            message: 'Check-in completed successfully',
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

        if (!await verifyAccess(userId, patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });
        }

        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        // Fetch the most recent check-in for today to populate the "I'm okay" UI card
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