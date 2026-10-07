const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const {
    verifyCommunicationAccess,
    verifyPatientDataEventAccess,
    isCentralCounsellor,
    getCentralCounsellorUserIds
} = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');
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

        // NEW: Strict MIME type validation
        if (!file.mimetype.startsWith('audio/')) {
            return res.status(400).json({ status: 'error', message: 'Invalid file type. Only audio files are allowed.' });
        }

        if (!supabase) {
            return res.status(500).json({ status: 'error', message: 'Supabase storage is not configured on server.' });
        }

        const fileExt = file.originalname?.split('.').pop() || 'm4a';
        const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('voice_notes')
            .upload(fileName, file.buffer, {
                contentType: file.mimetype,
                upsert: false
            });

        if (uploadError) {
            return res.status(500).json({ status: 'error', message: `Storage upload failed: ${uploadError.message}` });
        }

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

        if (!isUuid(patient_id)) {
            return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
        }

        const hasAccess = await verifyPatientDataEventAccess(currentUserId, patient_id);
        if (!hasAccess) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        const [centralUserIds, caregiverLinks, patientLink] = await Promise.all([
            getCentralCounsellorUserIds(),
            prisma.patientcaregiverlink.findMany({
                where: { patient_id, consent_status: 'GRANTED' }
            }),
            prisma.patientaccountlink.findFirst({
                where: {
                    patient_id,
                    relationship_type: { in: ['SELF', 'DELEGATE'] },
                    consent_status: 'GRANTED'
                },
                orderBy: { granted_at: 'asc' },
                include: { patient: true }
            })
        ]);

        // The central NGO head/counsellor is the only NGO contact.
        let contacts = [
            ...centralUserIds.map(id => ({
                userId: id,
                displayName: 'NGO Counsellor',
                role: 'NGO Staff',
                isStaff: true,
                isPatient: false,
                initial: 'N'
            })),
            ...caregiverLinks.map(c => ({
                userId: c.caregiver_user_id,
                displayName: c.relationship_label || 'Family Caregiver',
                role: 'Caregiver',
                isStaff: false,
                isPatient: false,
                initial: (c.relationship_label || 'F').charAt(0).toUpperCase()
            }))
        ];

        if (patientLink) {
            contacts.push({
                userId: patientLink.user_id,
                displayName: patientLink.patient?.full_name || 'Patient',
                role: 'Patient',
                isStaff: false,
                isPatient: true,
                initial: (patientLink.patient?.full_name || 'P').charAt(0).toUpperCase()
            });
        }

        // De-duplicate (a user can be e.g. both central NGO and a caregiver) and drop self.
        const seen = new Set();
        contacts = contacts.filter(c => {
            if (c.userId === currentUserId || seen.has(c.userId)) return false;
            seen.add(c.userId);
            return true;
        });

        return res.status(200).json({ status: 'success', data: contacts });
    } catch (error) { next(error); }
};

exports.openThread = async (req, res, next) => {
    try {
        const { participant_id } = req.body;
        const userId = req.user.userId;

        if (!isUuid(participant_id)) {
            return res.status(400).json({ status: 'error', message: 'participant_id is required and must be a valid UUID.' });
        }
        if (participant_id === userId) {
            return res.status(400).json({ status: 'error', message: 'You cannot open a conversation with yourself.' });
        }

        const rawPatientId = req.body.patient_id;
        const hasPatientContext = rawPatientId !== undefined && rawPatientId !== null && rawPatientId !== '';
        if (hasPatientContext && !isUuid(rawPatientId)) {
            return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
        }
        const patientId = hasPatientContext ? rawPatientId : null;

        const participant = await prisma.useraccount.findUnique({ where: { id: participant_id }, select: { id: true } });
        if (!participant) {
            return res.status(404).json({ status: 'error', message: 'Participant not found.' });
        }

        if (!patientId) {
            // Patientless threads are ONLY allowed with the central NGO head/counsellor.
            // Arbitrary patientless user-to-user conversations are not permitted.
            if (!(await isCentralCounsellor(participant_id))) {
                return res.status(403).json({
                    status: 'error',
                    message: 'A conversation without a patient context is only allowed with the NGO counsellor.'
                });
            }
        } else {
            const isAuthorized = await verifyCommunicationAccess(userId, participant_id, patientId);
            if (!isAuthorized) {
                return res.status(403).json({ status: 'error', message: 'Unauthorized communication participant combination.' });
            }
        }

        // patient_id is part of the identity of a conversation:
        // User <-> NGO <-> Patient A must never be reused for Patient B (or for no patient).
        let conversation = await prisma.chatconversation.findFirst({
            where: {
                patient_id: patientId,
                OR: [
                    { participant_one_id: userId, participant_two_id: participant_id },
                    { participant_one_id: participant_id, participant_two_id: userId }
                ]
            }
        });

        if (!conversation) {
            conversation = await prisma.chatconversation.create({
                data: {
                    patient_id: patientId,
                    participant_one_id: userId,
                    participant_two_id: participant_id
                }
            });
        }

        return res.status(200).json({ status: 'success', data: conversation });
    } catch (error) { next(error); }
};

// GET /api/chat/conversations            -> all of the authenticated user's conversations
// GET /api/chat/conversations?patient_id -> same, filtered to one patient context
exports.getConversations = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const patientFilter = req.query.patient_id;

        if (patientFilter !== undefined && patientFilter !== '' && !isUuid(patientFilter)) {
            return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
        }

        const where = {
            OR: [{ participant_one_id: userId }, { participant_two_id: userId }]
        };
        if (patientFilter) where.patient_id = patientFilter;

        const conversations = await prisma.chatconversation.findMany({
            where,
            include: {
                participant_one: { select: { id: true, email: true, full_name: true } },
                participant_two: { select: { id: true, email: true, full_name: true } },
                messages: { orderBy: { created_at: 'desc' }, take: 1 }
            }
        });

        // Most recently active first.
        const activityOf = (c) => new Date(c.messages[0]?.created_at || c.created_at).getTime();
        conversations.sort((a, b) => activityOf(b) - activityOf(a));

        return res.status(200).json({ status: 'success', data: conversations });
    } catch (error) { next(error); }
};

exports.getMessages = async (req, res, next) => {
    try {
        const { conversation_id } = req.params;
        const userId = req.user.userId;

        if (!isUuid(conversation_id)) {
            return res.status(400).json({ status: 'error', message: 'conversation_id must be a valid UUID.' });
        }

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

        if (!isUuid(conversation_id)) {
            return res.status(400).json({ status: 'error', message: 'conversation_id must be a valid UUID.' });
        }
        if (message_type === 'TEXT' && (typeof content !== 'string' || content.trim() === '')) {
            return res.status(400).json({ status: 'error', message: 'Text content is required for TEXT messages.'});
        }
        if ((message_type === 'AUDIO' || message_type === 'IMAGE') && (typeof media_url !== 'string' || media_url.trim() === '')) {
            return res.status(400).json({ status: 'error', message: `Media URL is required for ${message_type} messages.`});
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

        const io = req.app.get('io');
        if (io) {
            io.to(recipientId).emit('newMessage', message);
        }

        const [recipient, senderAccount] = await Promise.all([
            prisma.useraccount.findUnique({ where: { id: recipientId } }),
            prisma.useraccount.findUnique({ where: { id: userId } })
        ]);

        if (recipient && recipient.fcm_token) {
            const senderName = senderAccount?.full_name || senderAccount?.email?.split('@')[0] || 'Care Team';
            const textPreview = typeof content === 'string' ? content : '';
            let bodyPreview;
            if (message_type === 'AUDIO') bodyPreview = '🎤 Sent a voice message';
            else if (message_type === 'IMAGE' && !textPreview) bodyPreview = '📷 Sent a photo';
            else bodyPreview = textPreview.length > 50 ? textPreview.substring(0, 47) + '...' : textPreview;

            // Un-awaited to prevent blocking the HTTP response
            sendMessagePushNotification(recipient.fcm_token, {
                title: senderName,
                body: bodyPreview,
                conversationId: conversation_id,
                senderId: userId
            }).catch(console.error);
        }

        return res.status(201).json({ status: 'success', data: message });
    } catch (error) { next(error); }
};
