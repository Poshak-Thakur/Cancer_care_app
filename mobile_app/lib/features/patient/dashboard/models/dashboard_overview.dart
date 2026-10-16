import '../../documents/models/medical_document.dart';
import 'care_event.dart';

/// Alert types the backend can raise (alert_type_enum).
class AlertType {
  AlertType._();
  static const helpRequest = 'HELP_REQUEST'; // manual "Help Now"
  static const deterioration = 'DETERIORATION'; // severe symptom in a check-in
  static const missedMedication = 'MISSED_MEDICATION';
  static const missedFollowup = 'MISSED_FOLLOWUP';
}

/// Alert statuses (alert_status_enum).
class AlertStatus {
  AlertStatus._();
  static const open = 'OPEN';
  static const acknowledged = 'ACKNOWLEDGED';
  static const inProgress = 'IN_PROGRESS';
  static const resolved = 'RESOLVED';
  static const cancelled = 'CANCELLED';
  static const escalationExhausted = 'ESCALATION_EXHAUSTED';

  /// A requester may cancel their Help Now only in these states.
  static const cancellable = [open, acknowledged];
}

/// An alert, as listed on the dashboard (active alerts) or returned by the
/// Help Now endpoints.
class DashboardAlert {
  final String id;
  final String type; // see AlertType
  final String severity;
  final String status; // see AlertStatus
  final DateTime createdAt;
  final DateTime? updatedAt;
  final String? patientId;

  /// Help Now only: the user who pressed the button (null for automatic alerts).
  final String? requestedByUserId;

  const DashboardAlert({
    required this.id,
    required this.type,
    required this.severity,
    required this.status,
    required this.createdAt,
    this.updatedAt,
    this.patientId,
    this.requestedByUserId,
  });

  bool get isHelpRequest => type == AlertType.helpRequest;

  bool canBeCancelledBy(String userId) =>
      isHelpRequest &&
      userId.isNotEmpty &&
      requestedByUserId == userId &&
      AlertStatus.cancellable.contains(status);

  factory DashboardAlert.fromJson(Map<String, dynamic> j) => DashboardAlert(
        id: j['id'] as String,
        type: (j['type'] as String?) ?? '',
        severity: (j['severity'] as String?) ?? '',
        status: (j['status'] as String?) ?? AlertStatus.open,
        createdAt: DateTime.tryParse((j['created_at'] as String?) ?? '') ?? DateTime.now(),
        updatedAt: DateTime.tryParse((j['updated_at'] as String?) ?? ''),
        patientId: j['patient_id'] as String?,
        requestedByUserId: j['requested_by_user_id'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'type': type,
        'severity': severity,
        'status': status,
        'created_at': createdAt.toUtc().toIso8601String(),
        if (updatedAt != null) 'updated_at': updatedAt!.toUtc().toIso8601String(),
        if (patientId != null) 'patient_id': patientId,
        if (requestedByUserId != null) 'requested_by_user_id': requestedByUserId,
      };
}

class DashboardOverview {
  final String? relationship;
  final List<String> accessScopes;
  final int totalToday;
  final int completedToday;
  final List<CareEvent> events;
  final bool checkInCompleted;
  final List<MedicalDocument> documents;
  final List<DashboardAlert> alerts;

  const DashboardOverview({
    required this.relationship,
    required this.accessScopes,
    required this.totalToday,
    required this.completedToday,
    required this.events,
    required this.checkInCompleted,
    required this.documents,
    this.alerts = const [],
  });

  factory DashboardOverview.fromJson(Map<String, dynamic> j) {
    final tasks = (j['care_tasks'] as Map?) ?? const {};
    final wellbeing = (j['wellbeing'] as Map?) ?? const {};
    final rawEvents = (tasks['events'] as List?) ?? const [];
    return DashboardOverview(
      relationship: j['relationship'] as String?,
      accessScopes: ((j['access_scopes'] as List?) ?? const []).map((e) => e.toString()).toList(),
      totalToday: ((tasks['total_today'] as num?) ?? rawEvents.length).toInt(),
      completedToday: ((tasks['completed_today'] as num?) ?? 0).toInt(),
      events: rawEvents
          .map((e) => CareEvent.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      checkInCompleted: (wellbeing['check_in_completed'] as bool?) ?? false,
      documents: ((j['documents'] as List?) ?? const [])
          .map((e) => MedicalDocument.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      alerts: ((j['active_alerts'] as List?) ?? const [])
          .map((e) => DashboardAlert.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }
}