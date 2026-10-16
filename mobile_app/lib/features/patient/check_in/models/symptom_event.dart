class SymptomObservation {
  final String type; // PAIN, FATIGUE ...
  final int? severity; // 0-10
  final double? numericValue;
  final String? unit;
  final String? note;

  const SymptomObservation({
    required this.type,
    this.severity,
    this.numericValue,
    this.unit,
    this.note,
  });

  factory SymptomObservation.fromJson(Map<String, dynamic> j) => SymptomObservation(
        type: (j['observation_type'] as String?) ?? '',
        severity: (j['severity'] as num?)?.toInt(),
        numericValue: j['numeric_value'] == null
            ? null
            : double.tryParse(j['numeric_value'].toString()),
        unit: j['unit'] as String?,
        note: j['note'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'observation_type': type,
        if (severity != null) 'severity': severity,
        if (numericValue != null) 'numeric_value': numericValue,
        if (unit != null) 'unit': unit,
        if (note != null) 'note': note,
      };
}

class CheckInAnswerRecord {
  final String fieldId;
  final String fieldKey;
  final String label;
  final String fieldType; // TEXT | LONG_TEXT | NUMBER | BOOLEAN | SINGLE_CHOICE | MULTI_CHOICE | SCALE
  final String? optionLabel;
  final String? valueText;
  final double? valueNumber;
  final bool? valueBoolean;
  final List<String> valueList;

  const CheckInAnswerRecord({
    required this.fieldId,
    required this.fieldKey,
    required this.label,
    required this.fieldType,
    this.optionLabel,
    this.valueText,
    this.valueNumber,
    this.valueBoolean,
    this.valueList = const [],
  });

  factory CheckInAnswerRecord.fromJson(Map<String, dynamic> j) {
    final field =
        j['field'] is Map ? Map<String, dynamic>.from(j['field'] as Map) : const <String, dynamic>{};
    final option = j['option'] is Map
        ? Map<String, dynamic>.from(j['option'] as Map)
        : const <String, dynamic>{};
    final json = j['value_json'];
    final key = (field['field_key'] ?? '').toString();
    final label = (field['label'] as String?)?.trim();
    return CheckInAnswerRecord(
      fieldId: (j['field_id'] ?? field['id'] ?? '').toString(),
      fieldKey: key,
      label: (label == null || label.isEmpty) ? _prettify(key) : label,
      fieldType: (field['field_type'] ?? '').toString(),
      optionLabel: option['label'] as String?,
      valueText: j['value_text'] as String?,
      valueNumber:
          j['value_number'] == null ? null : double.tryParse(j['value_number'].toString()),
      valueBoolean: j['value_boolean'] as bool?,
      valueList: json is List ? json.map((e) => e.toString()).toList() : const [],
    );
  }

  Map<String, dynamic> toJson() => {
        'field_id': fieldId,
        'field': {
          'id': fieldId,
          'field_key': fieldKey,
          'label': label,
          'field_type': fieldType,
        },
        if (optionLabel != null) 'option': {'label': optionLabel},
        if (valueText != null) 'value_text': valueText,
        if (valueNumber != null) 'value_number': valueNumber,
        if (valueBoolean != null) 'value_boolean': valueBoolean,
        if (valueList.isNotEmpty) 'value_json': valueList,
      };

  static String _prettify(String slug) {
    final words = slug.split(RegExp(r'[_-]')).where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return slug;
    words[0] = words[0][0].toUpperCase() + words[0].substring(1);
    return words.join(' ');
  }

  static String _numberText(double v) =>
      v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toString();

  String displayValue({required String yes, required String no}) {
    switch (fieldType) {
      case 'BOOLEAN':
        return valueBoolean == null ? '' : (valueBoolean! ? yes : no);
      case 'NUMBER':
      case 'SCALE':
        return valueNumber == null ? '' : _numberText(valueNumber!);
      case 'SINGLE_CHOICE':
        return optionLabel ?? (valueText == null ? '' : _prettify(valueText!));
      case 'MULTI_CHOICE':
        return valueList.map(_prettify).join(', ');
      default:
        return valueText ?? '';
    }
  }

  bool get isLongText => fieldType == 'LONG_TEXT' || fieldType == 'TEXT';
}

class SymptomEvent {
  final String id;
  final String source; // ROUTINE | UPDATE
  final DateTime recordedAt;
  final List<SymptomObservation> observations;
  final List<CheckInAnswerRecord> answers;
  final String? formVersionId;

  const SymptomEvent({
    required this.id,
    required this.source,
    required this.recordedAt,
    required this.observations,
    this.answers = const [],
    this.formVersionId,
  });

  int get maxSeverity =>
      observations.fold<int>(0, (m, o) => (o.severity ?? 0) > m ? (o.severity ?? 0) : m);

  factory SymptomEvent.fromJson(Map<String, dynamic> j) => SymptomEvent(
        id: j['id'] as String,
        source: (j['source'] as String?) ?? 'ROUTINE',
        recordedAt: DateTime.parse(j['recorded_at'] as String),
        observations: ((j['symptomobservation'] as List?) ?? const [])
            .map((e) => SymptomObservation.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
        answers: ((j['checkinanswer'] as List?) ?? const [])
            .whereType<Map>()
            .map((e) => CheckInAnswerRecord.fromJson(Map<String, dynamic>.from(e)))
            .where((a) => a.label.isNotEmpty)
            .toList(),
        formVersionId: j['form_version_id'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'source': source,
        'recorded_at': recordedAt.toUtc().toIso8601String(),
        'symptomobservation': observations.map((o) => o.toJson()).toList(),
        'checkinanswer': answers.map((a) => a.toJson()).toList(),
        if (formVersionId != null) 'form_version_id': formVersionId,
      };
}