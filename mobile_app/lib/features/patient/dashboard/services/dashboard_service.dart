import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../check_in/services/check_in_service.dart';
import '../../documents/models/medical_document.dart';
import '../../documents/services/document_service.dart';
import '../models/dashboard_overview.dart';
import 'care_event_service.dart';

class DashboardService {
  final ApiClient _api = ApiClient.instance;

  /// GET /api/dashboard/:patientId: today's care tasks, alerts, check-in state
  /// and recent documents, all cut at midnight IST by the server.
  ///
  /// If the endpoint itself fails with a server error (5xx), the same screen
  /// data is assembled from the smaller endpoints so Home still works.
  Future<DashboardOverview> overview(String patientId) async {
    try {
      final res = await _api.get(ApiEndpoints.dashboard(patientId));
      return DashboardOverview.fromJson(Map<String, dynamic>.from(res['data'] as Map));
    } on ApiException catch (e) {
      final serverError = e.statusCode != null && e.statusCode! >= 500;
      if (!serverError) rethrow;
    }

    final events = await CareEventService().today(patientId);
    bool checkIn = false;
    try {
      checkIn = await CheckInService().completedToday(patientId);
    } on ApiException {
      // leave as "not done"
    }
    List<MedicalDocument> docs = const [];
    try {
      docs = (await DocumentService().list(patientId)).take(3).toList();
    } on ApiException {
      // documents are optional on Home
    }
    return DashboardOverview(
      relationship: null,
      accessScopes: const [],
      totalToday: events.length,
      completedToday: events.where((e) => e.isCompleted).length,
      events: events,
      checkInCompleted: checkIn,
      documents: docs,
    );
  }
}
