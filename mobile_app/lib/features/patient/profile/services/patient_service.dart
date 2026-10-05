import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../models/patient.dart';
import '../models/patient_link.dart';

class PatientService {
  final ApiClient _api = ApiClient.instance;

  /// POST /api/patients — creates the patient and a SELF link for the caller.
  /// Response data is { patient, link }.
  Future<Patient> createProfile({
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
      'date_of_birth': toDateOnly(dateOfBirth),
      'preferred_language': preferredLanguage,
      if (cancerType != null) 'cancer_type': cancerType,
      if (cancerStage != null) 'cancer_stage': cancerStage,
      if (diagnosisDate != null) 'diagnosis_date': toDateOnly(diagnosisDate),
      if (carePlanSummary != null) 'care_plan_summary': carePlanSummary,
    });
    final data = res['data'] as Map<String, dynamic>;
    return Patient.fromJson(data['patient'] as Map<String, dynamic>);
  }

  /// GET /api/patients/me
  Future<List<PatientLink>> myPatients() async {
    final res = await _api.get(ApiEndpoints.myPatients);
    return (res['data'] as List).map((e) => PatientLink.fromJson(e as Map<String, dynamic>)).toList();
  }
}
