const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

exports.scanPrescription = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { patient_id } = req.body;
        const file = req.file;

        if (!file || !patient_id) {
            return res.status(400).json({ status: 'error', message: 'Prescription image and patient_id are required.' });
        }

        if (!supabase || !genAI) {
            return res.status(500).json({ status: 'error', message: 'Storage or AI service not configured.' });
        }

        // 1. Upload securely to Supabase 'prescriptions' bucket
        const fileExt = file.originalname?.split('.').pop() || 'jpg';
        const fileName = `${patient_id}/${Date.now()}_prescription.${fileExt}`;

        const { error: uploadError } = await supabase.storage
            .from('prescriptions')
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
                data: file.buffer.toString("base64"),
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

        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        const aiResponse = await model.generateContent([prompt, imagePart]);
        const responseText = aiResponse.response.text();
        
        // Clean JSON string in case of markdown formatting
        const cleanedJsonStr = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const extractedData = JSON.parse(cleanedJsonStr);

        // 3. Save raw AI payload for auditing
        await prisma.prescriptionextraction.create({
            data: {
                prescription_id: prescription.id,
                extracted_text: responseText,
                raw_payload: extractedData,
                confidence_score: 0.95 
            }
        });

        return res.status(200).json({ 
            status: 'success', 
            data: {
                prescription_id: prescription.id,
                medications: extractedData.medications
            }
        });
    } catch (error) { next(error); }
};

exports.confirmMedications = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { patient_id, prescription_id, verified_medications } = req.body;

        if (!patient_id || !verified_medications || !Array.isArray(verified_medications)) {
            return res.status(400).json({ status: 'error', message: 'Invalid payload.' });
        }

        const savedMeds = [];

        for (const med of verified_medications) {
            const newMed = await prisma.patientmedication.create({
                data: {
                    patient_id,
                    name: med.name,
                    strength: med.strength,
                    form: med.form,
                    instructions: med.instructions,
                    verification_status: 'VERIFIED',
                    source_prescription_id: prescription_id,
                    entered_by: userId,
                    verified_by: userId,
                    verified_at: new Date(),
                    kind: 'SCHEDULED'
                }
            });
            savedMeds.push(newMed);
        }

        return res.status(201).json({ status: 'success', data: savedMeds });
    } catch (error) { next(error); }
};

// ... keep your existing uploadDocument, getPatientDocuments, and verifyDocument functions here ...
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

        return res.status(201).json({ status: 'success', message: 'Document uploaded.', data: document });
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

        const VALID_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'];
        if (!VALID_STATUSES.includes(verification_status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid verification status.' });
        }

        const isStaff = await prisma.staffassignment.findFirst({ where: { staff_user_id: userId, status: 'ACTIVE' } });
        if (!isStaff) return res.status(403).json({ status: 'error', message: 'Only authorized NGO staff can verify documents.' });

        const updatedDoc = await prisma.medicaldocument.update({
            where: { id },
            data: { verification_status }
        });

        return res.status(200).json({ status: 'success', data: updatedDoc });
    } catch (error) { next(error); }
};