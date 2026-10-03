import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';

/// Backend limit: 10 MB per file, multipart field name 'file'.
class DocumentService {
  final ApiClient _api = ApiClient.instance;

  Future<List<Map<String, dynamic>>> list(String patientId) async {
    final res = await _api.get(ApiEndpoints.patientDocuments(patientId));
    return (res['data'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<Map<String, dynamic>> upload({
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
        if (title != null) 'title': title,
        'is_private': isPrivate.toString(),
      },
      fileBytes: bytes,
      filename: filename,
    );
    return Map<String, dynamic>.from(res['data'] as Map);
  }

  /// [status]: VERIFIED | REJECTED
  Future<Map<String, dynamic>> verify(String documentId, String status) async {
    final res = await _api.patch(
      ApiEndpoints.verifyDocument(documentId),
      body: {'verification_status': status},
    );
    return Map<String, dynamic>.from(res['data'] as Map);
  }
}
