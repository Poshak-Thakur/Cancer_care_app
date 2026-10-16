import 'patient.dart';

/// One item of GET /api/patients/me.
class PatientLink {
  final String relationshipType; // SELF | DELEGATE
  final String relationshipLabel;
  final List<String> accessScopes;
  final Patient patient;

  const PatientLink({
    required this.relationshipType,
    required this.relationshipLabel,
    required this.accessScopes,
    required this.patient,
  });

  factory PatientLink.fromJson(Map<String, dynamic> j) => PatientLink(
        relationshipType: (j['relationship_type'] as String?) ?? 'SELF',
        relationshipLabel: (j['relationship_label'] as String?) ?? '',
        accessScopes: ((j['access_scopes'] as List?) ?? const []).map((e) => e.toString()).toList(),
        patient: Patient.fromJson(Map<String, dynamic>.from(j['patient'] as Map)),
      );

  Map<String, dynamic> toJson() => {
        'relationship_type': relationshipType,
        'relationship_label': relationshipLabel,
        'access_scopes': accessScopes,
        'patient': patient.toJson(),
      };
}