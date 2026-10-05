import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../check_in/services/check_in_service.dart';
import '../../documents/models/medical_document.dart';
import '../../documents/services/document_service.dart';
import '../models/care_event.dart';
import '../models/dashboard_overview.dart';
import 'care_event_service.dart';

class DashboardService {
  final ApiClient _api = ApiClient.instance;

  /// GET /api/dashboard/:patientId, with two adjustments:
  ///
  /// 1. Care tasks are replaced by the local-day list from the care-events API
  ///    (the dashboard cuts "today" by server time, not the user's time zone).
  /// 2. If the dashboard endpoint itself fails with a server error (5xx), the
  ///    same screen data is assembled from the smaller endpoints, so Home
  ///    still works.
  Future<DashboardOverview> overview(String patientId) async {
    DashboardOverview? dash;
    try {
      final res = await _api.get(ApiEndpoints.dashboard(patientId));
      dash = DashboardOverview.fromJson(res['data'] as Map<String, dynamic>);
    } on ApiException catch (e) {
      final serverError = e.statusCode != null && e.statusCode! >= 500;
      if (!serverError) rethrow;
    }

    final events = await _localDayEvents(patientId, fallback: dash?.events);
    if (dash != null) return dash.withEvents(events);

    // Fallback path: build the overview from separate calls.
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

  Future<List<CareEvent>> _localDayEvents(String patientId, {List<CareEvent>? fallback}) async {
    try {
      return await CareEventService().today(patientId);
    } on ApiException {
      if (fallback != null) return fallback;
      rethrow;
    }
  }
}
