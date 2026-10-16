import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/sync/sync_engine.dart';
import '../../../../core/utils/uuid.dart';
import '../../../auth/services/auth_state.dart';
import '../models/linked_patient.dart';

class CaregiverService {
  final ApiClient _api = ApiClient.instance;
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static String _cacheKey() => 'caregiver_linked_patients_${AuthState.userId}';

  /// Patient side: POST /api/caregivers/invite.
  Future<String> generateInvite(String patientId) async {
    final res = await _api.post(ApiEndpoints.caregiverInvite, body: {'patient_id': patientId});
    final data = res['data'] as Map<String, dynamic>?;
    final code = (data?['invite_code'] ?? data?['code']) as String?;
    if (code == null || code.isEmpty) {
      throw const ApiException('The server did not return an invite code.');
    }
    return code;
  }

  /// Caregiver side: POST /api/caregivers/accept-invite.
  Future<void> acceptInvite({required String inviteToken, String? relationshipLabel}) async {
    await _api.post(ApiEndpoints.caregiverAcceptInvite, body: {
      'invite_code': inviteToken,
      if (relationshipLabel != null && relationshipLabel.isNotEmpty)
        'relationship_label': relationshipLabel,
    });
  }

  /// POST /api/caregivers/revoke: the patient withdraws a caregiver's access.
  Future<void> revoke({required String patientId, required String caregiverUserId}) async {
    await _api.post(
      ApiEndpoints.caregiverRevoke,
      body: {'patient_id': patientId, 'caregiver_user_id': caregiverUserId},
    );
  }

  /// GET /api/caregivers/patients (cached locally so caregivers can view their
  /// linked patients offline).
  Future<List<LinkedPatient>> myPatients() async {
    final key = _cacheKey();
    try {
      final res = await _api.get(ApiEndpoints.caregiverPatients);
      final list = (res['data'] as List)
          .map((e) => LinkedPatient.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
      await _cache.putCache(
        cacheKey: key,
        data: list.map((l) => l.toJson()).toList(),
      );
      return list;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((e) => LinkedPatient.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return const <LinkedPatient>[];
    }
  }

  /// [availability]: AVAILABLE | UNAVAILABLE | DO_NOT_DISTURB
  Future<void> updateAvailability(String patientId, String availability) async {
    final payload = {'availability': availability};
    try {
      await _api.patch(ApiEndpoints.caregiverAvailability(patientId), body: payload);
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      await _cache.enqueueOperation(
        operationId: Uuid.v4(),
        patientId: patientId,
        operationType: 'CAREGIVER_AVAILABILITY',
        endpoint: ApiEndpoints.caregiverAvailability(patientId),
        httpMethod: 'PATCH',
        payload: payload,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);
    }
  }
}