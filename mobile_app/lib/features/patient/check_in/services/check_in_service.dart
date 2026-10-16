import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/sync/sync_engine.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/utils/uuid.dart';
import '../models/check_in_form.dart';
import '../models/symptom_event.dart';

/// How a question is answered.
enum CheckInKind {
  levels,
  number,
}

class CheckInQuestion {
  final String key;
  final String code;
  final IconCodes icon;
  final CheckInKind kind;
  final List<String> levelKeys;
  final String? unit;
  final String? unitLabelKey;
  final bool extra;

  const CheckInQuestion.levels(
    this.key,
    this.code,
    this.icon,
    this.levelKeys, {
    this.extra = false,
  })  : kind = CheckInKind.levels,
        unit = null,
        unitLabelKey = null;

  const CheckInQuestion.number(
    this.key,
    this.code,
    this.icon, {
    required String this.unit,
    required String this.unitLabelKey,
    this.extra = true,
  })  : kind = CheckInKind.number,
        levelKeys = const [];
}

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
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static const severityByLevel = [1, 4, 7, 10];
  static const alertThreshold = 8;

  static const _publishedFormCacheKey = 'published_checkin_form';
  static String _todayCacheKey(String patientId) =>
      'today_checkin_${patientId}_${Ist.dateParam(DateTime.now())}';
  static String _historyCacheKey(String patientId) => 'symptom_history_$patientId';

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

  static String newClientEventId() => Uuid.v4();

  /// POST /api/symptoms/check-in.
  /// Offline-first: if offline, records the check-in locally, marks today's
  /// check-in as completed, and enqueues the payload with `client_event_id`
  /// so SyncEngine submits it idempotently when connectivity returns.
  Future<void> submit({
    required String patientId,
    required List<Map<String, dynamic>> observations,
    String source = 'ROUTINE',
    String? clientEventId,
  }) async {
    final eventId = clientEventId ?? newClientEventId();
    final payload = <String, dynamic>{
      'patient_id': patientId,
      'observations': observations,
      'source': source,
      'client_event_id': eventId,
    };

    try {
      await _api.post(ApiEndpoints.checkIn, body: payload);
      await _recordLocalCheckIn(
        patientId: patientId,
        eventId: eventId,
        source: source,
        observations: observations,
      );
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;

      await _recordLocalCheckIn(
        patientId: patientId,
        eventId: eventId,
        source: source,
        observations: observations,
      );
      await _cache.enqueueOperation(
        operationId: eventId,
        patientId: patientId,
        operationType: 'SYMPTOM_CHECKIN',
        endpoint: ApiEndpoints.checkIn,
        httpMethod: 'POST',
        payload: payload,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);
    }
  }

  /// GET /api/symptoms/check-in/form.
  /// Offline-first: caches the published NGO form. If offline, returns the
  /// cached published form (or null so the screen uses built-in questions).
  Future<CheckInForm?> fetchPublishedForm() async {
    try {
      final res = await _api.get(ApiEndpoints.checkInForm);
      final data = Map<String, dynamic>.from(res['data'] as Map);
      await _cache.putCache(cacheKey: _publishedFormCacheKey, data: data);
      return CheckInForm.fromJson(data);
    } on ApiException catch (e) {
      if (e.statusCode == 404 && e.code == 'NO_PUBLISHED_FORM') {
        await _cache.putCache(
          cacheKey: _publishedFormCacheKey,
          data: {'no_published_form': true},
        );
        return null;
      }
      if (e.statusCode != null) rethrow;

      final cached = await _cache.getCache(_publishedFormCacheKey);
      if (cached != null && cached.data is Map) {
        final map = Map<String, dynamic>.from(cached.data as Map);
        if (map['no_published_form'] == true) return null;
        return CheckInForm.fromJson(map);
      }
      // No cached NGO form yet while offline -> fall back to built-in check-in questions
      return null;
    }
  }

  /// POST /api/symptoms/check-in with the versioned, form-based payload.
  /// Offline-first: saves locally and queues for idempotent sync when offline.
  Future<void> submitForm({
    required String patientId,
    required String formVersionId,
    required List<CheckInAnswerInput> answers,
    required List<Map<String, dynamic>> observations,
    required String clientEventId,
    String source = 'ROUTINE',
  }) async {
    final payload = <String, dynamic>{
      'patient_id': patientId,
      'client_event_id': clientEventId,
      'form_version_id': formVersionId,
      'answers': answers.map((a) => a.toJson()).toList(),
      'observations': observations,
      'source': source,
    };

    try {
      await _api.post(ApiEndpoints.checkIn, body: payload);
      await _recordLocalCheckIn(
        patientId: patientId,
        eventId: clientEventId,
        source: source,
        observations: observations,
        formVersionId: formVersionId,
      );
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;

      await _recordLocalCheckIn(
        patientId: patientId,
        eventId: clientEventId,
        source: source,
        observations: observations,
        formVersionId: formVersionId,
      );
      await _cache.enqueueOperation(
        operationId: clientEventId,
        patientId: patientId,
        operationType: 'SYMPTOM_CHECKIN_FORM',
        endpoint: ApiEndpoints.checkIn,
        httpMethod: 'POST',
        payload: payload,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);
    }
  }

  /// GET /api/symptoms/today/:patientId (resets at 00:00 IST).
  Future<bool> completedToday(String patientId) async {
    final key = _todayCacheKey(patientId);
    try {
      final res = await _api.get(ApiEndpoints.todayCheckIn(patientId));
      final data = res['data'] as Map<String, dynamic>;
      final completed = data['completed'] as bool;
      await _cache.putCache(
        cacheKey: key,
        patientId: patientId,
        data: {'completed': completed},
      );
      return completed;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is Map) {
        return (cached.data as Map)['completed'] == true;
      }
      return false;
    }
  }

  /// GET /api/symptoms/history/:patientId: the last 30 check-ins, newest first.
  Future<List<SymptomEvent>> history(String patientId) async {
    final key = _historyCacheKey(patientId);
    try {
      final res = await _api.get(ApiEndpoints.symptomHistory(patientId));
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: key, patientId: patientId, data: rawList);
      return rawList.map(SymptomEvent.fromJson).toList();
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((e) => SymptomEvent.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return const <SymptomEvent>[];
    }
  }

  Future<void> _recordLocalCheckIn({
    required String patientId,
    required String eventId,
    required String source,
    required List<Map<String, dynamic>> observations,
    String? formVersionId,
  }) async {
    await _cache.putCache(
      cacheKey: _todayCacheKey(patientId),
      patientId: patientId,
      data: {'completed': true},
    );

    final historyKey = _historyCacheKey(patientId);
    final cached = await _cache.getCache(historyKey);
    final list = <Map<String, dynamic>>[];
    if (cached != null && cached.data is List) {
      for (final item in cached.data as List) {
        if (item is Map) list.add(Map<String, dynamic>.from(item));
      }
    }

    final localEvent = SymptomEvent(
      id: eventId,
      source: source,
      recordedAt: DateTime.now(),
      observations: observations.map(SymptomObservation.fromJson).toList(),
      formVersionId: formVersionId,
    );

    list.removeWhere((item) => item['id'] == eventId);
    list.insert(0, localEvent.toJson());
    await _cache.putCache(cacheKey: historyKey, patientId: patientId, data: list);
  }
}