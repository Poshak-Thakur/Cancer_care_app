const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { verifyPatientDataEventAccess } = require('../services/authorizationService');

// Initialize Supabase for avatar uploads
const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

// ==========================================
// PROFILE MANAGEMENT
// ==========================================

exports.upsertProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { full_name, caregiver_type = 'FAMILY' } = req.body;

        if (!full_name) {
            return res.status(400).json({ status: 'error', message: 'full_name is required.' });
        }

        const updatedUser = await prisma.useraccount.update({
            where: { id: userId },
            data: { full_name }
        });

        const profile = await prisma.caregiverprofile.upsert({
            where: { user_id: userId },
            update: { caregiver_type },
            create: { user_id: userId, caregiver_type }
        });

        return res.status(200).json({ status: 'success', message: 'Profile saved.', data: { user: updatedUser, profile } });
    } catch (error) { next(error); }
};

exports.getProfile = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const user = await prisma.useraccount.findUnique({
            where: { id: userId },
            include: { caregiverprofile: true }
        });
        return res.status(200).json({ status: 'success', data: user });
    } catch (error) { next(error); }
};

exports.uploadAvatar = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const file = req.file;

        if (!file) return res.status(400).json({ status: 'error', message: 'Avatar image is required.' });
        if (!supabase) return res.status(500).json({ status: 'error', message: 'Storage not configured.' });

        // Reuse the public community_media bucket for fast avatar rendering without signed URL overhead
        const fileExt = file.originalname?.split('.').pop() || 'jpg';
        const fileName = `avatars/${userId}_${Date.now()}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('community_media')
            .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: true });

        if (uploadError) throw uploadError;

        const { data } = supabase.storage.from('community_media').getPublicUrl(fileName);

        const updatedUser = await prisma.useraccount.update({
            where: { id: userId },
            data: { avatar_url: data.publicUrl }
        });

        return res.status(200).json({ status: 'success', data: { avatar_url: updatedUser.avatar_url } });
    } catch (error) { next(error); }
};

// ==========================================
// PATIENT LINKING & MANAGEMENT
// ==========================================

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