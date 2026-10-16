/// Models for the NGO-controlled "Today's Check-in" form
/// (GET /api/symptoms/check-in/form). Parsing is defensive: optional fields and
/// validation settings may be missing, and numbers can arrive as strings.

num? _num(dynamic v) {
  if (v == null) return null;
  if (v is num) return v;
  return num.tryParse(v.toString());
}

int? _int(dynamic v) => _num(v)?.toInt();

enum CheckInFieldType { text, longText, number, boolean, singleChoice, multiChoice, scale, unknown }

CheckInFieldType parseFieldType(String? code) {
  switch (code) {
    case 'TEXT':
      return CheckInFieldType.text;
    case 'LONG_TEXT':
      return CheckInFieldType.longText;
    case 'NUMBER':
      return CheckInFieldType.number;
    case 'BOOLEAN':
      return CheckInFieldType.boolean;
    case 'SINGLE_CHOICE':
      return CheckInFieldType.singleChoice;
    case 'MULTI_CHOICE':
      return CheckInFieldType.multiChoice;
    case 'SCALE':
      return CheckInFieldType.scale;
    default:
      return CheckInFieldType.unknown;
  }
}

class CheckInFieldOption {
  final String id;
  final String optionValue; // stable value, sent as the answer
  final String label;
  final int displayOrder;

  const CheckInFieldOption({required this.id, required this.optionValue, required this.label, required this.displayOrder});

  factory CheckInFieldOption.fromJson(Map<String, dynamic> j) => CheckInFieldOption(
        id: (j['id'] ?? '').toString(),
        optionValue: (j['option_value'] ?? '').toString(),
        label: (j['label'] ?? j['option_value'] ?? '').toString(),
        displayOrder: _int(j['display_order']) ?? 0,
      );
}

class CheckInField {
  final String id;
  final String fieldKey;
  final String label;
  final String? helpText;
  final CheckInFieldType type;
  final String typeCode;
  final bool isRequired;
  final int displayOrder;
  final Map<String, dynamic> validation; // validation_config
  final List<CheckInFieldOption> options;

  const CheckInField({
    required this.id,
    required this.fieldKey,
    required this.label,
    required this.helpText,
    required this.type,
    required this.typeCode,
    required this.isRequired,
    required this.displayOrder,
    required this.validation,
    required this.options,
  });

  bool get isSupported => type != CheckInFieldType.unknown;

  // TEXT / LONG_TEXT
  int? get maxLength => _int(validation['max_length']);

  // NUMBER
  num? get minNumber => _num(validation['min']);
  num? get maxNumber => _num(validation['max']);
  bool get integerOnly => validation['integer'] == true;
  String? get unit {
    final u = validation['unit'];
    return u is String && u.trim().isNotEmpty ? u.trim() : null;
  }

  // SCALE (backend defaults: 0..10)
  int get scaleMin => _int(validation['min']) ?? 0;
  int get scaleMax => _int(validation['max']) ?? 10;

  // MULTI_CHOICE
  int? get minSelections => _int(validation['min_selections']);
  int? get maxSelections => _int(validation['max_selections']);

  factory CheckInField.fromJson(Map<String, dynamic> j) {
    final cfg = j['validation_config'];
    final opts = ((j['options'] as List?) ?? const [])
        .whereType<Map>()
        .map((e) => CheckInFieldOption.fromJson(Map<String, dynamic>.from(e)))
        .toList()
      ..sort((a, b) => a.displayOrder.compareTo(b.displayOrder));
    final code = (j['field_type'] ?? '').toString();
    return CheckInField(
      id: (j['id'] ?? '').toString(),
      fieldKey: (j['field_key'] ?? '').toString(),
      label: (j['label'] ?? '').toString(),
      helpText: (j['help_text'] as String?)?.trim().isEmpty == true ? null : j['help_text'] as String?,
      type: parseFieldType(code),
      typeCode: code,
      isRequired: j['is_required'] == true,
      displayOrder: _int(j['display_order']) ?? 0,
      validation: cfg is Map ? Map<String, dynamic>.from(cfg) : const {},
      options: opts,
    );
  }
}

class CheckInFormVersion {
  final String id;
  final int versionNumber;
  final DateTime? publishedAt;

  const CheckInFormVersion({required this.id, required this.versionNumber, this.publishedAt});

  factory CheckInFormVersion.fromJson(Map<String, dynamic> j) => CheckInFormVersion(
        id: (j['id'] ?? '').toString(),
        versionNumber: _int(j['version_number']) ?? 0,
        publishedAt: DateTime.tryParse((j['published_at'] ?? '').toString()),
      );
}

/// The PUBLISHED version of the check-in form. Fields are kept in the order the
/// backend returned them (display_order).
class CheckInForm {
  final String formId;
  final String title;
  final CheckInFormVersion version;
  final List<CheckInField> fields;

  const CheckInForm({required this.formId, required this.title, required this.version, required this.fields});

  /// A required question this app version cannot render: submitting would always fail.
  bool get hasUnsupportedRequired => fields.any((f) => f.isRequired && !f.isSupported);

  factory CheckInForm.fromJson(Map<String, dynamic> data) {
    final form = data['form'] is Map ? Map<String, dynamic>.from(data['form'] as Map) : <String, dynamic>{};
    final version = Map<String, dynamic>.from((data['version'] as Map?) ?? const {});
    final fields = ((data['fields'] as List?) ?? const [])
        .whereType<Map>()
        .map((e) => CheckInField.fromJson(Map<String, dynamic>.from(e)))
        .toList();
    return CheckInForm(
      formId: (form['id'] ?? '').toString(),
      title: (form['title'] ?? '').toString(),
      version: CheckInFormVersion.fromJson(version),
      fields: fields,
    );
  }
}

/// One answer as the backend expects it: { field_id, value }.
class CheckInAnswerInput {
  final String fieldId;
  final dynamic value; // String | num | bool | List<String>, matching the field type

  const CheckInAnswerInput(this.fieldId, this.value);

  Map<String, dynamic> toJson() => {'field_id': fieldId, 'value': value};
}
