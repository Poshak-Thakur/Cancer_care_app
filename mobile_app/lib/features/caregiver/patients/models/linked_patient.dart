import '../../../patient/profile/models/patient.dart';

/// One item of GET /api/caregivers/patients.
class LinkedPatient {
  final String relationshipLabel;
  final List<String> accessScopes;
  final String availability; // AVAILABLE | UNAVAILABLE | DO_NOT_DISTURB
  final bool isPrimary;
  final Patient patient;

  const LinkedPatient({
    required this.relationshipLabel,
    required this.accessScopes,
    required this.availability,
    required this.isPrimary,
    required this.patient,
  });

  LinkedPatient withAvailability(String value) => LinkedPatient(
        relationshipLabel: relationshipLabel,
        accessScopes: accessScopes,
        availability: value,
        isPrimary: isPrimary,
        patient: patient,
      );

  factory LinkedPatient.fromJson(Map<String, dynamic> j) => LinkedPatient(
        relationshipLabel: (j['relationship_label'] as String?) ?? '',
        accessScopes: ((j['access_scopes'] as List?) ?? const []).map((e) => e.toString()).toList(),
        availability: (j['availability'] as String?) ?? 'AVAILABLE',
        isPrimary: (j['is_primary'] as bool?) ?? false,
        patient: Patient.fromJson(Map<String, dynamic>.from(j['patient'] as Map)),
      );

  Map<String, dynamic> toJson() => {
        'relationship_label': relationshipLabel,
        'access_scopes': accessScopes,
        'availability': availability,
        'is_primary': isPrimary,
        'patient': patient.toJson(),
      };
}