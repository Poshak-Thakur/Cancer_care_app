/// The signed-in person's patient record, as returned by the backend
/// (GET /api/patients/me -> data[].patient, or POST /api/patients -> data.patient).
class UserProfile {
  final String patientId;
  final String name;
  final DateTime? dob;
  final String preferredLanguage; // 'en' | 'hi'
  const UserProfile({
    required this.patientId,
    required this.name,
    required this.dob,
    required this.preferredLanguage,
  });

  factory UserProfile.fromPatientJson(Map<String, dynamic> json) {
    final rawDob = json['date_of_birth'] as String?;
    return UserProfile(
      patientId: json['id'] as String,
      name: (json['full_name'] as String?) ?? '',
      dob: rawDob == null ? null : DateTime.tryParse(rawDob)?.toLocal(),
      preferredLanguage: (json['preferred_language'] as String?) ?? 'en',
    );
  }
}
