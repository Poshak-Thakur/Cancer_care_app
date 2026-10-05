const prisma = require('../config/db');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const VALID_EVENT_TYPES = ['MEDICATION_DOSE', 'APPOINTMENT', 'THERAPY_SESSION', 'COUNSELLOR_FOLLOWUP', 'HOME_VISIT', 'OTHER'];
const VALID_COMPLETION_STATUSES = ['SCHEDULED', 'DUE', 'COMPLETED', 'MISSED', 'SNOOZED', 'CANCELLED'];

// Initialize Gemini AI
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

exports.parseCommand = async (req, res, next) => {
    try {
        const { text_input } = req.body;

        if (!text_input) {
            return res.status(400).json({ status: 'error', message: 'text_input is required (accepts both typed and transcribed voice).' });
        }

        if (!genAI) {
            return res.status(500).json({ status: 'error', message: 'AI service not configured on the server.' });
        }

        // Inject current server time so the AI can resolve relative terms like "tomorrow" or "next week"
        const currentDateTime = new Date().toISOString();
        
        const prompt = `
            You are a medical scheduling AI assistant. Extract appointment or medication reminder details from the user's text.
            Current date and time for reference: ${currentDateTime}
            
            User Input: "${text_input}"
            
            Return ONLY a strict JSON object with these exact keys. Do not include markdown formatting or backticks.
            {
                "type": "APPOINTMENT", // Must be one of: APPOINTMENT, MEDICATION_DOSE, THERAPY_SESSION, COUNSELLOR_FOLLOWUP, HOME_VISIT, OTHER
                "title": "Short title based on input",
                "schedule_time": "ISO-8601 UTC string calculated from the input and current date",
                "location": "Extracted location or null",
                "note": "Any additional context or null"
            }
        `;

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const aiResponse = await model.generateContent(prompt);
        const responseText = aiResponse.response.text();
        
        // Strip markdown backticks in case Gemini tries to format it as a code block
        const cleanedJsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(cleanedJsonStr);

        // Return the parsed data for the Flutter app to display in a confirmation form
        return res.status(200).json({ status: 'success', data: extractedData });
    } catch (error) { 
        next(error); 
    }
};

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