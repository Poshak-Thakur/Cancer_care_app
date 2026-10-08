import 'dart:math';
import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
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
  /// record the same check-in twice.
  static String newClientEventId() {
    final r = Random.secure();
    final b = List<int>.generate(16, (_) => r.nextInt(256));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
    return '${h(0)}${h(1)}${h(2)}${h(3)}-${h(4)}${h(5)}-${h(6)}${h(7)}-${h(8)}${h(9)}-${h(10)}${h(11)}${h(12)}${h(13)}${h(14)}${h(15)}';
  }

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
