import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/ist.dart';
import '../models/care_event.dart';

/// Backend enums (from schema.prisma):
/// type: MEDICATION_DOSE | APPOINTMENT | THERAPY_SESSION | COUNSELLOR_FOLLOWUP | HOME_VISIT | OTHER
/// completion_status: SCHEDULED | DUE | COMPLETED | MISSED | SNOOZED | CANCELLED
class CareEventService {
  final ApiClient _api = ApiClient.instance;

  /// GET /api/care-events/daily/:patientId. The server cuts the day at
  /// midnight IST and sorts by time. [day] is an IST calendar date; leave it
  /// null for today.
  Future<List<CareEvent>> daily(String patientId, {DateTime? day}) async {
    final res = await _api.get(
      ApiEndpoints.careEventsDaily(patientId),
      query: day == null ? null : {'date': Ist.dateParam(day)},
    );
    return (res['data'] as List).map((e) => CareEvent.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<CareEvent>> today(String patientId) => daily(patientId);

  /// POST /api/care-events/parse-command. Works for typed text and for text
  /// transcribed from the microphone.
  Future<ParsedCommand> parseCommand(String text) async {
    final res = await _api.post(ApiEndpoints.careEventParse, body: {'text_input': text}, timeout: const Duration(seconds: 45));
    return ParsedCommand.fromJson(Map<String, dynamic>.from(res['data'] as Map));
  }

  /// POST /api/care-events. The backend stores type, time and a free-form
  /// `reminder_rule`, so the title, place and note travel inside it.
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
    final res = await _api.post(ApiEndpoints.careEvents, body: {
      'patient_id': patientId,
      'type': type,
      'schedule_time': scheduleTime.toUtc().toIso8601String(),
      if (patientMedicationId != null) 'patient_medication_id': patientMedicationId,
      if (rule.isNotEmpty) 'reminder_rule': rule,
    });
    return CareEvent.fromJson(res['data'] as Map<String, dynamic>);
  }

  /// PATCH /api/care-events/:id/status (COMPLETED also stamps completed_at).
  Future<CareEvent> updateStatus(String eventId, String completionStatus) async {
    final res = await _api.patch(
      ApiEndpoints.careEventStatus(eventId),
      body: {'completion_status': completionStatus},
    );
    return CareEvent.fromJson(res['data'] as Map<String, dynamic>);
  }
}
