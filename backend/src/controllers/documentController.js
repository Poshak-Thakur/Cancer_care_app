const prisma = require('../config/db');

// Helper for RBAC
const verifyAccess = async (userId, patientId) => {
    return await prisma.patientaccountlink.findFirst({
        where: { user_id: userId, patient_id: patientId, consent_status: 'GRANTED' }
    });
};

exports.uploadDocument = async (req, res, next) => {
    try {
        const { patient_id, document_type, title, is_private } = req.body;
        const userId = req.user.userId;

        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No file provided.' });
        }

        if (!await verifyAccess(userId, patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access to this patient.' });
        }

        // 1. In a real app, upload req.file.buffer to Supabase Storage here.
        // For now, we simulate the storage path.
        const mockFilePath = `patients/${patient_id}/documents/${Date.now()}_${req.file.originalname}`;

        // 2. Create the document record defaulting to PENDING verification
        const document = await prisma.medicaldocument.create({
            data: {
                patient_id,
                document_type: document_type || 'OTHER',
                title: title || req.file.originalname,
                file_path: mockFilePath,
                mime_type: req.file.mimetype,
                file_size_bytes: req.file.size,
                verification_status: 'PENDING',
                is_private: is_private === 'false' ? false : true, // Default to strict privacy
                uploaded_by: userId
            }
        });

        // 3. Trigger OCR Service here (e.g., via message queue)

        return res.status(201).json({
            status: 'success',
            message: 'Document uploaded and sent for OCR processing.',
            data: document
        });
    } catch (error) {
        next(error);
    }
};

exports.getPatientDocuments = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const userId = req.user.userId;

        if (!await verifyAccess(userId, patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });
        }

        const documents = await prisma.medicaldocument.findMany({
            where: { patient_id },
            orderBy: { uploaded_at: 'desc' },
            select: {
                id: true,
                title: true,
                document_type: true,
                verification_status: true,
                is_private: true,
                uploaded_at: true,
                // We exclude the raw OCR payload to keep the list lightweight
            }
        });

        return res.status(200).json({ status: 'success', data: documents });
    } catch (error) {
        next(error);
    }
};

exports.verifyDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { verification_status } = req.body; // VERIFIED or REJECTED
        const userId = req.user.userId;

        const document = await prisma.medicaldocument.findUnique({ where: { id } });
        if (!document) return res.status(404).json({ status: 'error', message: 'Document not found' });

        if (!await verifyAccess(userId, document.patient_id)) {
            return res.status(403).json({ status: 'error', message: 'Unauthorized access.' });
        }

        const updatedDoc = await prisma.medicaldocument.update({
            where: { id },
            data: { verification_status }
        });

        return res.status(200).json({ status: 'success', data: updatedDoc });
    } catch (error) {
        next(error);
    }
};