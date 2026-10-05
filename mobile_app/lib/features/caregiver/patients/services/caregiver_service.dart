import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../models/linked_patient.dart';

class CaregiverService {
  final ApiClient _api = ApiClient.instance;

  /// POST /api/caregivers/profile. [type]: FAMILY | VOLUNTEER (volunteers are
  /// PENDING until the NGO approves them). A 409 means the profile already
  /// exists, which is fine here.
  Future<void> createProfile(String type) async {
    try {
      await _api.post(ApiEndpoints.caregiverProfile, body: {'caregiver_type': type});
    } on ApiException catch (e) {
      if (e.statusCode == 409) return;
      rethrow;
    }
  }

  /// Patient side: POST /api/caregivers/invite. Returns the signed invite
  /// code (valid for 7 days). The backend answers
  /// { status, data: { invite_code, code, expires_at, patient_id } }.
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
      'invite_code': inviteToken, // backend reads invite_code (or code)
      if (relationshipLabel != null && relationshipLabel.isNotEmpty) 'relationship_label': relationshipLabel,
    });
  }

  Future<List<LinkedPatient>> myPatients() async {
    final res = await _api.get(ApiEndpoints.caregiverPatients);
    return (res['data'] as List).map((e) => LinkedPatient.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// [availability]: AVAILABLE | UNAVAILABLE | DO_NOT_DISTURB
  Future<void> updateAvailability(String patientId, String availability) async {
    await _api.patch(ApiEndpoints.caregiverAvailability(patientId), body: {'availability': availability});
  }
}
