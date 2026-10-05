import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';

class CheckInService {
  final ApiClient _api = ApiClient.instance;

  /// Converts the check-in screen's selections (0 = best .. 3 = worst per
  /// question) into the backend's observation list (severity 1-10).
  /// Unanswered questions are skipped.
  ///
  /// observation_type is a free VarChar(50) in the schema, but
  /// symptomobservation has a DB check constraint — confirm PAIN / FATIGUE /
  /// APPETITE / MOOD and the severity range are allowed by it.
  static List<Map<String, dynamic>> observationsFromSelections(Map<String, int?> selected) {
    const severityByLevel = [1, 4, 7, 10];
    return [
      for (final e in selected.entries)
        if (e.value != null)
          {'observation_type': e.key.toUpperCase(), 'severity': severityByLevel[e.value!.clamp(0, severityByLevel.length - 1)].clamp(0, 10)},
    ];
  }

  Future<void> submit({
    required String patientId,
    required List<Map<String, dynamic>> observations,
  }) async {
    await _api.post(ApiEndpoints.checkIn, body: {
      'patient_id': patientId,
      'observations': observations,
    });
  }

  Future<bool> completedToday(String patientId) async {
    final res = await _api.get(ApiEndpoints.todayCheckIn(patientId));
    final data = res['data'] as Map<String, dynamic>;
    return data['completed'] as bool;
  }
}
