class MedicalDocument {
  final String id;
  final String title;
  final String documentType; // PRESCRIPTION | LAB_REPORT | SCAN | DISCHARGE_SUMMARY | OTHER
  final String? verificationStatus; // PENDING | VERIFIED | REJECTED (absent in dashboard summary)
  final bool? isPrivate;
  final DateTime uploadedAt;

  const MedicalDocument({
    required this.id,
    required this.title,
    required this.documentType,
    required this.uploadedAt,
    this.verificationStatus,
    this.isPrivate,
  });

  factory MedicalDocument.fromJson(Map<String, dynamic> j) => MedicalDocument(
        id: j['id'] as String,
        title: j['title'] as String,
        documentType: j['document_type'] as String,
        verificationStatus: j['verification_status'] as String?,
        isPrivate: j['is_private'] as bool?,
        uploadedAt: DateTime.parse(j['uploaded_at'] as String),
      );
}

const documentTypes = ['PRESCRIPTION', 'LAB_REPORT', 'SCAN', 'DISCHARGE_SUMMARY', 'OTHER'];

/// A medication read from a prescription photo. Editable: the person corrects
/// anything the AI got wrong before it is saved.
class ScannedMedication {
  String name;
  String strength;
  String form;
  String instructions;

  ScannedMedication({this.name = '', this.strength = '', this.form = '', this.instructions = ''});

  factory ScannedMedication.fromJson(Map<String, dynamic> j) {
    String s(dynamic v) {
      if (v == null) return '';
      final t = v.toString().trim();
      return t.toLowerCase() == 'null' ? '' : t;
    }

    return ScannedMedication(
      name: s(j['name']),
      strength: s(j['strength']),
      form: s(j['form']),
      instructions: s(j['instructions']),
    );
  }

  Map<String, dynamic> toJson() => {
        'name': name.trim(),
        'strength': strength.trim().isEmpty ? null : strength.trim(),
        'form': form.trim().isEmpty ? null : form.trim(),
        'instructions': instructions.trim().isEmpty ? null : instructions.trim(),
      };
}

/// Response of POST /api/documents/prescriptions/scan.
class PrescriptionScan {
  final String prescriptionId;
  final List<ScannedMedication> medications;
  const PrescriptionScan({required this.prescriptionId, required this.medications});

  factory PrescriptionScan.fromJson(Map<String, dynamic> j) => PrescriptionScan(
        prescriptionId: j['prescription_id'].toString(),
        medications: ((j['medications'] as List?) ?? const [])
            .map((e) => ScannedMedication.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList(),
      );
}
