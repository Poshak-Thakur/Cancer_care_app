import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../patient/messages/models/care_contact.dart';
import 'models/call_models.dart';
import 'screens/call_screen.dart';
import 'screens/incoming_call_screen.dart';
import 'services/call_service.dart';

/// One place that decides how an incoming call is shown and answered.
///
/// Calls reach the phone two ways: the socket (app open) and a Firebase push
/// (app in the background or closed). Both end up in [showIncoming], which uses
/// the system "incoming call" screen (full-screen on a locked phone, with the
/// phone's ringtone). If that is unavailable it falls back to the in-app
/// [IncomingCallScreen].
///
/// When the user answers from the system screen while the app was closed, the
/// app has to sign in again first, so the answer is kept in [_pendingAccept]
/// and completed by [onSessionReady] once the home screen is open.
class CallCoordinator {
  static const _ringMillis = 45000;

  static final Set<String> _handled = {}; // call ids already accepted or declined
  static final Set<String> _showing = {}; // call ids being shown (socket and push can arrive together)
  static IncomingCall? _pendingAccept;
  static bool _sessionReady = false;
  static StreamSubscription? _eventSub;
  static StreamSubscription? _statusSub;

  /// Call once at app start (main isolate).
  static Future<void> init() async {
    _eventSub ??= FlutterCallkitIncoming.onEvent.listen(_onEvent, onError: (_) {});
    // The caller hung up while it was still ringing: stop ringing here too.
    _statusSub ??= SocketService.instance.statusUpdates.listen((u) {
      if (u.status == 'COMPLETED' || u.status == 'MISSED') {
        if (!_handled.contains(u.callId)) _endSystemCall(u.callId);
      }
    });
    await _recoverAnsweredWhileClosed();
  }

  // ---------------------------------------------------------------- show

  /// Safe to call from the background isolate (it never touches the UI there).
  static Future<void> showIncoming(IncomingCall call) async {
    if (_handled.contains(call.callId)) return;
    if (CallScreen.active) return; // already in a call
    if (!_showing.add(call.callId)) return; // the other channel is already showing it
    Future.delayed(const Duration(minutes: 2), () => _showing.remove(call.callId));
    if (await _isRinging(call.callId)) return; // already on the system screen

    try {
      final name = _nameOf(call);
      await FlutterCallkitIncoming.showCallkitIncoming(CallKitParams(
        id: call.callId,
        nameCaller: name,
        appName: 'Saathi',
        handle: call.isVideo ? S.t('incomingVideo') : S.t('incomingAudio'),
        type: call.isVideo ? 1 : 0,
        duration: _ringMillis,
        missedCallNotification: NotificationParams(
          showNotification: true,
          isShowCallback: false,
          subtitle: S.t('callMissed'),
        ),
        extra: Map<String, dynamic>.from(call.toJson()),
        android: AndroidParams(
          isCustomNotification: true,
          isShowLogo: false,
          ringtonePath: 'system_ringtone_default',
          backgroundColor: '#0E4D55',
          actionColor: '#2E9E6B',
          textColor: '#ffffff',
          textAccept: S.t('accept'),
          textDecline: S.t('decline'),
          incomingCallNotificationChannelName: 'Incoming calls',
          missedCallNotificationChannelName: 'Missed calls',
        ),
      ));
    } catch (_) {
      // Fall back to the in-app ringing screen (only possible while the app is open).
      if (IncomingCallScreen.ringingCallId == null) {
        AppRoutes.pushGlobal(IncomingCallScreen(call: call));
      }
    }
  }

  /// Called for push messages of type CALL_CANCELLED (caller hung up).
  static Future<void> cancelIncoming(String callId) => _endSystemCall(callId);

  // ---------------------------------------------------------------- events

  static void _onEvent(CallEvent? event) {
    if (event == null) return;

    if (event is CallEventActionCallAccept) {
      final call = _callFromParams(event.callKitParams);
      if (call != null) _onAccept(call);
      return;
    }

    if (event is CallEventActionCallDecline) {
      final call = _callFromParams(event.callKitParams);
      if (call != null) _onDecline(call);
      return;
    }

    // Incoming / ended / timeout / other events need no handling here.
  }

  /// The call data is carried in CallKitParams.extra (set in [showIncoming]).
  static IncomingCall? _callFromParams(CallKitParams params) {
    try {
      final extra = params.extra;
      if (extra != null) {
        return IncomingCall.fromJson(Map<String, dynamic>.from(extra));
      }
    } catch (_) {}
    return null;
  }

  static void _onAccept(IncomingCall call) {
    if (!_handled.add(call.callId)) return;
    if (_sessionReady) {
      _acceptNow(call);
    } else {
      _pendingAccept = call; // finished by onSessionReady()
    }
  }

  static Future<void> _onDecline(IncomingCall call) async {
    if (!_handled.add(call.callId)) return;
    try {
      await CallService().updateStatus(call.callId, 'REJECTED');
    } catch (_) {}
    await _endSystemCall(call.callId);
  }

  static Future<void> _acceptNow(IncomingCall call) async {
    try {
      await CallService().updateStatus(call.callId, 'ONGOING');
    } on ApiException {
      await _endSystemCall(call.callId);
      AppRoutes.messengerKey.currentState?.showSnackBar(SnackBar(content: Text(S.t('callEnded'))));
      return;
    } catch (_) {
      await _endSystemCall(call.callId);
      AppRoutes.messengerKey.currentState?.showSnackBar(SnackBar(content: Text(S.t('callFailed'))));
      return;
    }
    // Our own call screen (Agora) takes over; remove the system call UI.
    await _endSystemCall(call.callId);
    AppRoutes.pushGlobal(CallScreen(
      callId: call.callId,
      appId: call.appId,
      channelName: call.channelName,
      token: call.token,
      video: call.isVideo,
      peerName: _nameOf(call),
      isCaller: false,
    ));
  }

  // ---------------------------------------------------------------- session

  /// The home screen is open and the user is signed in.
  static void onSessionReady() {
    _sessionReady = true;
    final pending = _pendingAccept;
    _pendingAccept = null;
    if (pending != null) _acceptNow(pending);
  }

  static void onSignedOut() {
    _sessionReady = false;
    _pendingAccept = null;
    FlutterCallkitIncoming.endAllCalls();
  }

  /// App returned to the foreground: finish an answer that was made on the
  /// system screen while the app was not running.
  static Future<void> onResume() => _recoverAnsweredWhileClosed();

  static Future<void> _recoverAnsweredWhileClosed() async {
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      for (final params in calls) {
        if (params.isAccepted == true) {
          final call = _callFromParams(params);
          if (call != null) _onAccept(call);
        }
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------- helpers

  static String _nameOf(IncomingCall call) {
    if (call.callerName.isNotEmpty) return call.callerName;
    return ContactDirectory.nameFor(call.callerId) ?? S.t('careTeamMember');
  }

  static Future<bool> _isRinging(String callId) async {
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      return calls.any((c) => c.id == callId);
    } catch (_) {
      return false;
    }
  }

  static Future<void> _endSystemCall(String callId) async {
    try {
      await FlutterCallkitIncoming.endCall(callId);
    } catch (_) {}
  }
}