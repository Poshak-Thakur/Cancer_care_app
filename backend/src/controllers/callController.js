const prisma = require('../config/db');
const crypto = require('crypto');
const { RtcTokenBuilder, RtcRole } = require('agora-token');
const { verifyCommunicationAccess } = require('../services/authorizationService');

const VALID_CALL_TYPES = ['AUDIO', 'VIDEO'];

exports.initiateCall = async (req, res, next) => {
    try {
        const { receiver_id, patient_id, call_type = 'VIDEO' } = req.body;
        const callerId = req.user.userId;

        if (!receiver_id || !patient_id || !VALID_CALL_TYPES.includes(call_type)) {
            return res.status(400).json({ status: 'error', message: 'receiver_id, patient_id, and call_type are strictly required.' });
        }

        const isAuthorized = await verifyCommunicationAccess(callerId, receiver_id, patient_id);
        if (!isAuthorized) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized calling participant combination for this patient context.' });
        }

        const channelName = `saathi_room_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
        const appId = process.env.AGORA_APP_ID || '';
        const appCertificate = process.env.AGORA_APP_CERTIFICATE || '';
        
        if (!appId || !appCertificate) {
            return res.status(500).json({ status: 'error', message: 'Agora credentials missing on server.' });
        }

        const privilegeExpiredTs = Math.floor(Date.now() / 1000) + 3600;
        const token = RtcTokenBuilder.buildTokenWithUid(
            appId, appCertificate, channelName, 0, RtcRole.PUBLISHER, privilegeExpiredTs
        );

        const callSession = await prisma.callsession.create({
            data: {
                caller_id: callerId,
                receiver_id: receiver_id,
                patient_id: patient_id,
                call_type: call_type,
                status: 'INITIATED',
                provider_room: channelName
            }
        });

        const io = req.app.get('io');
        if (io) {
            io.to(receiver_id).emit('incomingCall', {
                call_id: callSession.id,
                caller_id: callerId,
                call_type,
                channelName,
                token,
                appId 
            });
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
                created_at: { gte: new Date(Date.now() - 2 * 60 * 1000) } 
            },
            include: { caller: { select: { id: true, email: true } } },
            orderBy: { created_at: 'desc' }
        });
        return res.status(200).json({ status: 'success', data: incomingCalls });
    } catch (error) { next(error); }
};

exports.updateCallStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status } = req.body; 
        const userId = req.user.userId;

        const call = await prisma.callsession.findUnique({ where: { id } });
        if (!call) return res.status(404).json({ status: 'error', message: 'Call not found' });

        if (call.caller_id !== userId && call.receiver_id !== userId) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this call.' });
        }

        // Strict Transition Authorization
        if (['ONGOING', 'REJECTED'].includes(status) && userId !== call.receiver_id) {
            return res.status(403).json({ status: 'error', message: 'Only the receiver can accept or reject an incoming call.' });
        }

        const updatedCall = await prisma.callsession.update({
            where: { id },
            data: {
                status,
                started_at: status === 'ONGOING' ? new Date() : undefined,
                ended_at: ['COMPLETED', 'REJECTED', 'MISSED'].includes(status) ? new Date() : undefined
            }
        });

        const io = req.app.get('io');
        if (io) {
            const targetUser = userId === call.caller_id ? call.receiver_id : call.caller_id;
            io.to(targetUser).emit('callStatusUpdated', { call_id: id, status });
        }

        return res.status(200).json({ status: 'success', data: updatedCall });
    } catch (error) { next(error); }
};