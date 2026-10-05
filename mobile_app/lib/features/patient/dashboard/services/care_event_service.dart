import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../models/care_event.dart';

/// Backend enums (from schema.prisma):
/// type: MEDICATION_DOSE | APPOINTMENT | THERAPY_SESSION | COUNSELLOR_FOLLOWUP | HOME_VISIT | OTHER
/// completion_status: SCHEDULED | DUE | COMPLETED | MISSED | SNOOZED | CANCELLED
class CareEventService {
  final ApiClient _api = ApiClient.instance;

  Future<List<CareEvent>> daily(String patientId, {DateTime? date}) async {
    final res = await _api.get(
      ApiEndpoints.careEventsDaily(patientId),
      query: date == null ? null : {'date': date.toUtc().toIso8601String()},
    );
    return (res['data'] as List).map((e) => CareEvent.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Events for the user's *local* day. The backend slices days by UTC, which
  /// in India (UTC+5:30) would cut a local day in two, so this asks for the
  /// UTC day(s) that overlap the local day, merges them and keeps only what
  /// falls inside the local day.
  Future<List<CareEvent>> today(String patientId) async {
    final now = DateTime.now();
    final startLocal = DateTime(now.year, now.month, now.day);
    final endLocal = startLocal.add(const Duration(days: 1));

    String utcDay(DateTime t) => t.toUtc().toIso8601String().substring(0, 10);
    final days = <String>{
      utcDay(startLocal),
      utcDay(endLocal.subtract(const Duration(milliseconds: 1))),
    };

    final byId = <String, CareEvent>{};
    for (final day in days) {
      for (final e in await daily(patientId, date: DateTime.parse('${day}T12:00:00Z'))) {
        byId[e.id] = e;
      }
    }
    final inDay = byId.values
        .where((e) => !e.scheduleTime.isBefore(startLocal) && e.scheduleTime.isBefore(endLocal))
        .toList()
      ..sort((a, b) => a.scheduleTime.compareTo(b.scheduleTime));
    return inDay;
  }

  Future<CareEvent> create({
    required String patientId,
    required String type,
    required DateTime scheduleTime,
    String? patientMedicationId,
    Map<String, dynamic>? reminderRule,
  }) async {
    final res = await _api.post(ApiEndpoints.careEvents, body: {
      'patient_id': patientId,
      'type': type,
      'schedule_time': scheduleTime.toUtc().toIso8601String(),
      if (patientMedicationId != null) 'patient_medication_id': patientMedicationId,
      if (reminderRule != null) 'reminder_rule': reminderRule,
    });
    return CareEvent.fromJson(res['data'] as Map<String, dynamic>);
  }

  Future<CareEvent> updateStatus(String eventId, String completionStatus) async {
    final res = await _api.patch(
      ApiEndpoints.careEventStatus(eventId),
      body: {'completion_status': completionStatus},
    );
    return CareEvent.fromJson(res['data'] as Map<String, dynamic>);
  }
}
