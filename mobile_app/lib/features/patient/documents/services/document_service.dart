import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/media.dart';
import '../models/medical_document.dart';

/// Backend limit: 10 MB per file.
class DocumentService {
  final ApiClient _api = ApiClient.instance;

  /// GET /api/documents/patient/:patientId (newest first, with the
  /// verification status the NGO team has set).
  Future<List<MedicalDocument>> list(String patientId) async {
    final res = await _api.get(ApiEndpoints.patientDocuments(patientId));
    return (res['data'] as List).map((e) => MedicalDocument.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// POST /api/documents (multipart field 'file').
  Future<MedicalDocument> upload({
    required String patientId,
    required List<int> bytes,
    required String filename,
    String documentType = 'OTHER',
    String? title,
    bool isPrivate = true,
  }) async {
    final res = await _api.postMultipart(
      ApiEndpoints.documents,
      fields: {
        'patient_id': patientId,
        'document_type': documentType,
        if (title != null && title.isNotEmpty) 'title': title,
        'is_private': isPrivate.toString(),
      },
      fileBytes: bytes,
      filename: filename,
      fileField: 'file',
      contentType: mediaTypeFor(filename),
    );
    return MedicalDocument.fromJson(res['data'] as Map<String, dynamic>);
  }

  /// POST /api/documents/prescriptions/scan (multipart field 'prescription').
  /// The server stores the photo, reads it with Gemini Vision and returns the
  /// medications it found. Nothing is saved as a medication until [confirm].
  Future<PrescriptionScan> scanPrescription({
    required String patientId,
    required List<int> bytes,
    required String filename,
  }) async {
    final res = await _api.postMultipart(
      ApiEndpoints.prescriptionScan,
      fields: {'patient_id': patientId},
      fileBytes: bytes,
      filename: filename,
      fileField: 'prescription',
      contentType: mediaTypeFor(filename),
      timeout: const Duration(seconds: 120),
    );
    return PrescriptionScan.fromJson(Map<String, dynamic>.from(res['data'] as Map));
  }

  /// POST /api/documents/medications/confirm: saves the reviewed list as
  /// VERIFIED medications. Returns how many were saved.
  Future<int> confirmMedications({
    required String patientId,
    required String prescriptionId,
    required List<ScannedMedication> medications,
  }) async {
    final res = await _api.post(ApiEndpoints.medicationsConfirm, body: {
      'patient_id': patientId,
      'prescription_id': prescriptionId,
      'verified_medications': medications.map((m) => m.toJson()).toList(),
    });
    return (res['data'] as List?)?.length ?? medications.length;
  }
}
