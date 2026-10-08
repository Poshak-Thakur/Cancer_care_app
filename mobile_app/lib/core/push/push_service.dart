import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import '../../features/shared/calls/call_coordinator.dart';
import '../../features/shared/calls/models/call_models.dart';
import '../constants/api_endpoints.dart';
import '../network/api_client.dart';
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
      FirebaseMessaging.onMessage.listen((m) => handleData(m.data));
      FirebaseMessaging.instance.onTokenRefresh.listen(_register);
      _ready = true;
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

  /// Handles the data of a push message (foreground and background).
  static Future<void> handleData(Map<String, dynamic> data) async {
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
      default:
        break; // CHAT_MESSAGE / CRITICAL_ALERT are shown by the system tray
    }
  }
}
