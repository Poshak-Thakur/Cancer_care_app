const prisma = require('../config/db');
const jwt = require('jsonwebtoken');

// Item 19: Create a Caregiver Profile
exports.createProfile = async (req, res, next) => {
    try {
        const { caregiver_type } = req.body; // 'FAMILY' or 'VOLUNTEER'
        const userId = req.user.userId;

        if (!['FAMILY', 'VOLUNTEER'].includes(caregiver_type)) {
            return res.status(400).json({ status: 'error', message: 'caregiver_type must be FAMILY or VOLUNTEER' });
        }

        const profile = await prisma.caregiverprofile.create({
            data: {
                user_id: userId,
                caregiver_type,
                // Volunteers must be approved by the NGO. Family is approved instantly.
                volunteer_status: caregiver_type === 'VOLUNTEER' ? 'PENDING' : 'APPROVED' 
            }
        });

        return res.status(201).json({ status: 'success', data: profile });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ status: 'error', message: 'Caregiver profile already exists.' });
        next(error);
    }
};

// Item 20a: Patient generates a secure invite code
exports.generateInvite = async (req, res, next) => {
    try {
        const { patient_id, scopes = ['ALL'] } = req.body;
        
        if (req.accessContext.role !== 'PATIENT') {
            return res.status(403).json({ status: 'error', message: 'Only the patient can generate caregiver invites.' });
        }

        // Package the invite payload into a 7-day token
        const inviteToken = jwt.sign(
            { patient_id, scopes, granted_by: req.user.userId, type: 'CAREGIVER_INVITE' },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        return res.status(200).json({ status: 'success', invite_token: inviteToken });
    } catch (error) {
        next(error);
    }
};

// Item 20b: Caregiver scans/submits the code to link their accounts
exports.acceptInvite = async (req, res, next) => {
    try {
        const { invite_token, relationship_label } = req.body;
        const userId = req.user.userId;

        const profile = await prisma.caregiverprofile.findUnique({ where: { user_id: userId } });
        if (!profile) {
            return res.status(403).json({ status: 'error', message: 'Please complete caregiver onboarding first.' });
        }

        const decoded = jwt.verify(invite_token, process.env.JWT_SECRET);
        if (decoded.type !== 'CAREGIVER_INVITE') {
            return res.status(400).json({ status: 'error', message: 'Invalid invite token type.' });
        }

        const result = await prisma.$transaction(async (tx) => {
            const link = await tx.patientcaregiverlink.create({
                data: {
                    patient_id: decoded.patient_id,
                    caregiver_user_id: userId,
                    relationship_label: relationship_label || 'Family',
                    access_scopes: decoded.scopes,
                    consent_status: 'GRANTED'
                }
            });

            await tx.consentrecord.create({
                data: {
                    patient_id: decoded.patient_id,
                    grantee_id: userId,
                    data_scope: decoded.scopes.join(','),
                    status: 'GRANTED',
                    granted_by: decoded.granted_by
                }
            });

            return link;
        });

        return res.status(201).json({ status: 'success', data: result });
    } catch (error) {
        if (error.code === 'P2002') return res.status(409).json({ status: 'error', message: 'You are already linked to this patient.' });
        if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
            return res.status(400).json({ status: 'error', message: 'Invalid or expired invite code.' });
        }
        next(error);
    }
};

// Item 21: Get list of patients this caregiver supports
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

// Item 21: Allow caregiver to pause alerts when unavailable
exports.updateAvailability = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const { availability } = req.body; // AVAILABLE, UNAVAILABLE, DO_NOT_DISTURB
        const userId = req.user.userId;

        const updatedLink = await prisma.patientcaregiverlink.update({
            where: { uq_patient_caregiver: { patient_id: patient_id, caregiver_user_id: userId } },
            data: { availability }
        });

        return res.status(200).json({ status: 'success', data: updatedLink });
    } catch (error) {
        next(error);
    }
};