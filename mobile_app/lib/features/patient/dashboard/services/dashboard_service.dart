import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/utils/ist.dart';
import '../../../auth/services/auth_state.dart';
import '../../check_in/services/check_in_service.dart';
import '../../documents/models/medical_document.dart';
import '../../documents/services/document_service.dart';
import '../models/care_event.dart';
import '../models/dashboard_overview.dart';
import 'care_event_service.dart';

class DashboardService {
  final ApiClient _api = ApiClient.instance;
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static String _cacheKey(String patientId) => 'dashboard_overview_$patientId';

  /// GET /api/dashboard/:patientId: today's care tasks, alerts, check-in state
  /// and recent documents, all cut at midnight IST by the server.
  ///
  /// Offline-first behavior:
  /// - When online, caches the full dashboard payload AND seeds today's care
  ///   events and check-in status caches.
  /// - When offline (or on 5xx server errors), assembles the overview from
  ///   local SQLite cache so the Home tab opens immediately without errors and
  ///   reflects any offline check-ins or task completions done on the phone.
  Future<DashboardOverview> overview(String patientId) async {
    try {
      final res = await _api.get(ApiEndpoints.dashboard(patientId));
      final rawData = Map<String, dynamic>.from(res['data'] as Map);
      final parsed = DashboardOverview.fromJson(rawData);

      await _cache.putCache(
        cacheKey: _cacheKey(patientId),
        patientId: patientId,
        data: rawData,
      );

      // Also keep today's care events and check-in flag in sync for offline screens
      final todayKey = 'care_events_daily_${patientId}_${Ist.dateParam(DateTime.now())}';
      await _cache.putCache(
        cacheKey: todayKey,
        patientId: patientId,
        data: parsed.events.map((e) => e.toJson()).toList(),
      );
      final checkInKey = 'today_checkin_${patientId}_${Ist.dateParam(DateTime.now())}';
      await _cache.putCache(
        cacheKey: checkInKey,
        patientId: patientId,
        data: {'completed': parsed.checkInCompleted},
      );

      return parsed;
    } on ApiException catch (e) {
      // 4xx (such as 403 revoked access) must be surfaced to AccessGuard
      final isClientRefusal = e.statusCode != null && e.statusCode! >= 400 && e.statusCode! < 500;
      if (isClientRefusal) rethrow;
    }

    // Offline or 5xx fallback: combine cached dashboard with latest local events & check-in
    final cachedOverviewRecord = await _cache.getCache(_cacheKey(patientId));
    DashboardOverview? baseOverview;
    if (cachedOverviewRecord != null && cachedOverviewRecord.data is Map) {
      try {
        baseOverview = DashboardOverview.fromJson(
          Map<String, dynamic>.from(cachedOverviewRecord.data as Map),
        );
      } catch (_) {}
    }

    List<CareEvent> events = baseOverview?.events ?? const [];
    try {
      events = await CareEventService().today(patientId);
    } catch (_) {}

    bool checkIn = baseOverview?.checkInCompleted ?? false;
    try {
      checkIn = await CheckInService().completedToday(patientId);
    } catch (_) {}

    List<MedicalDocument> docs = baseOverview?.documents ?? const [];
    if (docs.isEmpty) {
      try {
        docs = (await DocumentService().list(patientId)).take(3).toList();
      } catch (_) {}
    }

    return DashboardOverview(
      relationship: baseOverview?.relationship ?? AuthState.relationshipType,
      accessScopes: baseOverview != null && baseOverview.accessScopes.isNotEmpty
          ? baseOverview.accessScopes
          : AuthState.scopes,
      totalToday: events.length,
      completedToday: events.where((e) => e.isCompleted).length,
      events: events,
      checkInCompleted: checkIn,
      documents: docs,
      alerts: baseOverview?.alerts ?? const [],
    );
  }
}