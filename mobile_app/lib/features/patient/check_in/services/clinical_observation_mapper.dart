import '../models/check_in_form.dart';

/// Maps answers of ESTABLISHED clinical fields to the legacy `observations`
/// the backend's deterioration-alert rule reads. Everything else the NGO adds
/// is stored as an answer only and NEVER changes alerting.
///
/// A field is mapped only when BOTH hold:
///   1. its `field_key` is one of the keys below, and
///   2. the selected option's `option_value` is one of the known level values.
/// Anything else (a renamed key, a SCALE, a free-text question, different
/// option values) produces no observation. That is deliberate: severity must
/// not be inferred from an arbitrary custom question. To make another field
/// alert-relevant, the product/backend team has to define it explicitly here.
class ClinicalObservationMapper {
  ClinicalObservationMapper._();

  /// Severity sent for the four levels (best to worst). The backend alerts at >= 8.
  static const severityByLevel = [1, 4, 7, 10];

  /// field_key -> (observation_type, option_values from best to worst).
  /// The option values are the slugs the backend derives from the built-in labels.
  static const _levelFields = <String, _LevelSpec>{
    'pain': _LevelSpec('PAIN_LEVEL', ['none', 'mild', 'moderate', 'severe']),
    'fatigue': _LevelSpec('FATIGUE', ['none', 'a_little', 'a_lot', 'exhausted']),
    'appetite': _LevelSpec('APPETITE', ['good', 'okay', 'low', 'none']),
    'mood': _LevelSpec('MOOD', ['good', 'okay', 'low', 'very_low']),
    'nausea': _LevelSpec('NAUSEA', ['none', 'mild', 'moderate', 'severe']),
    'breathlessness': _LevelSpec('BREATHLESSNESS', ['none', 'mild', 'moderate', 'severe']),
    'dizziness': _LevelSpec('DIZZINESS', ['none', 'mild', 'moderate', 'severe']),
  };

  /// field_key -> (observation_type, unit). Numeric only, no severity.
  static const _numberFields = <String, _NumberSpec>{
    'water_intake': _NumberSpec('WATER_INTAKE', 'Liters'),
    'sleep_hours': _NumberSpec('SLEEP_HOURS', 'Hours'),
  };

  /// [values]: field id -> the answer value that was submitted for it
  /// (option_value String for SINGLE_CHOICE, num for NUMBER).
  static List<Map<String, dynamic>> build(CheckInForm form, Map<String, dynamic> values) {
    final out = <Map<String, dynamic>>[];
    for (final f in form.fields) {
      final v = values[f.id];
      if (v == null) continue;

      final level = _levelFields[f.fieldKey];
      if (level != null && f.type == CheckInFieldType.singleChoice && v is String) {
        final idx = level.values.indexOf(v);
        if (idx >= 0) {
          out.add({'observation_type': level.code, 'severity': severityByLevel[idx]});
        }
        continue;
      }

      final number = _numberFields[f.fieldKey];
      if (number != null && f.type == CheckInFieldType.number && v is num) {
        out.add({'observation_type': number.code, 'numeric_value': v, 'unit': number.unit});
      }
    }
    return out;
  }
}

class _LevelSpec {
  final String code;
  final List<String> values;
  const _LevelSpec(this.code, this.values);
}

class _NumberSpec {
  final String code;
  final String unit;
  const _NumberSpec(this.code, this.unit);
}
