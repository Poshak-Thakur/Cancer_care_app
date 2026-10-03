const prisma = require('../config/db');
const { verifyCommunicationAccess } = require('../services/authorizationService');

exports.getCareTeamContacts = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const currentUserId = req.user.userId;

        const staffLinks = await prisma.staffassignment.findMany({
            where: { patient_id: patient_id, status: 'ACTIVE' },
            include: { useraccount: { select: { id: true, email: true } } }
        });

        const caregiverLinks = await prisma.patientcaregiverlink.findMany({
            where: { patient_id: patient_id, consent_status: 'GRANTED' },
            include: { useraccount: { select: { id: true, email: true } } }
        });

        const patientLink = await prisma.patientaccountlink.findFirst({
            where: { patient_id: patient_id, relationship_type: { in: ['SELF', 'DELEGATE'] } },
            include: { patient: true, useraccount: { select: { id: true, email: true } } }
        });

        let contacts = [
            ...staffLinks.map(s => ({
                user_id: s.staff_user_id,
                name: 'NGO Counsellor', 
                role: 'NGO Staff',
                category: 'STAFF'
            })),
            ...caregiverLinks.map(c => ({
                user_id: c.caregiver_user_id,
                name: c.relationship_label || 'Caregiver',
                role: c.relationship_label || 'Caregiver',
                category: 'CAREGIVER'
            }))
        ];

        // If the caller is a caregiver or staff, allow them to contact the patient
        if (patientLink && patientLink.user_id !== currentUserId) {
            contacts.push({
                user_id: patientLink.user_id,
                name: patientLink.patient.full_name || 'Patient',
                role: 'Patient',
                category: 'PATIENT'
            });
        }

        // Remove the caller from their own directory list
        contacts = contacts.filter(c => c.user_id !== currentUserId);

        return res.status(200).json({ status: 'success', data: contacts });
    } catch (error) { 
        next(error); 
    }
};

exports.getOrCreateConversation = async (req, res, next) => {
    try {
        const { patient_id, participant_id } = req.body;
        const userId = req.user.userId;

        if (!patient_id || !participant_id) {
            return res.status(400).json({ status: 'error', message: 'patient_id and participant_id are required.' });
        }

        const isAuthorized = await verifyCommunicationAccess(userId, participant_id, patient_id);
        if (!isAuthorized) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized to initiate a conversation with this participant.' });
        }

        let conversation = await prisma.chatconversation.findFirst({
            where: {
                patient_id,
                OR: [
                    { participant_one_id: userId, participant_two_id: participant_id },
                    { participant_one_id: participant_id, participant_two_id: userId }
                ]
            }
        });

        if (!conversation) {
            conversation = await prisma.chatconversation.create({
                data: {
                    patient_id,
                    participant_one_id: userId,
                    participant_two_id: participant_id
                }
            });
        }

        return res.status(200).json({ status: 'success', data: conversation });
    } catch (error) { next(error); }
};

exports.getConversations = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;

        const conversations = await prisma.chatconversation.findMany({
            where: { 
                patient_id,
                OR: [
                    { participant_one_id: userId },
                    { participant_two_id: userId }
                ]
            },
            include: {
                participant_one: { select: { id: true, email: true } },
                participant_two: { select: { id: true, email: true } },
                messages: { orderBy: { created_at: 'desc' }, take: 1 }
            }
        });

        return res.status(200).json({ status: 'success', data: conversations });
    } catch (error) { 
        next(error); 
    }
};

exports.getMessages = async (req, res, next) => {
    try {
        const { conversation_id } = req.params;
        const userId = req.user.userId;
        
        const conversation = await prisma.chatconversation.findUnique({ where: { id: conversation_id } });
        if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });

        if (conversation.participant_one_id !== userId && conversation.participant_two_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: you are not a participant in this conversation.' });
        }

        const messages = await prisma.chatmessage.findMany({
            where: { conversation_id },
            orderBy: { created_at: 'asc' },
            include: { sender: { select: { id: true } } }
        });

        const unreadIds = messages.filter(m => !m.is_read && m.sender_id !== userId).map(m => m.id);
        if (unreadIds.length > 0) {
            await prisma.chatmessage.updateMany({ where: { id: { in: unreadIds } }, data: { is_read: true } });
        }

        return res.status(200).json({ status: 'success', data: messages });
    } catch (error) { next(error); }
};

exports.sendMessage = async (req, res, next) => {
    try {
        const { conversation_id, content, message_type = 'TEXT', media_url } = req.body;
        const userId = req.user.userId;

        const conversation = await prisma.chatconversation.findUnique({ where: { id: conversation_id } });
        if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });

        if (conversation.participant_one_id !== userId && conversation.participant_two_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: you cannot post to a conversation you are not part of.' });
        }

        const message = await prisma.chatmessage.create({
            data: {
                conversation_id,
                sender_id: userId,
                message_type, 
                content: content || null,
                media_url: media_url || null
            }
        });

        return res.status(201).json({ status: 'success', data: message });
    } catch (error) { next(error); }
};