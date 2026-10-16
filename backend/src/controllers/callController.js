const prisma = require('../config/db');
const crypto = require('crypto');
const { getAgoraCredentials, buildCallToken } = require('../services/agoraTokenService');
const { verifyCommunicationAccess, isCentralCounsellor } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');
const { sendCallPushNotification, sendCallCancelledPush } = require('../config/firebase');

const VALID_CALL_TYPES = ['AUDIO', 'VIDEO'];

// A call that is still INITIATED after this long is no longer "ringing" (same window as getIncomingCalls).
const RING_WINDOW_MS = 2 * 60 * 1000;

exports.initiateCall = async (req, res, next) => {
    try {
        const { receiver_id, patient_id, call_type = 'VIDEO' } = req.body;
        const callerId = req.user.userId;

        if (!receiver_id || !VALID_CALL_TYPES.includes(call_type)) {
            return res.status(400).json({ status: 'error', message: 'receiver_id and call_type are required.' });
        }
        if (!isUuid(receiver_id)) {
            return res.status(400).json({ status: 'error', message: 'receiver_id must be a valid UUID.' });
        }
        const hasPatientContext = patient_id !== undefined && patient_id !== null && patient_id !== '';
        if (hasPatientContext && !isUuid(patient_id)) {
            return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });
        }
        const patientContextId = hasPatientContext ? patient_id : null;

        // patient_id may be null for a direct call to the NGO counsellor. Whether a call is
        // allowed is decided ONLY by verifyCommunicationAccess - no staff logic lives here.
        const isAuthorized = await verifyCommunicationAccess(callerId, receiver_id, patientContextId);
        if (!isAuthorized) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized calling participant combination.' });
        }

        const receiver = await prisma.useraccount.findUnique({ where: { id: receiver_id } });
        if (!receiver) {
            return res.status(404).json({ status: 'error', message: 'Receiver not found.' });
        }

        const channelName = `saathi_room_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const agora = getAgoraCredentials();
        if (!agora) {
            return res.status(500).json({ status: 'error', message: 'Agora credentials missing on server.' });
        }
        const { appId } = agora;
        const token = buildCallToken(agora, channelName);

        const callSession = await prisma.callsession.create({
            data: {
                caller_id: callerId,
                receiver_id: receiver_id,
                patient_id: patientContextId,
                call_type: call_type,
                status: 'INITIATED',
                provider_room: channelName
            }
        });

        let callerName = "Saathi User";
        const callerIsCentral = await isCentralCounsellor(callerId);
        if (callerIsCentral) {
            callerName = "NGO Counsellor";
        } else {
            const patientLink = await prisma.patientaccountlink.findFirst({
                where: { user_id: callerId, consent_status: 'GRANTED', revoked_at: null },
                include: { patient: true }
            });
            if (patientLink?.patient?.full_name) {
                callerName = patientLink.patient.full_name;
            } else {
                const careLink = await prisma.patientcaregiverlink.findFirst({
                    where: { caregiver_user_id: callerId, consent_status: 'GRANTED', revoked_at: null }
                });
                if (careLink) callerName = careLink.relationship_label || "Caregiver";
            }
        }

        const io = req.app.get('io');
        if (io) {
            io.to(receiver_id).emit('incomingCall', {
                call_id: callSession.id,
                caller_id: callerId,
                caller_name: callerName,
                call_type,
                channelName,
                token,
                appId 
            });
        }

        if (receiver.fcm_token) {
            // PRIVACY: the FCM payload (lock screen / push infrastructure) never carries a patient's name.
            // The real caller_name is still delivered over the authenticated socket above.
            const pushCallerName = callerIsCentral ? 'NGO Counsellor' : 'Saathi care circle';
            // Un-awaited to prevent blocking the HTTP response
            sendCallPushNotification(receiver.fcm_token, {
                call_id: callSession.id,
                caller_id: callerId,
                caller_name: pushCallerName,
                call_type,
                channelName,
                token,
                appId
            }).catch(console.error);
        }

        return res.status(201).json({ status: 'success', data: { ...callSession, token, appId } });
    } catch (error) { next(error); }
};

exports.getIncomingCalls = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const incomingCalls = await prisma.callsession.findMany({
            where: {
                receiver_id: userId,
                status: 'INITIATED',
                created_at: { gte: new Date(Date.now() - RING_WINDOW_MS) }
            },
            include: { caller: { select: { id: true, email: true, full_name: true } } },
            orderBy: { created_at: 'desc' }
        });

        // Don't surface a ringing call if the relationship was revoked after it was placed.
        const stillValid = [];
        for (const call of incomingCalls) {
            if (await verifyCommunicationAccess(call.caller_id, userId, call.patient_id)) stillValid.push(call);
        }
        return res.status(200).json({ status: 'success', data: stillValid });
    } catch (error) { next(error); }
};

// POST /api/calls/:id/join-token
// Lets the RECEIVER of a call fetch a fresh Agora token for it - e.g. the NGO portal recovering a
// ringing call after its live (socket) connection dropped. Returns { token, appId, provider_room },
// built exactly like the token in POST /api/calls/initiate.
//
// Allowed only when ALL of these hold (checked on every request, nothing is cached):
//   - the caller is the call's receiver (the caller / other users can never mint a token for it);
//   - the call is INITIATED (and still ringing: within the same 2-minute window as GET /incoming)
//     or ONGOING;
//   - the relationship that allowed the call is still valid (verifyCommunicationAccess, the same
//     rule used to place the call and to accept it).
// The token is a credential: it is not logged and the response is marked no-store.
exports.joinToken = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid call id.' });

        const call = await prisma.callsession.findUnique({ where: { id } });
        // Strangers learn nothing about whether a call id exists.
        if (!call || (call.receiver_id !== userId && call.caller_id !== userId)) {
            return res.status(404).json({ status: 'error', message: 'Call not found' });
        }
        if (call.receiver_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Only the receiver of a call can request a join token.' });
        }

        const ringing = call.status === 'INITIATED' && new Date(call.created_at).getTime() >= Date.now() - RING_WINDOW_MS;
        if (!ringing && call.status !== 'ONGOING') {
            return res.status(409).json({
                status: 'error',
                code: 'CALL_NOT_JOINABLE',
                message: 'This call is no longer ringing or in progress.'
            });
        }
        if (!call.provider_room) {
            return res.status(409).json({ status: 'error', code: 'CALL_NOT_JOINABLE', message: 'This call has no live room.' });
        }

        const stillAuthorized = await verifyCommunicationAccess(call.caller_id, call.receiver_id, call.patient_id);
        if (!stillAuthorized) {
            return res.status(403).json({ status: 'error', message: 'You are no longer authorized to join this call.' });
        }

        const agora = getAgoraCredentials();
        if (!agora) {
            return res.status(500).json({ status: 'error', message: 'Agora credentials missing on server.' });
        }
        const token = buildCallToken(agora, call.provider_room);

        if (typeof res.set === 'function') res.set('Cache-Control', 'no-store');
        return res.status(200).json({
            status: 'success',
            data: { token, appId: agora.appId, provider_room: call.provider_room }
        });
    } catch (error) { next(error); }
};

exports.updateCallStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; 
        const userId = req.user.userId;

        const VALID_STATUSES = ['ONGOING', 'COMPLETED', 'MISSED', 'REJECTED'];
        if (!VALID_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid call status.' });
        }

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid call id.' });

        const call = await prisma.callsession.findUnique({ where: { id } });
        if (!call) return res.status(404).json({ status: 'error', message: 'Call not found' });

        if (call.caller_id !== userId && call.receiver_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this call.' });
        }

        if (['COMPLETED', 'MISSED', 'REJECTED'].includes(call.status)) {
            return res.status(400).json({ status: 'error', message: 'Call has already ended.' });
        }

        if (['ONGOING', 'REJECTED'].includes(status) && userId !== call.receiver_id) {
            return res.status(403).json({ status: 'error', message: 'Only the receiver can accept or reject an incoming call.' });
        }

        // Accepting (joining) a call requires CURRENT authorization for the call's patient context.
        // Hanging up / rejecting / marking missed is always allowed so a revoked user can never
        // leave a call stuck open.
        if (status === 'ONGOING') {
            const stillAuthorized = await verifyCommunicationAccess(call.caller_id, call.receiver_id, call.patient_id);
            if (!stillAuthorized) {
                return res.status(403).json({ status: 'error', message: 'You are no longer authorized to join this call.' });
            }
        }

        const updatedCall = await prisma.callsession.update({
            where: { id },
            data: {
                status,
                started_at: status === 'ONGOING' ? new Date() : undefined,
                ended_at: ['COMPLETED', 'REJECTED', 'MISSED'].includes(status) ? new Date() : undefined
            }
        });

        // If caller hangs up before answering, tell the receiver's phone to stop ringing
        if (call.status === 'INITIATED' && ['COMPLETED', 'MISSED', 'REJECTED'].includes(status)) {
            const receiver = await prisma.useraccount.findUnique({ where: { id: call.receiver_id } });
            if (receiver && receiver.fcm_token) {
                sendCallCancelledPush(receiver.fcm_token, id).catch(console.error);
            }
        }

        const io = req.app.get('io');
        if (io) {
            const targetUser = userId === call.caller_id ? call.receiver_id : call.caller_id;
            io.to(targetUser).emit('callStatusUpdated', { call_id: id, status });
        }

        return res.status(200).json({ status: 'success', data: updatedCall });
    } catch (error) { next(error); }
};
