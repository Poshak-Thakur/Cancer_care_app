import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/utils/uuid.dart';
import '../models/check_in_form.dart';
import '../models/symptom_event.dart';

/// How a question is answered.
enum CheckInKind {
  /// Four ordered answers (best to worst) sent as `severity`.
  levels,

  /// A typed number sent as `numeric_value` + `unit` (e.g. 2.5 litres).
  number,
}

/// One question on the check-in screen. The list below drives the whole
/// screen, so adding a symptom is a one-line change here (plus its labels in
/// strings.dart).
class CheckInQuestion {
  final String key; // S.t key of the label
  final String code; // observation_type sent to the backend
  final IconCodes icon;
  final CheckInKind kind;
  final List<String> levelKeys; // levels: four answers, best (0) to worst (3)
  final String? unit; // number: unit sent with the value
  final String? unitLabelKey; // number: S.t key shown next to the field
  final bool extra; // shown under "More symptoms"

  const CheckInQuestion.levels(this.key, this.code, this.icon, this.levelKeys, {this.extra = false})
      : kind = CheckInKind.levels,
        unit = null,
        unitLabelKey = null;

  const CheckInQuestion.number(this.key, this.code, this.icon, {required String this.unit, required String this.unitLabelKey, this.extra = true})
      : kind = CheckInKind.number,
        levelKeys = const [];
}

/// Icon names kept as plain data so this file stays free of Flutter imports.
enum IconCodes { pain, fatigue, appetite, mood, nausea, breathing, dizzy, water, sleep }

const checkInQuestions = [
  CheckInQuestion.levels('pain', 'PAIN_LEVEL', IconCodes.pain, ['none', 'mild', 'moderate', 'severe']),
  CheckInQuestion.levels('fatigue', 'FATIGUE', IconCodes.fatigue, ['none', 'aLittle', 'aLot', 'exhausted']),
  CheckInQuestion.levels('appetite', 'APPETITE', IconCodes.appetite, ['good', 'okay', 'low', 'none']),
  CheckInQuestion.levels('mood', 'MOOD', IconCodes.mood, ['good', 'okay', 'low', 'veryLow']),
  CheckInQuestion.levels('nausea', 'NAUSEA', IconCodes.nausea, ['none', 'mild', 'moderate', 'severe'], extra: true),
  CheckInQuestion.levels('breathlessness', 'BREATHLESSNESS', IconCodes.breathing, ['none', 'mild', 'moderate', 'severe'], extra: true),
  CheckInQuestion.levels('dizziness', 'DIZZINESS', IconCodes.dizzy, ['none', 'mild', 'moderate', 'severe'], extra: true),
  CheckInQuestion.number('waterIntake', 'WATER_INTAKE', IconCodes.water, unit: 'Liters', unitLabelKey: 'unitLitres'),
  CheckInQuestion.number('sleepHours', 'SLEEP_HOURS', IconCodes.sleep, unit: 'Hours', unitLabelKey: 'unitHours'),
];

class CheckInService {
  final ApiClient _api = ApiClient.instance;

  /// Severity sent for each of the four answers (best to worst). The backend
  /// raises a DETERIORATION alert for anything >= 8, which only the worst
  /// answer reaches.
  static const severityByLevel = [1, 4, 7, 10];
  static const alertThreshold = 8;

  /// Builds the backend's observation list from the screen's answers.
///   [levels]  question key -> 0 (best) .. 3 (worst)
///   [numbers] question key -> typed number
/// Unanswered questions are skipped. Each observation can carry
/// observation_type, severity, numeric_value, unit and note.
  static List<Map<String, dynamic>> buildObservations({
    required Map<String, int?> levels,
    Map<String, double?> numbers = const {},
    String? note,
  }) {
    final obs = <Map<String, dynamic>>[];
    for (final q in checkInQuestions) {
      if (q.kind == CheckInKind.levels) {
        final v = levels[q.key];
        if (v == null) continue;
        obs.add({
          'observation_type': q.code,
          'severity': severityByLevel[v.clamp(0, severityByLevel.length - 1)],
        });
      } else {
        final n = numbers[q.key];
        if (n == null) continue;
        obs.add({'observation_type': q.code, 'numeric_value': n, 'unit': q.unit});
      }
    }
    final text = note?.trim() ?? '';
    if (text.isNotEmpty && obs.isNotEmpty) obs.first['note'] = text;
    return obs;
  }

  static bool hasSevere(List<Map<String, dynamic>> observations) =>
      observations.any((o) => o['severity'] is int && (o['severity'] as int) >= alertThreshold);

  /// Random UUID v4, sent as `client_event_id` so a retried request cannot
  /// record the same check-in twice. Keep the same id when retrying the same submission.
  static String newClientEventId() => Uuid.v4();

  /// POST /api/symptoms/check-in. [source]: ROUTINE (the day's first check-in)
  /// or UPDATE (an extra one later in the day).
  Future<void> submit({
    required String patientId,
    required List<Map<String, dynamic>> observations,
    String source = 'ROUTINE',
    String? clientEventId,
  }) async {
    await _api.post(ApiEndpoints.checkIn, body: {
      'patient_id': patientId,
      'observations': observations,
      'source': source,
      'client_event_id': clientEventId ?? newClientEventId(),
    });
  }

  /// GET /api/symptoms/check-in/form: the form the NGO has PUBLISHED.
  /// Returns null only for 404 `NO_PUBLISHED_FORM` (the caller then falls back
  /// to the built-in questions). Every other failure is rethrown so the screen
  /// can show an error with a retry instead of silently using outdated data.
  Future<CheckInForm?> fetchPublishedForm() async {
    try {
      final res = await _api.get(ApiEndpoints.checkInForm);
      return CheckInForm.fromJson(Map<String, dynamic>.from(res['data'] as Map));
    } on ApiException catch (e) {
      if (e.statusCode == 404 && e.code == 'NO_PUBLISHED_FORM') return null;
      rethrow;
    }
  }

  /// POST /api/symptoms/check-in with the versioned, form-based payload.
  /// [observations] holds only the mapped established clinical fields (see
  /// ClinicalObservationMapper); they alone feed the deterioration rule.
  Future<void> submitForm({
    required String patientId,
    required String formVersionId,
    required List<CheckInAnswerInput> answers,
    required List<Map<String, dynamic>> observations,
    required String clientEventId,
    String source = 'ROUTINE',
  }) async {
    await _api.post(ApiEndpoints.checkIn, body: {
      'patient_id': patientId,
      'client_event_id': clientEventId,
      'form_version_id': formVersionId,
      'answers': answers.map((a) => a.toJson()).toList(),
      'observations': observations,
      'source': source,
    });
  }

  /// GET /api/symptoms/today/:patientId (resets at 00:00 IST).
  Future<bool> completedToday(String patientId) async {
    final res = await _api.get(ApiEndpoints.todayCheckIn(patientId));
    final data = res['data'] as Map<String, dynamic>;
    return data['completed'] as bool;
  }

  /// GET /api/symptoms/history/:patientId: the last 30 check-ins, newest first.
  Future<List<SymptomEvent>> history(String patientId) async {
    final res = await _api.get(ApiEndpoints.symptomHistory(patientId));
    return (res['data'] as List).map((e) => SymptomEvent.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  }
}
