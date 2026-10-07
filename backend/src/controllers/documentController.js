const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { isCentralCounsellor } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');
const HttpError = require('../utils/httpError');

const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

// Private Supabase Storage buckets. Must exist in the Supabase project.
const PRESCRIPTION_BUCKET = 'prescriptions';
const DOCUMENT_BUCKET = process.env.SUPABASE_DOCUMENTS_BUCKET || 'medical_documents';

const VALID_DOCUMENT_TYPES = ['PRESCRIPTION', 'LAB_REPORT', 'SCAN', 'DISCHARGE_SUMMARY', 'OTHER'];
const VALID_VERIFICATION_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'];

const isAllowedMedicalFile = (mimetype) =>
    typeof mimetype === 'string' && (mimetype.startsWith('image/') || mimetype === 'application/pdf');

const safeFileName = (name) =>
    String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);

const cleanText = (value, max) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text === '' ? null : text.slice(0, max);
};

// file_size_bytes is a BigInt column and res.json() cannot serialise BigInt.
const serializeDocument = (doc) => ({ ...doc, file_size_bytes: Number(doc.file_size_bytes) });

// Normalises one medication coming from the AI or from the client. Returns null if unusable.
const normalizeMedication = (med) => {
    if (!med || typeof med !== 'object') return null;
    const name = cleanText(med.name, 255);
    if (!name) return null;
    return {
        name,
        strength: cleanText(med.strength, 100),
        form: cleanText(med.form, 100),
        instructions: cleanText(med.instructions, 5000)
    };
};

// Extracts a JSON object from model output even if it was wrapped in markdown/prose.
const parseModelJson = (text) => {
    const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first === -1 || last <= first) throw new Error('No JSON object in model response');
    return JSON.parse(cleaned.slice(first, last + 1));
};

exports.scanPrescription = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { patient_id } = req.body;
        const file = req.file;

        if (!file || !patient_id) {
            return res.status(400).json({ status: 'error', message: 'Prescription image and patient_id are required.' });
        }
        if (!isAllowedMedicalFile(file.mimetype)) {
            return res.status(400).json({ status: 'error', message: 'Only image or PDF prescriptions are supported.' });
        }
        if (!supabase || !genAI) {
            return res.status(500).json({ status: 'error', message: 'Storage or AI service not configured.' });
        }

        // 1. Upload securely to Supabase 'prescriptions' bucket
        const fileName = `${patient_id}/${Date.now()}_prescription_${safeFileName(file.originalname || 'scan.jpg')}`;

        const { error: uploadError } = await supabase.storage
            .from(PRESCRIPTION_BUCKET)
            .upload(fileName, file.buffer, { contentType: file.mimetype });

        if (uploadError) throw uploadError;

        // Save base file record
        const prescription = await prisma.prescription.create({
            data: {
                patient_id,
                file_path: fileName,
                mime_type: file.mimetype,
                file_size_bytes: file.size,
                uploaded_by: userId
            }
        });

        // 2. Prepare image for Gemini Vision AI
        const imagePart = {
            inlineData: {
                data: file.buffer.toString('base64'),
                mimeType: file.mimetype
            }
        };

        const prompt = `
            You are a meticulous medical AI assistant. Analyze this prescription image.
            Extract all medications and return ONLY a valid JSON object. Do not include markdown, backticks, or conversational text.
            The JSON format MUST be exactly:
            {
              "medications": [
                {
                  "name": "Medication Name",
                  "strength": "e.g., 500mg (or null if not found)",
                  "form": "e.g., Tablet, Syrup, Injection",
                  "instructions": "e.g., 1 tablet twice daily after meals"
                }
              ]
            }
        `;

        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        const aiResponse = await model.generateContent([prompt, imagePart]);
        const responseText = aiResponse.response.text();

        let extractedData;
        try {
            extractedData = parseModelJson(responseText);
        } catch (parseError) {
            return res.status(422).json({
                status: 'error',
                message: 'Could not read medications from this image. Please retake the photo and try again.',
                data: { prescription_id: prescription.id }
            });
        }

        const medications = (Array.isArray(extractedData.medications) ? extractedData.medications : [])
            .map(normalizeMedication)
            .filter(Boolean);

        // 3. Save raw AI payload for auditing.
        // confidence_score stays NULL: the model does not return a real confidence value,
        // and a made-up number would be misleading.
        await prisma.prescriptionextraction.create({
            data: {
                prescription_id: prescription.id,
                extracted_text: responseText,
                raw_payload: extractedData,
                confidence_score: null
            }
        });

        return res.status(200).json({
            status: 'success',
            data: {
                prescription_id: prescription.id,
                medications
            }
        });
    } catch (error) { next(error); }
};

exports.confirmMedications = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { patient_id, prescription_id, verified_medications } = req.body;

        if (!patient_id || !Array.isArray(verified_medications) || verified_medications.length === 0) {
            return res.status(400).json({ status: 'error', message: 'Invalid payload.' });
        }
        if (prescription_id !== undefined && prescription_id !== null && !isUuid(prescription_id)) {
            return res.status(400).json({ status: 'error', message: 'prescription_id must be a valid UUID.' });
        }

        const medications = verified_medications.map(normalizeMedication);
        if (medications.some(m => m === null)) {
            return res.status(400).json({ status: 'error', message: 'Every medication needs a name.' });
        }

        const { saved, createdCount } = await prisma.$transaction(async (tx) => {
            if (prescription_id) {
                // Row lock: two simultaneous confirmations of the same prescription are serialised,
                // so the duplicate check below is race-free.
                const rows = await tx.$queryRaw`SELECT id, patient_id FROM prescription WHERE id = ${prescription_id}::uuid FOR UPDATE`;
                if (!rows || rows.length === 0) {
                    throw new HttpError(404, 'Prescription not found.');
                }
                if (String(rows[0].patient_id) !== String(patient_id)) {
                    throw new HttpError(400, 'This prescription does not belong to the given patient.');
                }
            }

            const saved = [];
            let createdCount = 0;

            for (const med of medications) {
                let record = null;

                if (prescription_id) {
                    // Idempotent: confirming the same prescription again returns the existing record.
                    record = await tx.patientmedication.findFirst({
                        where: {
                            patient_id,
                            source_prescription_id: prescription_id,
                            name: { equals: med.name, mode: 'insensitive' },
                            strength: med.strength
                        }
                    });
                }

                if (!record) {
                    record = await tx.patientmedication.create({
                        data: {
                            patient_id,
                            name: med.name,
                            strength: med.strength,
                            form: med.form,
                            instructions: med.instructions,
                            verification_status: 'VERIFIED',
                            source_prescription_id: prescription_id || null,
                            entered_by: userId,
                            verified_by: userId,
                            verified_at: new Date(),
                            kind: 'SCHEDULED'
                        }
                    });
                    createdCount++;
                }
                saved.push(record);
            }

            return { saved, createdCount };
        });

        return res.status(createdCount > 0 ? 201 : 200).json({ status: 'success', data: saved });
    } catch (error) { next(error); }
};

exports.uploadDocument = async (req, res, next) => {
    let uploadedPath = null;
    try {
        const { patient_id, document_type, title, is_private } = req.body;
        const userId = req.user.userId;
        const file = req.file;

        if (!file) return res.status(400).json({ status: 'error', message: 'No file provided.' });
        if (!isAllowedMedicalFile(file.mimetype)) {
            return res.status(400).json({ status: 'error', message: 'Only image or PDF documents are supported.' });
        }

        const type = document_type || 'OTHER';
        if (!VALID_DOCUMENT_TYPES.includes(type)) {
            return res.status(400).json({ status: 'error', message: `Invalid document_type. Use one of: ${VALID_DOCUMENT_TYPES.join(', ')}.` });
        }
        if (!supabase) {
            return res.status(500).json({ status: 'error', message: 'Supabase storage is not configured on server.' });
        }

        // multipart -> Supabase Storage -> real path -> DB record
        const filePath = `${patient_id}/documents/${Date.now()}_${safeFileName(file.originalname)}`;

        const { error: uploadError } = await supabase.storage
            .from(DOCUMENT_BUCKET)
            .upload(filePath, file.buffer, { contentType: file.mimetype, upsert: false });

        if (uploadError) {
            return res.status(500).json({ status: 'error', message: `Storage upload failed: ${uploadError.message}` });
        }
        uploadedPath = filePath;

        const document = await prisma.medicaldocument.create({
            data: {
                patient_id,
                document_type: type,
                title: cleanText(title, 255) || cleanText(file.originalname, 255) || 'Document',
                file_path: filePath,
                mime_type: file.mimetype,
                file_size_bytes: file.size,
                verification_status: 'PENDING',
                is_private: is_private === 'false' || is_private === false ? false : true,
                uploaded_by: userId
            }
        });

        return res.status(201).json({ status: 'success', message: 'Document uploaded.', data: serializeDocument(document) });
    } catch (error) {
        // Don't leave an orphaned file in storage if the DB write failed.
        if (uploadedPath && supabase) {
            await supabase.storage.from(DOCUMENT_BUCKET).remove([uploadedPath]).catch(() => {});
        }
        next(error);
    }
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

        if (!isUuid(id)) {
            return res.status(400).json({ status: 'error', message: 'Invalid document id.' });
        }
        if (!VALID_VERIFICATION_STATUSES.includes(verification_status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid verification status.' });
        }

        // The central NGO head/counsellor verifies documents globally - no staffassignment row needed.
        if (!(await isCentralCounsellor(userId))) {
            return res.status(403).json({ status: 'error', message: 'Only the NGO counsellor can verify documents.' });
        }

        const existing = await prisma.medicaldocument.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return res.status(404).json({ status: 'error', message: 'Document not found.' });

        const updatedDoc = await prisma.medicaldocument.update({
            where: { id },
            data: { verification_status }
        });

        return res.status(200).json({ status: 'success', data: serializeDocument(updatedDoc) });
    } catch (error) { next(error); }
};
