const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const {
    canManagePatientCaregivers,
    ACTIVE_LINK
} = require('../services/authorizationService');
const { recordAudit, AUDIT_ACTIONS, RESOURCES, syncConsentRecords, revokeConsentRecords } = require('../services/auditService');
const { isUuid, normalizeLabel } = require('../utils/validators');
const { DEFAULT_CAREGIVER_SCOPES } = require('../constants/accessScopes');
const HttpError = require('../utils/httpError');

const CAREGIVER_TYPES = ['FAMILY', 'VOLUNTEER'];

// NGO recognition can only be changed through PATCH /api/admin/caregivers/:user_id/recognition.
// A caregiver client must never be able to send any of these.
const RECOGNITION_FIELDS = ['recognized', 'ngo_recognition_status', 'recognized_by', 'recognized_at'];

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

        const forbidden = RECOGNITION_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(req.body, f));
        if (forbidden.length > 0) {
            return res.status(403).json({
                status: 'error',
                code: 'RECOGNITION_NOT_CLIENT_SETTABLE',
                message: 'NGO recognition can only be set by the NGO.'
            });
        }

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
                    // Every new caregiver starts unrecognised, FAMILY and VOLUNTEER alike.
                    ngo_recognition_status: 'NOT_RECOGNIZED',
                    recognized_by: null,
                    recognized_at: null
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
                    data: { patient_id: patientId, code: candidate, expires_at: expiresAt, created_by: userId }
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

        const checkedLabel = normalizeLabel(relationship_label, 'Caregiver');
        if (checkedLabel.error) return res.status(400).json({ status: 'error', message: checkedLabel.error });
        const label = checkedLabel.value;

        // Caregiver onboarding (type selection) must be completed first. We never
        // auto-create a profile here, otherwise a VOLUNTEER-to-be would be silently
        // converted into a FAMILY caregiver.
        const profile = await prisma.caregiverprofile.findUnique({ where: { user_id: userId } });
        if (!profile) {
            return res.status(409).json({
                status: 'error',
                code: 'CAREGIVER_PROFILE_REQUIRED',
                message: 'Complete caregiver onboarding (choose FAMILY or VOLUNTEER via POST /api/caregivers/profile) before accepting an invite.'
            });
        }
        // Recognition gate: checked BEFORE the invite is touched, so an unrecognised caregiver
        // cannot burn a patient's invite code.
        if (profile.ngo_recognition_status !== 'RECOGNIZED') {
            return res.status(403).json({
                status: 'error',
                code: 'CAREGIVER_NOT_RECOGNIZED',
                message: 'Caregiver recognition by the NGO is required before linking to a patient.'
            });
        }

        // Consuming the invite and creating/restoring the link succeed or fail TOGETHER.
        const link = await prisma.$transaction(async (tx) => {
            // Re-check inside the transaction: recognition may have been withdrawn a moment ago.
            const freshProfile = await tx.caregiverprofile.findUnique({ where: { user_id: userId } });
            if (!freshProfile || freshProfile.ngo_recognition_status !== 'RECOGNIZED') {
                throw new HttpError(403, 'Caregiver recognition by the NGO is required before linking to a patient.', 'CAREGIVER_NOT_RECOGNIZED');
            }

            const invite = await tx.caregiverinvite.findUnique({ where: { code: inviteCode } });
            // Only CAREGIVER codes: a PATIENT_CLAIM code must never create a caregiver link.
            if (!invite || invite.invite_kind !== 'CAREGIVER' || invite.is_used || invite.expires_at < new Date()) {
                throw new HttpError(400, 'Invalid or expired invite code.');
            }

            // Atomic claim: only one concurrent request can flip is_used false -> true.
            const claimed = await tx.caregiverinvite.updateMany({
                where: { id: invite.id, invite_kind: 'CAREGIVER', is_used: false, expires_at: { gt: new Date() } },
                data: { is_used: true }
            });
            if (claimed.count !== 1) {
                throw new HttpError(400, 'Invalid or expired invite code.');
            }

            const existing = await tx.patientcaregiverlink.findUnique({
                where: { patient_id_caregiver_user_id: { patient_id: invite.patient_id, caregiver_user_id: userId } }
            });

            // Already ACTIVE caregiver: keep their current scopes (they may have been rescoped).
            // New or previously REVOKED link: start from the DEFAULT scopes. Old (possibly
            // elevated) scopes are never restored blindly. Invites carry no scope list, so the
            // newly granted scopes are the defaults.
            const isActive = !!existing && existing.consent_status === 'GRANTED' && existing.revoked_at === null;
            const newScopes = [...DEFAULT_CAREGIVER_SCOPES];

            const saved = await tx.patientcaregiverlink.upsert({
                where: {
                    patient_id_caregiver_user_id: { patient_id: invite.patient_id, caregiver_user_id: userId }
                },
                update: {
                    consent_status: 'GRANTED',
                    revoked_at: null,
                    relationship_label: label,
                    availability: 'AVAILABLE',
                    ...(isActive ? {} : { access_scopes: newScopes })
                },
                create: {
                    patient_id: invite.patient_id,
                    caregiver_user_id: userId,
                    relationship_label: label,
                    consent_status: 'GRANTED',
                    availability: 'AVAILABLE',
                    access_scopes: newScopes
                },
                include: { patient: true }
            });

            // Consent history, attributed to whoever generated the invite (the actual grantor) -
            // NOT to the caregiver who accepts it. Legacy invites without a creator fall back to
            // the patient's own account holder. An already-active link keeps its existing history.
            let consent = { granted: [], revoked: [], recorded: false };
            if (!isActive) {
                let grantorId = invite.created_by || null;
                if (!grantorId) {
                    const selfLink = await tx.patientaccountlink.findFirst({
                        where: { patient_id: invite.patient_id, relationship_type: 'SELF', consent_status: 'GRANTED', revoked_at: null }
                    });
                    grantorId = selfLink ? selfLink.user_id : null;
                }
                if (grantorId) {
                    const synced = await syncConsentRecords(tx, {
                        patientId: invite.patient_id, granteeId: userId, grantedBy: grantorId, scopes: newScopes
                    });
                    consent = { ...synced, recorded: true, granted_by: grantorId };
                }
            }

            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.CAREGIVER_LINK_CREATED,
                targetResource: RESOURCES.CAREGIVER_LINK,
                targetId: saved.id,
                targetUserId: userId,
                patientId: invite.patient_id,
                scopesBefore: existing ? (Array.isArray(existing.access_scopes) ? existing.access_scopes : []) : [],
                scopesAfter: isActive ? existing.access_scopes : newScopes,
                extra: { invite_id: invite.id, invited_by: invite.created_by || null, relinked: !!existing && !isActive, already_active: isActive, consent_recorded: consent.recorded },
                req
            });

            return saved;
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

        // Only THIS patient's link changes. The CaregiverProfile (and its NGO recognition) and
        // the caregiver's links to other patients are untouched.
        await prisma.$transaction(async (tx) => {
            const link = await tx.patientcaregiverlink.findFirst({
                where: { patient_id, caregiver_user_id, ...ACTIVE_LINK }
            });
            if (!link) throw new HttpError(404, 'Active caregiver link not found.');

            await tx.patientcaregiverlink.update({
                where: { patient_id_caregiver_user_id: { patient_id, caregiver_user_id } },
                data: { consent_status: 'REVOKED', revoked_at: new Date() }
            });

            // History is preserved: the active consent rows are marked REVOKED, not deleted.
            // (Removing NGO recognition does NOT do this - only revoking the link does.)
            await revokeConsentRecords(tx, { patientId: patient_id, granteeId: caregiver_user_id });

            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.CAREGIVER_LINK_REVOKED,
                targetResource: RESOURCES.CAREGIVER_LINK,
                targetId: link.id,
                targetUserId: caregiver_user_id,
                patientId: patient_id,
                scopesBefore: Array.isArray(link.access_scopes) ? link.access_scopes : [],
                scopesAfter: [],
                extra: { self_removal: isSelfRemoval },
                req
            });
        });

        return res.status(200).json({ status: 'success', message: 'Caregiver access revoked.' });
    } catch (error) { next(error); }
};

exports.getMyLinkedPatients = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        // Active links of a RECOGNIZED caregiver only. An unrecognised caregiver sees no patients.
        const profile = await prisma.caregiverprofile.findUnique({ where: { user_id: userId } });
        if (!profile || profile.ngo_recognition_status !== 'RECOGNIZED') {
            return res.status(200).json({ status: 'success', data: [] });
        }
        const links = await prisma.patientcaregiverlink.findMany({
            where: { caregiver_user_id: userId, ...ACTIVE_LINK },
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

        const existingLink = await prisma.patientcaregiverlink.findFirst({
            where: { patient_id, caregiver_user_id: userId, ...ACTIVE_LINK }
        });

        if (!existingLink) {
            return res.status(404).json({ status: 'error', message: 'No active caregiver link found for this patient.' });
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
