import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';

class CheckInService {
  final ApiClient _api = ApiClient.instance;

  /// Converts the check-in screen's selections (0 = best .. 3 = worst per
  /// question) into the backend's observation list (severity 1-10).
  ///
  /// ASSUMPTION: observation_type values PAIN / FATIGUE / APPETITE / MOOD must
  /// match the backend's enum — confirm against the Prisma schema.
  static List<Map<String, dynamic>> observationsFromSelections(Map<String, int?> selected) {
    const severityByLevel = [1, 4, 7, 10];
    return [
      for (final e in selected.entries)
        if (e.value != null)
          {'observation_type': e.key.toUpperCase(), 'severity': severityByLevel[e.value!]},
    ];
  }

  Future<Map<String, dynamic>> submit({
    required String patientId,
    required List<Map<String, dynamic>> observations,
  }) async {
    final res = await _api.post(ApiEndpoints.checkIn, body: {
      'patient_id': patientId,
      'observations': observations,
    });
    return Map<String, dynamic>.from(res['data'] as Map);
  }

  /// { completed: bool, details?: {...} }
  Future<Map<String, dynamic>> todayStatus(String patientId) async {
    final res = await _api.get(ApiEndpoints.todayCheckIn(patientId));
    return Map<String, dynamic>.from(res['data'] as Map);
  }
}
