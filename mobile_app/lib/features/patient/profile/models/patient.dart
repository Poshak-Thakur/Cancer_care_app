/// Backend sends dates as ISO strings (UTC). For date-only fields we keep just
/// the calendar day so timezones can never shift a birthday.
DateTime parseDateOnly(String iso) {
  final d = DateTime.parse(iso.substring(0, 10));
  return DateTime(d.year, d.month, d.day);
}

String toDateOnly(DateTime d) =>
    '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

class Patient {
  final String id;
  final String fullName;
  final DateTime dateOfBirth;
  final String preferredLanguage; // 'en' | 'hi'
  final String? cancerType;
  final String? cancerStage;
  final DateTime? diagnosisDate;
  final String? carePlanSummary;

  const Patient({
    required this.id,
    required this.fullName,
    required this.dateOfBirth,
    required this.preferredLanguage,
    this.cancerType,
    this.cancerStage,
    this.diagnosisDate,
    this.carePlanSummary,
  });

  factory Patient.fromJson(Map<String, dynamic> j) => Patient(
        id: j['id'] as String,
        fullName: (j['full_name'] as String?) ?? '',
        dateOfBirth: j['date_of_birth'] is String && (j['date_of_birth'] as String).length >= 10
            ? parseDateOnly(j['date_of_birth'] as String)
            : DateTime(1970, 1, 1),
        preferredLanguage: (j['preferred_language'] as String?) ?? 'en',
        cancerType: j['cancer_type'] as String?,
        cancerStage: j['cancer_stage'] as String?,
        diagnosisDate: j['diagnosis_date'] == null || (j['diagnosis_date'] as String).length < 10
            ? null
            : parseDateOnly(j['diagnosis_date'] as String),
        carePlanSummary: j['care_plan_summary'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'full_name': fullName,
        'date_of_birth': toDateOnly(dateOfBirth),
        'preferred_language': preferredLanguage,
        'cancer_type': cancerType,
        'cancer_stage': cancerStage,
        'diagnosis_date': diagnosisDate == null ? null : toDateOnly(diagnosisDate!),
        'care_plan_summary': carePlanSummary,
      };
}