import 'dart:async';
import 'package:flutter/foundation.dart' show debugPrint;
import 'package:flutter/material.dart';
import 'package:flutter_callkit_incoming/entities/entities.dart';
import 'package:flutter_callkit_incoming/flutter_callkit_incoming.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../patient/messages/models/care_contact.dart';
import 'models/call_models.dart';
import 'screens/call_ended_screen.dart';
import 'screens/call_screen.dart';
import 'screens/incoming_call_screen.dart';
import 'services/call_service.dart';
import '../../../core/constants/app_brand.dart';

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

  /// Every step of the call path logs with this tag, so one `adb logcat | grep SaathiCall`
  /// shows where an answered call was lost (the app's own logs use the `flutter` tag).
  static void _log(String m) => debugPrint('[SaathiCall] $m');

  static final Set<String> _handled = {}; // call ids already accepted or declined
  static final Set<String> _showing = {}; // call ids being shown (socket and push can arrive together)
  static IncomingCall? _pendingAccept;
  static bool _sessionReady = false;
  static StreamSubscription? _eventSub;
  static StreamSubscription? _statusSub;
  static bool _endedShown = false;

  /// Call once at app start (main isolate).
  static Future<void> init() async {
    _eventSub ??= FlutterCallkitIncoming.onEvent.listen(_onEvent, onError: (e) => _log('call event stream error: $e'));
    _log('init: listening for system call events');
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
    _log('incoming ${call.callId} from ${call.callerName.isEmpty ? call.callerId : call.callerName} (${call.callType})');
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
        appName: AppBrand.name,
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
    } catch (e) {
      _log('system call screen failed: $e');
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
    if (!_handled.add(call.callId)) {
      _log('accept ${call.callId}: already handled, ignored');
      return;
    }
    if (_sessionReady) {
      _log('accept ${call.callId}: session ready, answering now');
      _acceptNow(call);
    } else {
      _log('accept ${call.callId}: session not ready yet, kept until sign-in is done');
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

  /// Joins a call the user answered on the system call screen. If the answer
  /// is dropped for ANY reason (the server refuses it because the call already
  /// ended, the person may no longer join, or the server cannot be reached) the
  /// user sees "This call has ended" instead of silently landing on the home
  /// screen.
  static Future<void> _acceptNow(IncomingCall call) async {
    try {
      await CallService().updateStatus(call.callId, 'ONGOING');
      _log('answer ${call.callId}: server accepted (ONGOING), opening the call screen');
    } on ApiException catch (e) {
      _log('answer ${call.callId}: server refused: HTTP ${e.statusCode} ${e.message}');
      await _endSystemCall(call.callId);
      _showEnded(networkProblem: e.statusCode == null || e.statusCode == 0);
      return;
    } catch (e) {
      _log('answer ${call.callId}: failed: $e');
      await _endSystemCall(call.callId);
      _showEnded(networkProblem: true);
      return;
    }
    // Our own call screen (Agora) takes over; remove the system call UI.
    await _endSystemCall(call.callId);
    final pushed = AppRoutes.pushGlobal(CallScreen(
      callId: call.callId,
      appId: call.appId,
      channelName: call.channelName,
      token: call.token,
      video: call.isVideo,
      peerName: _nameOf(call),
      isCaller: false,
    ));
    if (pushed == null) {
      // No navigator yet: the answer cannot be shown, so say so instead of showing home.
      _log('answer ${call.callId}: no navigator available');
      _showEnded(networkProblem: false);
    }
  }

  /// Full-screen "This call has ended" over whatever is open (normally the home screen).
  static void _showEnded({required bool networkProblem}) {
    if (_endedShown) return;
    _endedShown = true;
    final shown = AppRoutes.pushGlobal(CallEndedScreen(networkProblem: networkProblem));
    if (shown == null) {
      _endedShown = false;
      AppRoutes.messengerKey.currentState?.showSnackBar(SnackBar(content: Text(S.t('callEndedTitle'))));
      return;
    }
    shown.whenComplete(() => _endedShown = false);
  }

  // ---------------------------------------------------------------- session

  /// The home screen is open and the user is signed in.
  static void onSessionReady() {
    _sessionReady = true;
    final pending = _pendingAccept;
    _pendingAccept = null;
    _log('session ready, pending answer: ${pending?.callId ?? 'none'}');
    if (pending != null) {
      _acceptNow(pending);
    } else {
      // The Answer event can arrive before the app is listening: look at the system call list.
      _recoverAnsweredWhileClosed().then((_) => _surfaceRingingCalls());
    }
  }

  static void onSignedOut() {
    _sessionReady = false;
    final dropped = _pendingAccept;
    _pendingAccept = null;
    FlutterCallkitIncoming.endAllCalls();
    if (dropped != null) {
      // The user answered, but the sign-in did not complete (expired session): say so after
      // the login screen is up, instead of leaving the answer unexplained.
      _log('signed out with an unanswered pending call ${dropped.callId}');
      Future.delayed(const Duration(milliseconds: 500), () => _showEnded(networkProblem: false));
    }
  }

  /// The app was opened (for example from the notification) while a call is still ringing on the
  /// system call list and nobody answered yet: show the in-app ringing screen, so the user lands
  /// on the call and not on the home screen.
  static Future<void> _surfaceRingingCalls() async {
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      for (final params in calls) {
        if (params.isAccepted == true) continue;
        final call = _callFromParams(params);
        if (call == null || _handled.contains(call.callId)) continue;
        if (CallScreen.active || IncomingCallScreen.ringingCallId != null) continue;
        _log('call ${call.callId} still ringing after start-up: showing the in-app call screen');
        await _endSystemCall(call.callId); // stop the second ringtone / notification
        AppRoutes.pushGlobal(IncomingCallScreen(call: call));
      }
    } catch (e) {
      _log('could not read the system call list: $e');
    }
  }

  /// App returned to the foreground: finish an answer that was made on the
  /// system screen while the app was not running.
  static Future<void> onResume() => _recoverAnsweredWhileClosed();

  static Future<void> _recoverAnsweredWhileClosed() async {
    try {
      final calls = await FlutterCallkitIncoming.activeCalls();
      _log('system call list: ${calls.length} active');
      for (final params in calls) {
        if (params.isAccepted == true) {
          final call = _callFromParams(params);
          if (call != null) _onAccept(call);
        }
      }
    } catch (e) {
      _log('could not read the system call list: $e');
    }
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