import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/sync/sync_engine.dart';
import '../../../../core/utils/uuid.dart';
import '../../../auth/services/auth_state.dart';
import '../models/patient.dart';
import '../models/patient_link.dart';

class PatientService {
  final ApiClient _api = ApiClient.instance;
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static const _myPatientsCacheKey = 'my_patient_links';
  static String _patientCacheKey(String id) => 'patient_profile_$id';

  /// POST /api/patients — creates the patient and a SELF link for the caller.
  /// Requires connectivity on initial account setup.
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
    final patient = Patient.fromJson(data['patient'] as Map<String, dynamic>);
    await _cache.putCache(
      cacheKey: _patientCacheKey(patient.id),
      patientId: patient.id,
      data: patient.toJson(),
    );
    return patient;
  }

  /// POST /api/patients/claim: links the signed-in account to the patient
  /// record the NGO created, using the one-time code from Dost.
  Future<Patient> claimPatient(String code) async {
    final res = await _api.post(ApiEndpoints.patientClaim, body: {'code': code});
    final data = res['data'] as Map<String, dynamic>;
    final patient = Patient.fromJson(Map<String, dynamic>.from(data['patient'] as Map));
    await _cache.putCache(
      cacheKey: _patientCacheKey(patient.id),
      patientId: patient.id,
      data: patient.toJson(),
    );
    return patient;
  }

  /// PATCH /api/patients/:id: edits the patient record.
  /// Offline-first: if offline, updates the local cached patient record and
  /// enqueues the PATCH for synchronization when internet returns.
  Future<Patient> updatePatient(
    String patientId, {
    String? fullName,
    DateTime? dateOfBirth,
    String? preferredLanguage,
    String? cancerType,
    String? cancerStage,
    DateTime? diagnosisDate,
  }) async {
    final body = <String, dynamic>{
      if (fullName != null) 'full_name': fullName,
      if (dateOfBirth != null) 'date_of_birth': toDateOnly(dateOfBirth),
      if (preferredLanguage != null) 'preferred_language': preferredLanguage,
      if (cancerType != null) 'cancer_type': cancerType,
      if (cancerStage != null) 'cancer_stage': cancerStage,
      if (diagnosisDate != null) 'diagnosis_date': toDateOnly(diagnosisDate),
    };

    try {
      final res = await _api.patch(ApiEndpoints.patient(patientId), body: body);
      final data = res['data'];
      final map = data is Map && data['patient'] is Map ? data['patient'] : data;
      final updated = Patient.fromJson(Map<String, dynamic>.from(map as Map));
      await _cache.putCache(
        cacheKey: _patientCacheKey(patientId),
        patientId: patientId,
        data: updated.toJson(),
      );
      return updated;
    } on ApiException catch (e) {
      // Only queue offline when there is no HTTP status code (network/timeout failure)
      if (e.statusCode != null) rethrow;

      final current = AuthState.patient;
      if (current == null || current.id != patientId) rethrow;

      final optimistic = Patient(
        id: current.id,
        fullName: fullName ?? current.fullName,
        dateOfBirth: dateOfBirth ?? current.dateOfBirth,
        preferredLanguage: preferredLanguage ?? current.preferredLanguage,
        cancerType: cancerType ?? current.cancerType,
        cancerStage: cancerStage ?? current.cancerStage,
        diagnosisDate: diagnosisDate ?? current.diagnosisDate,
        carePlanSummary: current.carePlanSummary,
      );

      await _cache.putCache(
        cacheKey: _patientCacheKey(patientId),
        patientId: patientId,
        data: optimistic.toJson(),
      );
      await _cache.enqueueOperation(
        operationId: Uuid.v4(),
        patientId: patientId,
        operationType: 'PATIENT_UPDATE',
        endpoint: ApiEndpoints.patient(patientId),
        httpMethod: 'PATCH',
        payload: body,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);
      return optimistic;
    }
  }

  /// GET /api/patients/me (with offline cache fallback).
  Future<List<PatientLink>> myPatients() async {
    try {
      final res = await _api.get(ApiEndpoints.myPatients);
      final links = (res['data'] as List)
          .map((e) => PatientLink.fromJson(e as Map<String, dynamic>))
          .toList();
      await _cache.putCache(
        cacheKey: _myPatientsCacheKey,
        data: links.map((l) => l.toJson()).toList(),
      );
      for (final l in links) {
        await _cache.putCache(
          cacheKey: _patientCacheKey(l.patient.id),
          patientId: l.patient.id,
          data: l.patient.toJson(),
        );
      }
      return links;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(_myPatientsCacheKey);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((item) => PatientLink.fromJson(Map<String, dynamic>.from(item as Map)))
            .toList();
      }
      if (AuthState.patient != null) {
        return [
          PatientLink(
            relationshipType: AuthState.relationshipType,
            relationshipLabel: '',
            accessScopes: AuthState.scopes,
            patient: AuthState.patient!,
          ),
        ];
      }
      rethrow;
    }
  }
}