import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/sync/sync_engine.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/utils/uuid.dart';
import '../../../auth/services/auth_state.dart';
import '../models/care_event.dart';

/// Backend enums (from schema.prisma):
/// type: MEDICATION_DOSE | APPOINTMENT | THERAPY_SESSION | COUNSELLOR_FOLLOWUP | HOME_VISIT | OTHER
/// completion_status: SCHEDULED | DUE | COMPLETED | MISSED | SNOOZED | CANCELLED
class CareEventService {
  final ApiClient _api = ApiClient.instance;
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static String _dayCacheKey(String patientId, DateTime? day) =>
      'care_events_daily_${patientId}_${Ist.dateParam(day ?? DateTime.now())}';

  /// GET /api/care-events/daily/:patientId.
  /// Offline-first: caches each day's schedule and returns the cached schedule
  /// when offline.
  Future<List<CareEvent>> daily(String patientId, {DateTime? day}) async {
    final key = _dayCacheKey(patientId, day);
    try {
      final res = await _api.get(
        ApiEndpoints.careEventsDaily(patientId),
        query: day == null ? null : {'date': Ist.dateParam(day)},
      );
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: key, patientId: patientId, data: rawList);
      return rawList.map(CareEvent.fromJson).toList();
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((e) => CareEvent.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return const <CareEvent>[];
    }
  }

  Future<List<CareEvent>> today(String patientId) => daily(patientId);

  /// POST /api/care-events/parse-command (AI parsing requires connectivity).
  Future<ParsedCommand> parseCommand(String text) async {
    final res = await _api.post(
      ApiEndpoints.careEventParse,
      body: {'text_input': text},
      timeout: const Duration(seconds: 45),
    );
    return ParsedCommand.fromJson(Map<String, dynamic>.from(res['data'] as Map));
  }

  /// POST /api/care-events.
  /// Offline-first: if offline, saves the care event locally and queues it for
  /// synchronization when internet returns.
  Future<CareEvent> create({
    required String patientId,
    required String type,
    required DateTime scheduleTime,
    String? title,
    String? location,
    String? note,
    String? patientMedicationId,
    Map<String, dynamic>? reminderRule,
  }) async {
    final rule = <String, dynamic>{
      ...?reminderRule,
      if (title != null && title.trim().isNotEmpty) 'title': title.trim(),
      if (location != null && location.trim().isNotEmpty) 'location': location.trim(),
      if (note != null && note.trim().isNotEmpty) 'note': note.trim(),
    };
    final payload = <String, dynamic>{
      'patient_id': patientId,
      'type': type,
      'schedule_time': scheduleTime.toUtc().toIso8601String(),
      if (patientMedicationId != null) 'patient_medication_id': patientMedicationId,
      if (rule.isNotEmpty) 'reminder_rule': rule,
    };

    try {
      final res = await _api.post(ApiEndpoints.careEvents, body: payload);
      final created = CareEvent.fromJson(Map<String, dynamic>.from(res['data'] as Map));
      await _appendEventToDayCache(patientId, scheduleTime, created);
      return created;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;

      final localEvent = CareEvent(
        id: Uuid.v4(),
        patientId: patientId,
        type: type,
        completionStatus: 'SCHEDULED',
        scheduleTime: scheduleTime,
        title: title?.trim().isEmpty == true ? null : title?.trim(),
        location: location?.trim().isEmpty == true ? null : location?.trim(),
        note: note?.trim().isEmpty == true ? null : note?.trim(),
      );

      await _appendEventToDayCache(patientId, scheduleTime, localEvent);
      await _cache.enqueueOperation(
        operationId: localEvent.id,
        patientId: patientId,
        operationType: 'CARE_EVENT_CREATE',
        endpoint: ApiEndpoints.careEvents,
        httpMethod: 'POST',
        payload: payload,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);
      return localEvent;
    }
  }

  /// PATCH /api/care-events/:id/status.
  /// Offline-first: updates the local cached schedule immediately and queues
  /// the status update if the phone is offline.
  Future<CareEvent> updateStatus(String eventId, String completionStatus) async {
    final payload = {'completion_status': completionStatus};
    try {
      final res = await _api.patch(
        ApiEndpoints.careEventStatus(eventId),
        body: payload,
      );
      final updated = CareEvent.fromJson(Map<String, dynamic>.from(res['data'] as Map));
      await _updateEventInTodayCache(updated.patientId, eventId, completionStatus);
      return updated;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;

      final pid = AuthState.patientId ?? '';
      final updatedLocal = await _updateEventInTodayCache(pid, eventId, completionStatus);

      await _cache.enqueueOperation(
        operationId: Uuid.v4(),
        patientId: pid,
        operationType: 'CARE_EVENT_STATUS',
        endpoint: ApiEndpoints.careEventStatus(eventId),
        httpMethod: 'PATCH',
        payload: payload,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);

      return updatedLocal ??
          CareEvent(
            id: eventId,
            patientId: pid,
            type: 'OTHER',
            completionStatus: completionStatus,
            scheduleTime: DateTime.now(),
          );
    }
  }

  Future<void> _appendEventToDayCache(
    String patientId,
    DateTime scheduleTime,
    CareEvent event,
  ) async {
    final key = _dayCacheKey(patientId, scheduleTime);
    final cached = await _cache.getCache(key);
    final list = <Map<String, dynamic>>[];
    if (cached != null && cached.data is List) {
      for (final item in cached.data as List) {
        if (item is Map) list.add(Map<String, dynamic>.from(item));
      }
    }
    list.add(event.toJson());
    list.sort((a, b) =>
        (a['schedule_time'] as String? ?? '').compareTo(b['schedule_time'] as String? ?? ''));
    await _cache.putCache(cacheKey: key, patientId: patientId, data: list);
  }

  Future<CareEvent?> _updateEventInTodayCache(
    String patientId,
    String eventId,
    String status,
  ) async {
    if (patientId.isEmpty) return null;
    final key = _dayCacheKey(patientId, DateTime.now());
    final cached = await _cache.getCache(key);
    if (cached == null || cached.data is! List) return null;

    CareEvent? found;
    final updatedList = <Map<String, dynamic>>[];
    for (final raw in cached.data as List) {
      if (raw is! Map) continue;
      final map = Map<String, dynamic>.from(raw);
      if (map['id'] == eventId) {
        map['completion_status'] = status;
        found = CareEvent.fromJson(map);
      }
      updatedList.add(map);
    }
    await _cache.putCache(cacheKey: key, patientId: patientId, data: updatedList);
    return found;
  }
}