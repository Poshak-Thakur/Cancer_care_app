import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';

class DashboardService {
  final ApiClient _api = ApiClient.instance;

  /// GET /api/dashboard/:patientId — keys: relationship, access_scopes,
  /// profile, care_tasks{total_today, completed_today, events},
  /// wellbeing{check_in_completed, last_record}, documents.
  Future<Map<String, dynamic>> overview(String patientId) async {
    final res = await _api.get(ApiEndpoints.dashboard(patientId));
    return Map<String, dynamic>.from(res['data'] as Map);
  }
}
