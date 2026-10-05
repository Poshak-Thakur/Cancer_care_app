const prisma = require('../config/db');
const crypto = require('crypto');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');

exports.createProfile = async (req, res, next) => {
    try {
        const { caregiver_type } = req.body; 
        const userId = req.user.userId;

        if (!['FAMILY', 'VOLUNTEER'].includes(caregiver_type)) {
            return res.status(400).json({ status: 'error', message: 'caregiver_type must be FAMILY or VOLUNTEER' });
        }

        const profile = await prisma.caregiverprofile.create({
            data: {
                user_id: userId,
                caregiver_type,
                volunteer_status: caregiver_type === 'VOLUNTEER' ? 'PENDING' : 'APPROVED' 
            }
        });

        return res.status(201).json({ status: 'success', data: profile });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ status: 'error', message: 'Caregiver profile already exists.' });
        next(error);
    }
};

exports.generateInvite = async (req, res, next) => {
    try {
        const patientId = req.body.patient_id || req.params.patient_id;
        const userId = req.user.userId;

        if (!patientId) return res.status(400).json({ status: 'error', message: 'patient_id is required' });

        const hasAccess = await verifyPatientDataEventAccess(userId, patientId);
        if (!hasAccess) {
            return res.status(403).json({ status: 'error', message: 'Only authorized accounts can generate caregiver invites.' });
        }

        const code = crypto.randomBytes(4).toString('hex').toUpperCase();
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        
        await prisma.caregiverinvite.create({
            data: {
                patient_id: patientId,
                code: code,
                expires_at: expiresAt
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                invite_code: code,
                code: code,
                expires_at: expiresAt.toISOString(),
                patient_id: patientId
            }
        });
    } catch (error) {
        next(error);
    }
};

exports.acceptInvite = async (req, res, next) => {
    try {
        const { invite_code, code, relationship_label } = req.body;
        const tokenToVerify = invite_code || code;
        const userId = req.user.userId;

        if (!tokenToVerify) return res.status(400).json({ status: 'error', message: 'Invite code is required.' });

        const invite = await prisma.caregiverinvite.findUnique({ where: { code: tokenToVerify } });
        if (!invite || invite.is_used || invite.expires_at < new Date()) {
            return res.status(400).json({ status: 'error', message: 'Invalid or expired invite code.' });
        }

        await prisma.caregiverinvite.update({ where: { id: invite.id }, data: { is_used: true } });
        const patientId = invite.patient_id;

        await prisma.caregiverprofile.upsert({
            where: { user_id: userId },
            update: {},
            create: {
                user_id: userId,
                caregiver_type: 'FAMILY',
                volunteer_status: 'APPROVED',
                training_status: 'COMPLETE'
            }
        });

        const link = await prisma.patientcaregiverlink.upsert({
            where: {
                patient_id_caregiver_user_id: { patient_id: patientId, caregiver_user_id: userId }
            },
            update: {
                consent_status: 'GRANTED',
                relationship_label: relationship_label || 'Caregiver',
                availability: 'AVAILABLE'
            },
            create: {
                patient_id: patientId,
                caregiver_user_id: userId,
                relationship_label: relationship_label || 'Caregiver',
                consent_status: 'GRANTED',
                availability: 'AVAILABLE'
            },
            include: { patient: true }
        });

        return res.status(200).json({ status: 'success', message: 'Successfully linked to patient.', data: link });
    } catch (error) {
        next(error);
    }
};

exports.revokeCaregiver = async (req, res, next) => {
    try {
        const { patient_id, caregiver_user_id } = req.body;
        const userId = req.user.userId;

        const hasAccess = await verifyPatientDataEventAccess(userId, patient_id);
        if (!hasAccess) return res.status(403).json({ status: 'error', message: 'Unauthorized' });

        await prisma.patientcaregiverlink.update({
            where: { patient_id_caregiver_user_id: { patient_id, caregiver_user_id } },
            data: { consent_status: 'REVOKED', revoked_at: new Date() }
        });

        return res.status(200).json({ status: 'success', message: 'Caregiver access revoked.' });
    } catch(error) { next(error); }
}

exports.getMyLinkedPatients = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const links = await prisma.patientcaregiverlink.findMany({
            where: { caregiver_user_id: userId, consent_status: 'GRANTED' },
            include: { patient: true }
        });
        return res.status(200).json({ status: 'success', data: links });
    } catch (error) {
        next(error);
    }
};

exports.updateAvailability = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const { availability } = req.body; 
        const userId = req.user.userId;

        const VALID_AVAILABILITY = ['AVAILABLE', 'UNAVAILABLE', 'DO_NOT_DISTURB'];
        if (!VALID_AVAILABILITY.includes(availability)) {
            return res.status(400).json({ status: 'error', message: 'Invalid availability status.' });
        }

        const existingLink = await prisma.patientcaregiverlink.findUnique({
            where: { patient_id_caregiver_user_id: { patient_id: patient_id, caregiver_user_id: userId } }
        });

        if (!existingLink) {
            return res.status(404).json({ status: 'error', message: 'No caregiver link found for this patient.' });
        }

        const updatedLink = await prisma.patientcaregiverlink.update({
            where: { patient_id_caregiver_user_id: { patient_id: patient_id, caregiver_user_id: userId } },
            data: { availability }
        });

        return res.status(200).json({ status: 'success', data: updatedLink });
    } catch (error) {
        next(error);
    }
};