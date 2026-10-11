import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import 'package:flutter/material.dart';
import '../../features/shared/alerts/alert_detail_screen.dart';
import '../../features/shared/alerts/alert_service.dart';
import '../../features/shared/calls/call_coordinator.dart';
import '../../features/shared/calls/models/call_models.dart';
import '../constants/api_endpoints.dart';
import '../localization/strings.dart';
import '../network/api_client.dart';
import '../routing/app_routes.dart';
import '../storage/token_storage.dart';

/// Runs in a separate isolate when a push arrives and the app is in the
/// background or closed. It must be a top-level function.
@pragma('vm:entry-point')
Future<void> saathiBackgroundMessageHandler(RemoteMessage message) async {
  try {
    await Firebase.initializeApp();
  } catch (_) {}
  await PushService.handleData(message.data);
}

/// Firebase Cloud Messaging: makes the phone ring for a call even when the app
/// is closed, and lets the backend know where to send pushes.
///
/// Needs the Firebase files from the Firebase console (google-services.json on
/// Android). If they are missing the app still works, only closed-app ringing
/// is off; see PUSH_AND_CALLS_SETUP.md.
class PushService {
  static bool _ready = false;
  static String? _lastSent;

  static Future<void> init() async {
    try {
      await Firebase.initializeApp();
      FirebaseMessaging.onBackgroundMessage(saathiBackgroundMessageHandler);
      // App in the foreground: FCM shows no system notification, so critical
      // alerts get an in-app banner here.
      FirebaseMessaging.onMessage.listen(_onForegroundMessage);
      // Notification tapped while the app was in the background.
      FirebaseMessaging.onMessageOpenedApp.listen((m) => _openFromTap(m.data));
      FirebaseMessaging.instance.onTokenRefresh.listen(_register);
      _ready = true;
      // Notification tapped while the app was closed: the UI does not exist yet,
      // so the alert is parked and opened by the signed-in shell.
      final initial = await FirebaseMessaging.instance.getInitialMessage();
      if (initial != null) _openFromTap(initial.data);
    } catch (e) {
      debugPrint('Push disabled (Firebase not configured): $e');
    }
  }

  /// Call after sign-in: asks for notification permission and sends this
  /// phone's token to the backend (POST /api/auth/fcm-token).
  static Future<void> registerForUser() async {
    if (!_ready) return;
    try {
      await FirebaseMessaging.instance.requestPermission(alert: true, badge: true, sound: true);
      // Android 13+ notification permission and Android 14+ full-screen call screen.
      await FlutterCallkitIncoming.requestNotificationPermission({
        'rationaleMessagePermission': 'Notifications are needed to show incoming calls.',
        'postNotificationMessageRequired': 'Please allow notifications in Settings to receive calls.',
      });
      await FlutterCallkitIncoming.requestFullIntentPermission();
    } catch (_) {}
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token != null) await _register(token, force: true);
    } catch (_) {}
  }

  static Future<void> _register(String token, {bool force = false}) async {
    if (!TokenStorage.hasRefresh) return; // not signed in yet
    if (!force && token == _lastSent) return;
    try {
      await ApiClient.instance.post(ApiEndpoints.fcmToken, body: {'fcm_token': token});
      _lastSent = token;
    } catch (_) {
      // Retried at the next sign-in or token refresh.
    }
  }

  /// Foreground message: calls/chat go through [handleData]; a critical alert
  /// also gets an in-app banner built from the (privacy-safe) notification text.
  static Future<void> _onForegroundMessage(RemoteMessage m) async {
    await handleData(m.data, foreground: true, notification: m.notification);
  }

  /// Handles the data of a push message. Runs in the foreground and, with
  /// [foreground] false, in the background isolate (no UI available there: the
  /// system tray shows the notification and a tap is handled by [_openFromTap]).
  static Future<void> handleData(Map<String, dynamic> data, {bool foreground = false, RemoteNotification? notification}) async {
    switch (data['type']) {
      case 'CALL_INVITATION':
        try {
          await CallCoordinator.showIncoming(IncomingCall.fromJson(Map<String, dynamic>.from(data)));
        } catch (_) {}
        break;
      case 'CALL_CANCELLED':
        final id = data['call_id']?.toString();
        if (id != null) await CallCoordinator.cancelIncoming(id);
        break;
      case 'CRITICAL_ALERT':
        _handleCriticalAlert(data, foreground: foreground, notification: notification);
        break;
      default:
        break; // CHAT_MESSAGE is shown by the system tray
    }
  }

  /// CRITICAL_ALERT: refresh what the dashboards show and, in the foreground,
  /// show a banner. A push never proves the alert is still open, so nothing
  /// here acts on its status: the dashboards and the alert screen re-read it
  /// from the backend.
  static void _handleCriticalAlert(Map<String, dynamic> data, {required bool foreground, RemoteNotification? notification}) {
    if (!foreground) return; // background isolate: tray notification only
    AlertEvents.notifyChanged(); // dashboards reload from the backend

    final alertId = data['alert_id']?.toString();
    final patientId = data['patient_id']?.toString();
    final messenger = AppRoutes.messengerKey.currentState;
    if (messenger == null) return;

    final title = notification?.title;
    final body = notification?.body;
    messenger.hideCurrentSnackBar();
    messenger.showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 10),
        behavior: SnackBarBehavior.floating,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null && title.isNotEmpty) Text(title, style: const TextStyle(fontWeight: FontWeight.bold)),
            Text(body != null && body.isNotEmpty ? body : S.t('criticalAlertFallback')),
          ],
        ),
        action: (alertId == null || alertId.isEmpty)
            ? null
            : SnackBarAction(
                label: S.t('view'),
                onPressed: () => AlertNavigator.open(alertId, patientId: patientId),
              ),
      ),
    );
  }

  /// A notification was tapped. Only CRITICAL_ALERT opens something here
  /// (calls and chat have their own handling).
  static void _openFromTap(Map<String, dynamic> data) {
    if (data['type'] != 'CRITICAL_ALERT') return;
    final alertId = data['alert_id']?.toString();
    if (alertId == null || alertId.isEmpty) return;
    AlertEvents.notifyChanged();
    // Opens now when signed in with a live navigator, otherwise parks it for the shell.
    AlertNavigator.open(alertId, patientId: data['patient_id']?.toString());
  }
}
