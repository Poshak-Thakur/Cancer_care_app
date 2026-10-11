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

  /// POST /api/patients/claim: links the signed-in account to the patient
  /// record the NGO created, using the one-time code from Saathi. Response
  /// data is { patient, link } like [createProfile]. Errors: 400 invalid or
  /// expired code, 409 record or account already set up, 429 too many attempts.
  Future<Patient> claimPatient(String code) async {
    final res = await _api.post(ApiEndpoints.patientClaim, body: {'code': code});
    final data = res['data'] as Map<String, dynamic>;
    return Patient.fromJson(Map<String, dynamic>.from(data['patient'] as Map));
  }

  /// PATCH /api/patients/:id: edits the patient record (name, date of birth,
  /// language, cancer type and stage, diagnosis date). Only the fields given
  /// are sent. The care plan is never editable from the app.
  Future<Patient> updatePatient(
    String patientId, {
    String? fullName,
    DateTime? dateOfBirth,
    String? preferredLanguage,
    String? cancerType,
    String? cancerStage,
    DateTime? diagnosisDate,
  }) async {
    final res = await _api.patch(ApiEndpoints.patient(patientId), body: {
      if (fullName != null) 'full_name': fullName,
      if (dateOfBirth != null) 'date_of_birth': toDateOnly(dateOfBirth),
      if (preferredLanguage != null) 'preferred_language': preferredLanguage,
      if (cancerType != null) 'cancer_type': cancerType,
      if (cancerStage != null) 'cancer_stage': cancerStage,
      if (diagnosisDate != null) 'diagnosis_date': toDateOnly(diagnosisDate),
    });
    final data = res['data'];
    final map = data is Map && data['patient'] is Map ? data['patient'] : data;
    return Patient.fromJson(Map<String, dynamic>.from(map as Map));
  }

  /// GET /api/patients/me
  Future<List<PatientLink>> myPatients() async {
    final res = await _api.get(ApiEndpoints.myPatients);
    return (res['data'] as List).map((e) => PatientLink.fromJson(e as Map<String, dynamic>)).toList();
  }
}
