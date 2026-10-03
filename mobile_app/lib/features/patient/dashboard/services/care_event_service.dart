import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';

/// Backend enums — type: MEDICATION_DOSE | APPOINTMENT | THERAPY_SESSION | OTHER;
/// completion_status: COMPLETED | MISSED | SNOOZED | CANCELLED.
class CareEventService {
  final ApiClient _api = ApiClient.instance;

  Future<List<Map<String, dynamic>>> daily(String patientId, {DateTime? date}) async {
    final res = await _api.get(
      ApiEndpoints.careEventsDaily(patientId),
      query: date == null ? null : {'date': date.toIso8601String().substring(0, 10)},
    );
    return (res['data'] as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<Map<String, dynamic>> create({
    required String patientId,
    required String type,
    required DateTime scheduleTime,
    String? patientMedicationId,
    Map<String, dynamic>? reminderRule,
  }) async {
    final res = await _api.post(ApiEndpoints.careEvents, body: {
      'patient_id': patientId,
      'type': type,
      'schedule_time': scheduleTime.toIso8601String(),
      if (patientMedicationId != null) 'patient_medication_id': patientMedicationId,
      if (reminderRule != null) 'reminder_rule': reminderRule,
    });
    return Map<String, dynamic>.from(res['data'] as Map);
  }

  Future<Map<String, dynamic>> updateStatus(String eventId, String completionStatus) async {
    final res = await _api.patch(
      ApiEndpoints.careEventStatus(eventId),
      body: {'completion_status': completionStatus},
    );
    return Map<String, dynamic>.from(res['data'] as Map);
  }
}
