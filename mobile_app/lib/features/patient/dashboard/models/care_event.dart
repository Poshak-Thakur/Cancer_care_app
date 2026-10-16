class MedicationInfo {
  final String name;
  final String? strength;
  final String? form;
  final String? instructions;

  const MedicationInfo({
    required this.name,
    this.strength,
    this.form,
    this.instructions,
  });

  factory MedicationInfo.fromJson(Map<String, dynamic> j) => MedicationInfo(
        name: (j['name'] as String?) ?? '',
        strength: j['strength'] as String?,
        form: j['form'] as String?,
        instructions: j['instructions'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        if (strength != null) 'strength': strength,
        if (form != null) 'form': form,
        if (instructions != null) 'instructions': instructions,
      };
}

/// Every care event type the backend accepts.
const careEventTypes = [
  'APPOINTMENT',
  'MEDICATION_DOSE',
  'THERAPY_SESSION',
  'COUNSELLOR_FOLLOWUP',
  'HOME_VISIT',
  'OTHER',
];

class CareEvent {
  final String id;
  final String patientId;
  final String type; // MEDICATION_DOSE | APPOINTMENT | THERAPY_SESSION | COUNSELLOR_FOLLOWUP | HOME_VISIT | OTHER
  final String completionStatus; // SCHEDULED | DUE | COMPLETED | MISSED | SNOOZED | CANCELLED
  final DateTime scheduleTime; // absolute moment (display it with Ist.clock)
  final MedicationInfo? medication;

  /// Title / place / note typed or dictated when the task was created. The
  /// backend keeps them inside `reminder_rule`.
  final String? title;
  final String? location;
  final String? note;

  const CareEvent({
    required this.id,
    required this.patientId,
    required this.type,
    required this.completionStatus,
    required this.scheduleTime,
    this.medication,
    this.title,
    this.location,
    this.note,
  });

  bool get isCompleted => completionStatus == 'COMPLETED';
  bool get isCancelled => completionStatus == 'CANCELLED';
  bool get isMissed => completionStatus == 'MISSED';
  bool get isMedication => type == 'MEDICATION_DOSE';
  bool get isAppointment => type == 'APPOINTMENT';

  CareEvent copyWith({String? completionStatus}) => CareEvent(
        id: id,
        patientId: patientId,
        type: type,
        completionStatus: completionStatus ?? this.completionStatus,
        scheduleTime: scheduleTime,
        medication: medication,
        title: title,
        location: location,
        note: note,
      );

  factory CareEvent.fromJson(Map<String, dynamic> j) {
    final med = j['patientmedication'];
    final rule = j['reminder_rule'];
    String? pick(String key) {
      if (rule is! Map) return null;
      final v = rule[key];
      return v is String && v.trim().isNotEmpty ? v.trim() : null;
    }

    return CareEvent(
      id: j['id'] as String,
      patientId: (j['patient_id'] as String?) ?? '',
      type: j['type'] as String,
      completionStatus: (j['completion_status'] as String?) ?? 'SCHEDULED',
      scheduleTime: DateTime.parse(j['schedule_time'] as String),
      medication: med is Map ? MedicationInfo.fromJson(Map<String, dynamic>.from(med)) : null,
      title: pick('title'),
      location: pick('location'),
      note: pick('note'),
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'patient_id': patientId,
        'type': type,
        'completion_status': completionStatus,
        'schedule_time': scheduleTime.toUtc().toIso8601String(),
        if (medication != null) 'patientmedication': medication!.toJson(),
        'reminder_rule': {
          if (title != null) 'title': title,
          if (location != null) 'location': location,
          if (note != null) 'note': note,
        },
      };
}

/// Result of POST /api/care-events/parse-command: what the AI understood from
/// a typed or dictated sentence. The person confirms or edits it before saving.
class ParsedCommand {
  final String type;
  final String title;
  final DateTime? scheduleTime;
  final String? location;
  final String? note;

  const ParsedCommand({
    required this.type,
    required this.title,
    this.scheduleTime,
    this.location,
    this.note,
  });

  factory ParsedCommand.fromJson(Map<String, dynamic> j) {
    final rawType = (j['type'] as String?)?.toUpperCase() ?? 'APPOINTMENT';
    String? clean(dynamic v) {
      if (v is! String) return null;
      final t = v.trim();
      return t.isEmpty || t.toLowerCase() == 'null' ? null : t;
    }

    return ParsedCommand(
      type: careEventTypes.contains(rawType) ? rawType : 'APPOINTMENT',
      title: clean(j['title']) ?? '',
      scheduleTime: DateTime.tryParse((j['schedule_time'] as String?) ?? ''),
      location: clean(j['location']),
      note: clean(j['note']),
    );
  }
}