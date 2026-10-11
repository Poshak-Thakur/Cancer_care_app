import 'package:flutter/foundation.dart';
import '../../../core/constants/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/utils/uuid.dart';
import '../../patient/dashboard/models/dashboard_overview.dart';

/// Result of POST /api/alerts/help-now.
class HelpNowResult {
  final DashboardAlert alert;

  /// A brand-new alert was opened.
  final bool created;

  /// The press was merged into this person's already-open Help Now alert.
  final bool merged;

  /// The same client_event_id had already been recorded (a retry).
  final bool replay;

  const HelpNowResult({required this.alert, required this.created, required this.merged, required this.replay});
}

/// Manual "Help Now" requests. This creates a HELP_REQUEST alert, never a
/// symptom event. The backend decides who may ask for help and who may cancel.
class AlertService {
  final ApiClient _api = ApiClient.instance;

  /// A new id per press-intent. Reuse the SAME id when retrying that press so
  /// the backend can de-duplicate it.
  static String newClientEventId() => Uuid.v4();

  /// POST /api/alerts/help-now.
  Future<HelpNowResult> helpNow({
    required String patientId,
    required String clientEventId,
    String? note,
  }) async {
    final text = note?.trim() ?? '';
    final res = await _api.post(ApiEndpoints.helpNow, body: {
      'patient_id': patientId,
      'client_event_id': clientEventId,
      if (text.isNotEmpty) 'note': text,
    });
    final meta = res['meta'] is Map ? Map<String, dynamic>.from(res['meta'] as Map) : const <String, dynamic>{};
    return HelpNowResult(
      alert: DashboardAlert.fromJson(Map<String, dynamic>.from(res['data'] as Map)),
      created: meta['created'] == true,
      merged: meta['merged'] == true,
      replay: meta['replay'] == true,
    );
  }

  /// PATCH /api/alerts/:id/cancel. Only the requester may cancel, and only
  /// while the alert is OPEN or ACKNOWLEDGED (otherwise 403 / 409).
  Future<DashboardAlert> cancelHelpNow(String alertId, {String? note}) async {
    final text = note?.trim() ?? '';
    final res = await _api.patch(ApiEndpoints.cancelHelpNow(alertId), body: {
      if (text.isNotEmpty) 'note': text,
    });
    return DashboardAlert.fromJson(Map<String, dynamic>.from(res['data'] as Map));
  }
}

/// An alert the user tapped in a notification, waiting for the UI to open it.
class PendingAlertOpen {
  final String alertId;
  final String? patientId;
  const PendingAlertOpen(this.alertId, this.patientId);
}

/// In-app signals about alerts, so code outside the widget tree (push) can
/// make dashboards reload and open an alert.
class AlertEvents {
  AlertEvents._();

  /// Bumped when alert data may have changed (a critical push arrived, Help Now
  /// was sent or cancelled). Dashboards listen and reload from the backend.
  static final ValueNotifier<int> changed = ValueNotifier<int>(0);

  static void notifyChanged() => changed.value++;

  /// Set when a notification was tapped before the UI could open it (for
  /// example a cold start). The signed-in shells consume it once they exist.
  static PendingAlertOpen? pendingOpen;
}
