const prisma = require('../config/db');

exports.uploadDocument = async (req, res, next) => {
    try {
        const { patient_id, document_type, title, is_private } = req.body;
        const userId = req.user.userId;

        if (!req.file) return res.status(400).json({ status: 'error', message: 'No file provided.' });

        const mockFilePath = `patients/${patient_id}/documents/${Date.now()}_${req.file.originalname}`;

        const document = await prisma.medicaldocument.create({
            data: {
                patient_id,
                document_type: document_type || 'OTHER',
                title: title || req.file.originalname,
                file_path: mockFilePath,
                mime_type: req.file.mimetype,
                file_size_bytes: req.file.size,
                verification_status: 'PENDING',
                is_private: is_private === 'false' ? false : true,
                uploaded_by: userId
            }
        });

        return res.status(201).json({ status: 'success', message: 'Document uploaded and sent for OCR processing.', data: document });
    } catch (error) { next(error); }
};

exports.getPatientDocuments = async (req, res, next) => {
    try {
        const { patient_id } = req.params;
        const documents = await prisma.medicaldocument.findMany({
            where: { patient_id },
            orderBy: { uploaded_at: 'desc' },
            select: { id: true, title: true, document_type: true, verification_status: true, is_private: true, uploaded_at: true }
        });
        return res.status(200).json({ status: 'success', data: documents });
    } catch (error) { next(error); }
};

exports.verifyDocument = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { verification_status } = req.body;
        const userId = req.user.userId;

        const isStaff = await prisma.staffassignment.findFirst({ where: { staff_user_id: userId, status: 'ACTIVE' } });
        if (!isStaff) return res.status(403).json({ status: 'error', message: 'Only authorized NGO staff can verify documents.' });

        const document = await prisma.medicaldocument.findUnique({ where: { id } });
        if (!document) return res.status(404).json({ status: 'error', message: 'Document not found' });

        const updatedDoc = await prisma.medicaldocument.update({
            where: { id },
            data: { verification_status }
        });

        return res.status(200).json({ status: 'success', data: updatedDoc });
    } catch (error) { next(error); }
};