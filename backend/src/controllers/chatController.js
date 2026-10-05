const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { verifyCommunicationAccess, verifyPatientDataEventAccess } = require('../services/authorizationService');
const { sendMessagePushNotification } = require('../config/firebase');

const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

exports.uploadAudio = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ status: 'error', message: 'Audio file is required.' });
        }

        if (!supabase) {
            return res.status(500).json({ status: 'error', message: 'Supabase storage is not configured on server.' });
        }

        const fileExt = file.originalname?.split('.').pop() || 'm4a';
        const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('voice_notes')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype || 'audio/m4a',
                upsert: false
            });

        if (uploadError) {
            return res.status(500).json({ status: 'error', message: `Storage upload failed: ${uploadError.message}` });
        }

        // 3-Day Signed URL for audio notes
        const { data: urlData, error: signError } = await supabase.storage
            .from('voice_notes')
            .createSignedUrl(fileName, 259200);

        if (signError) {
            return res.status(500).json({ status: 'error', message: `Failed to generate secure URL: ${signError.message}` });
        }

        return res.status(200).json({
            status: 'success',
            data: {
                file_path: fileName,
                media_url: urlData.signedUrl
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.getContacts = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const currentUserId = req.user.userId;

        const hasAccess = await verifyPatientDataEventAccess(currentUserId, patient_id);
        if (!hasAccess) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const [staffAssignments, centralProfiles, caregiverLinks, patientLink] = await Promise.all([
            prisma.staffassignment.findMany({
                where: { patient_id, status: 'ACTIVE' }
            }),
            prisma.staffprofile.findMany({
                where: { is_active: true }
            }),
            prisma.patientcaregiverlink.findMany({
                where: { patient_id, consent_status: 'GRANTED' }
            }),
            prisma.patientaccountlink.findFirst({
                where: { patient_id, relationship_type: { in: ['SELF', 'DELEGATE'] } },
                include: { patient: true }
            })
        ]);

        const staffMap = new Map();
        centralProfiles.forEach(p => {
            staffMap.set(p.user_id, { 
                userId: p.user_id, 
                displayName: 'NGO Counsellor', 
                role: 'NGO Staff', 
                isStaff: true,
                isPatient: false,
                initial: 'N' 
            });
        });
        staffAssignments.forEach(s => {
            staffMap.set(s.staff_user_id, { 
                userId: s.staff_user_id, 
                displayName: 'NGO Counsellor', 
                role: 'NGO Staff', 
                isStaff: true,
                isPatient: false,
                initial: 'N' 
            });
        });

        let contacts = [
            ...Array.from(staffMap.values()),
            ...caregiverLinks.map(c => ({
                userId: c.caregiver_user_id,
                displayName: c.relationship_label || 'Family Caregiver',
                role: 'Caregiver',
                isStaff: false,
                isPatient: false,
                initial: (c.relationship_label || 'F').charAt(0).toUpperCase()
            }))
        ];

        if (patientLink && patientLink.user_id !== currentUserId) {
            contacts.push({
                userId: patientLink.user_id,
                displayName: patientLink.patient?.full_name || 'Patient',
                role: 'Patient',
                isStaff: false,
                isPatient: true,
                initial: (patientLink.patient?.full_name || 'P').charAt(0).toUpperCase()
            });
        }

        contacts = contacts.filter(c => c.userId !== currentUserId);
        return res.status(200).json({ status: 'success', data: contacts });
    } catch (error) { next(error); }
};

exports.openThread = async (req, res, next) => {
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
                data: { patient_id, participant_one_id: userId, participant_two_id: participant_id }
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
                OR: [{ participant_one_id: userId }, { participant_two_id: userId }]
            },
            include: {
                participant_one: { select: { id: true, email: true } },
                participant_two: { select: { id: true, email: true } },
                messages: { orderBy: { created_at: 'desc' }, take: 1 }
            }
        });

        return res.status(200).json({ status: 'success', data: conversations });
    } catch (error) { next(error); }
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

        if (message_type === 'TEXT' && (!content || content.trim() === '')) {
            return res.status(400).json({ status: 'error', message: 'Text content is required for TEXT messages.'});
        }
        if (message_type === 'AUDIO' && (!media_url || media_url.trim() === '')) {
            return res.status(400).json({ status: 'error', message: 'Media URL is required for AUDIO messages.'});
        }
        const VALID_TYPES = ['TEXT', 'IMAGE', 'AUDIO', 'SYSTEM'];
        if (!VALID_TYPES.includes(message_type)) {
            return res.status(400).json({ status: 'error', message: 'Invalid message_type.'});
        }

        const conversation = await prisma.chatconversation.findUnique({ where: { id: conversation_id } });
        if (!conversation) return res.status(404).json({ status: 'error', message: 'Conversation not found.' });

        if (conversation.participant_one_id !== userId && conversation.participant_two_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized: you cannot post to a conversation you are not part of.' });
        }

        const message = await prisma.chatmessage.create({
            data: { conversation_id, sender_id: userId, message_type, content: content || null, media_url: media_url || null }
        });

        const recipientId = conversation.participant_one_id === userId 
            ? conversation.participant_two_id 
            : conversation.participant_one_id;

        // 1. WebSocket live delivery
        const io = req.app.get('io');
        if (io) {
            io.to(recipientId).emit('newMessage', message);
        }

        // 2. Standard FCM Push Notification
        const [recipient, senderAccount] = await Promise.all([
            prisma.useraccount.findUnique({ where: { id: recipientId } }),
            prisma.useraccount.findUnique({ where: { id: userId } })
        ]);

        if (recipient && recipient.fcm_token) {
            const senderName = senderAccount?.email?.split('@')[0] || 'Care Team';
            const bodyPreview = message_type === 'AUDIO' 
                ? '🎤 Sent a voice message' 
                : (content.length > 50 ? content.substring(0, 47) + '...' : content);

            await sendMessagePushNotification(recipient.fcm_token, {
                title: senderName,
                body: bodyPreview,
                conversationId: conversation_id,
                senderId: userId
            });
        }

        return res.status(201).json({ status: 'success', data: message });
    } catch (error) { next(error); }
};