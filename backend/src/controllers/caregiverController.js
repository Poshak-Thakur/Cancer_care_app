const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { canManagePatientCaregivers } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');
const HttpError = require('../utils/httpError');

const CAREGIVER_TYPES = ['FAMILY', 'VOLUNTEER'];

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
        const { full_name, caregiver_type } = req.body;

        if (typeof full_name !== 'string' || full_name.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'full_name is required.' });
        }
        if (caregiver_type !== undefined && !CAREGIVER_TYPES.includes(caregiver_type)) {
            return res.status(400).json({ status: 'error', message: 'caregiver_type must be FAMILY or VOLUNTEER.' });
        }

        const existingProfile = await prisma.caregiverprofile.findUnique({ where: { user_id: userId } });

        // The caregiver type must be an explicit choice. It is never defaulted, so a
        // VOLUNTEER can't be silently turned into a FAMILY caregiver (or vice versa).
        if (!existingProfile && !caregiver_type) {
            return res.status(400).json({
                status: 'error',
                code: 'CAREGIVER_TYPE_REQUIRED',
                message: 'caregiver_type (FAMILY or VOLUNTEER) is required to complete caregiver onboarding.'
            });
        }

        const updatedUser = await prisma.useraccount.update({
            where: { id: userId },
            data: { full_name: full_name.trim() }
        });

        const profile = existingProfile
            ? (caregiver_type && caregiver_type !== existingProfile.caregiver_type
                ? await prisma.caregiverprofile.update({ where: { user_id: userId }, data: { caregiver_type } })
                : existingProfile)
            : await prisma.caregiverprofile.create({
                data: {
                    user_id: userId,
                    caregiver_type,
                    // Same rule as PATCH /auth/profile: families are auto-approved, volunteers are vetted.
                    volunteer_status: caregiver_type === 'VOLUNTEER' ? 'PENDING' : 'APPROVED'
                }
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
        if (!isUuid(patientId)) return res.status(400).json({ status: 'error', message: 'patient_id must be a valid UUID.' });

        // Only the patient's own account (SELF/DELEGATE) or the central NGO head/counsellor.
        // Having caregiver access to the patient is NOT enough to invite more caregivers.
        const canInvite = await canManagePatientCaregivers(userId, patientId);
        if (!canInvite) {
            return res.status(403).json({
                status: 'error',
                message: 'Only the patient (or their delegate) or the NGO counsellor can generate caregiver invites.'
            });
        }

        const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
        if (!patient) return res.status(404).json({ status: 'error', message: 'Patient not found.' });

        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        let code = null;
        for (let attempt = 0; attempt < 5 && !code; attempt++) {
            const candidate = crypto.randomBytes(4).toString('hex').toUpperCase();
            try {
                await prisma.caregiverinvite.create({
                    data: { patient_id: patientId, code: candidate, expires_at: expiresAt }
                });
                code = candidate;
            } catch (err) {
                if (err.code !== 'P2002') throw err; // only retry on a code collision
            }
        }
        if (!code) throw new HttpError(500, 'Could not generate a unique invite code. Please try again.');

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
        const tokenToVerify = (invite_code || code);
        const userId = req.user.userId;

        if (typeof tokenToVerify !== 'string' || tokenToVerify.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'Invite code is required.' });
        }
        const inviteCode = tokenToVerify.trim().toUpperCase();

        // Caregiver onboarding (type selection) must be completed first. We never
        // auto-create a FAMILY profile here, otherwise a VOLUNTEER-to-be would be
        // silently converted into a FAMILY caregiver.
        const profile = await prisma.caregiverprofile.findUnique({ where: { user_id: userId } });
        if (!profile) {
            return res.status(409).json({
                status: 'error',
                code: 'CAREGIVER_PROFILE_REQUIRED',
                message: 'Complete caregiver onboarding (choose FAMILY or VOLUNTEER via POST /api/caregivers/profile) before accepting an invite.'
            });
        }

        const label = (typeof relationship_label === 'string' && relationship_label.trim())
            ? relationship_label.trim().slice(0, 100)
            : 'Caregiver';

        // Consuming the invite and creating/updating the link succeed or fail TOGETHER.
        const link = await prisma.$transaction(async (tx) => {
            const invite = await tx.caregiverinvite.findUnique({ where: { code: inviteCode } });
            if (!invite || invite.is_used || invite.expires_at < new Date()) {
                throw new HttpError(400, 'Invalid or expired invite code.');
            }

            // Atomic claim: only one concurrent request can flip is_used false -> true.
            const claimed = await tx.caregiverinvite.updateMany({
                where: { id: invite.id, is_used: false, expires_at: { gt: new Date() } },
                data: { is_used: true }
            });
            if (claimed.count !== 1) {
                throw new HttpError(400, 'Invalid or expired invite code.');
            }

            return tx.patientcaregiverlink.upsert({
                where: {
                    patient_id_caregiver_user_id: { patient_id: invite.patient_id, caregiver_user_id: userId }
                },
                update: {
                    consent_status: 'GRANTED',
                    revoked_at: null,
                    relationship_label: label,
                    availability: 'AVAILABLE'
                },
                create: {
                    patient_id: invite.patient_id,
                    caregiver_user_id: userId,
                    relationship_label: label,
                    consent_status: 'GRANTED',
                    availability: 'AVAILABLE'
                },
                include: { patient: true }
            });
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

        if (!isUuid(patient_id) || !isUuid(caregiver_user_id)) {
            return res.status(400).json({ status: 'error', message: 'patient_id and caregiver_user_id must be valid UUIDs.' });
        }

        // The patient's account / the central NGO may revoke anyone; a caregiver may only remove themselves.
        const isSelfRemoval = caregiver_user_id === userId;
        if (!isSelfRemoval && !(await canManagePatientCaregivers(userId, patient_id))) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized' });
        }

        const link = await prisma.patientcaregiverlink.findUnique({
            where: { patient_id_caregiver_user_id: { patient_id, caregiver_user_id } }
        });
        if (!link) return res.status(404).json({ status: 'error', message: 'Caregiver link not found.' });

        await prisma.patientcaregiverlink.update({
            where: { patient_id_caregiver_user_id: { patient_id, caregiver_user_id } },
            data: { consent_status: 'REVOKED', revoked_at: new Date() }
        });

        return res.status(200).json({ status: 'success', message: 'Caregiver access revoked.' });
    } catch(error) { next(error); }
};

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
