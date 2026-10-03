import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';

class PatientService {
  final ApiClient _api = ApiClient.instance;

  /// YYYY-MM-DD, so the server stores the exact calendar date picked.
  static String _dateOnly(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

  /// POST /api/patients — creates the patient and a SELF link for the caller.
  /// Only [fullName] and [dateOfBirth] are required by the backend.
  Future<Map<String, dynamic>> createProfile({
    required String fullName,
    required DateTime dateOfBirth,
    String preferredLanguage = 'en',
    String? cancerType,
    String? cancerStage,
    DateTime? diagnosisDate,
    String? carePlanSummary,
  }) async {
    final res = await _api.post(ApiEndpoints.patients, body: {
      'full_name': fullName,
      'date_of_birth': _dateOnly(dateOfBirth),
      'preferred_language': preferredLanguage,
      if (cancerType != null) 'cancer_type': cancerType,
      if (cancerStage != null) 'cancer_stage': cancerStage,
      if (diagnosisDate != null) 'diagnosis_date': _dateOnly(diagnosisDate),
      if (carePlanSummary != null) 'care_plan_summary': carePlanSummary,
    });
    return Map<String, dynamic>.from(res['data'] as Map);
  }

  /// GET /api/patients/me — each item: relationship_type, relationship_label,
  /// access_scopes, patient.
  Future<List<Map<String, dynamic>>> myPatients() async {
    final res = await _api.get(ApiEndpoints.myPatients);
    return (res['data'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }
}
