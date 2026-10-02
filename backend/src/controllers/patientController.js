const prisma = require('../config/db');

exports.createPatientProfile = async (req, res, next) => {
    try {
        const { 
            full_name, 
            date_of_birth, 
            preferred_language = 'en', 
            cancer_type, 
            cancer_stage, 
            diagnosis_date,
            care_plan_summary 
        } = req.body;
        
        const userId = req.user.userId;

        if (!full_name || !date_of_birth) {
            return res.status(400).json({
                status: 'error',
                message: 'full_name and date_of_birth are required fields.'
            });
        }

        // Atomic transaction: create patient and self-link simultaneously
        const result = await prisma.$transaction(async (tx) => {
            const newPatient = await tx.patient.create({
                data: {
                    full_name,
                    date_of_birth: new Date(date_of_birth),
                    preferred_language,
                    cancer_type: cancer_type || null,
                    cancer_stage: cancer_stage || null,
                    diagnosis_date: diagnosis_date ? new Date(diagnosis_date) : null,
                    care_plan_summary: care_plan_summary || null
                }
            });

            const link = await tx.patientaccountlink.create({
                data: {
                    user_id: userId,
                    patient_id: newPatient.id,
                    relationship_type: 'SELF',
                    relationship_label: 'Self',
                    access_scopes: ['ALL'],
                    consent_status: 'GRANTED',
                    granted_by: userId
                }
            });

            return { patient: newPatient, link };
        });

        return res.status(201).json({
            status: 'success',
            message: 'Patient profile established and linked successfully.',
            data: result
        });
    } catch (error) {
        next(error);
    }
};

exports.getMyPatients = async (req, res, next) => {
    try {
        const userId = req.user.userId;

        // Fetch all patients linked to the authenticated user account
        const links = await prisma.patientaccountlink.findMany({
            where: { 
                user_id: userId,
                consent_status: 'GRANTED'
            },
            include: {
                patient: true
            }
        });

        return res.status(200).json({
            status: 'success',
            data: links.map(link => ({
                relationship_type: link.relationship_type,
                relationship_label: link.relationship_label,
                access_scopes: link.access_scopes,
                patient: link.patient
            }))
        });
    } catch (error) {
        next(error);
    }
};