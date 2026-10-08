const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const {
    verifyCommunicationAccess,
    verifyPatientDataEventAccess,
    isCentralCounsellor,
    getCentralCounsellorUserIds,
    listActiveCaregiverLinks,
    listActiveAccountLinks
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

// Read access to an existing conversation, re-checked against CURRENT authorization.
//   - central NGO: always allowed to read its own conversations
//   - patient-specific thread: the user must still be in that patient's network
//   - patientless thread: only valid while the other participant is the central NGO
const canStillAccessConversation = async (userId, conversation) => {
    if (await isCentralCounsellor(userId)) return true;
    if (conversation.patient_id) {
        return verifyPatientDataEventAccess(userId, conversation.patient_id);
    }
    const otherId = conversation.participant_one_id === userId
        ? conversation.participant_two_id
        : conversation.participant_one_id;
    return verifyCommunicationAccess(userId, otherId, null);
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

        // Active = consent GRANTED + revoked_at NULL (caregivers must also be NGO-recognised);
        // all of that lives in the authorization service.
        const [centralUserIds, caregiverLinks, accountLinks, patient] = await Promise.all([
            getCentralCounsellorUserIds(),
            listActiveCaregiverLinks(patient_id),
            listActiveAccountLinks(patient_id),
            prisma.patient.findUnique({ where: { id: patient_id }, select: { full_name: true } })
        ]);

        // A patient can have several account holders (SELF + any number of DELEGATEs): return all of them.
        const holderIds = accountLinks.map((l) => l.user_id);
        const holders = holderIds.length > 0
            ? await prisma.useraccount.findMany({ where: { id: { in: holderIds } }, select: { id: true, full_name: true } })
            : [];
        const holderName = new Map(holders.map((u) => [u.id, u.full_name]));

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
            })),
            ...accountLinks.map(l => {
                const isSelf = l.relationship_type === 'SELF';
                const name = isSelf
                    ? (patient?.full_name || 'Patient')
                    : (holderName.get(l.user_id) || l.relationship_label || 'Delegate');
                return {
                    userId: l.user_id,
                    displayName: name,
                    role: isSelf ? 'Patient' : 'Delegate',
                    isStaff: false,
                    isPatient: isSelf,
                    isDelegate: !isSelf,
                    initial: name.charAt(0).toUpperCase()
                };
            })
        ];

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

        const allConversations = await prisma.chatconversation.findMany({
            where,
            include: {
                participant_one: { select: { id: true, email: true, full_name: true } },
                participant_two: { select: { id: true, email: true, full_name: true } },
                messages: { orderBy: { created_at: 'desc' }, take: 1 }
            }
        });

        // Being a participant is NOT enough. Re-check CURRENT authorization before a conversation
        // (metadata, participants, latest-message preview) is returned, so a revoked caregiver /
        // delegate no longer sees patient-specific threads. Patientless NGO helpline threads still
        // work. Decisions are cached per patient so the check runs once per patient, not per thread.
        const centralCaller = await isCentralCounsellor(userId);
        const patientDecision = new Map();
        const conversations = [];
        for (const conversation of allConversations) {
            if (centralCaller) { conversations.push(conversation); continue; }
            if (conversation.patient_id) {
                if (!patientDecision.has(conversation.patient_id)) {
                    patientDecision.set(conversation.patient_id, await verifyPatientDataEventAccess(userId, conversation.patient_id));
                }
                if (!patientDecision.get(conversation.patient_id)) continue;
                conversations.push(conversation);
            } else if (await canStillAccessConversation(userId, conversation)) {
                conversations.push(conversation);
            }
        }

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

        // Being a participant is not enough: access must still be valid TODAY.
        // A revoked patient/delegate/caregiver loses an already-created conversation immediately.
        if (!(await canStillAccessConversation(userId, conversation))) {
            return res.status(403).json({ status: 'error', message: 'You no longer have access to this conversation.' });
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

        const recipientId = conversation.participant_one_id === userId
            ? conversation.participant_two_id
            : conversation.participant_one_id;

        // Sending needs BOTH sides to be currently authorized for this patient context
        // (creation-time authorization alone is not enough after a revocation).
        const stillAuthorized = await verifyCommunicationAccess(userId, recipientId, conversation.patient_id);
        if (!stillAuthorized) {
            return res.status(403).json({ status: 'error', message: 'You can no longer send messages in this conversation.' });
        }

        const message = await prisma.chatmessage.create({
            data: { conversation_id, sender_id: userId, message_type, content: content || null, media_url: media_url || null }
        });

        const io = req.app.get('io');
        if (io) {
            io.to(recipientId).emit('newMessage', message);
        }

        const recipient = await prisma.useraccount.findUnique({ where: { id: recipientId } });

        if (recipient && recipient.fcm_token) {
            // PRIVACY: lock-screen previews carry no sender name, patient name or message text.
            // The actual message is only readable inside the authenticated app.
            // Un-awaited to prevent blocking the HTTP response
            sendMessagePushNotification(recipient.fcm_token, {
                title: 'Saathi',
                body: 'You have a new Saathi message.',
                conversationId: conversation_id,
                senderId: userId
            }).catch(console.error);
        }

        return res.status(201).json({ status: 'success', data: message });
    } catch (error) { next(error); }
};
