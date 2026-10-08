import 'package:flutter/material.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import 'screens/call_screen.dart';
import 'screens/incoming_call_screen.dart';
import 'services/call_service.dart';

/// Starts an outgoing call: POST /api/calls/initiate (the backend rings the
/// receiver over the socket and with a push notification), then opens the call
/// screen. Works the same for every role (patient, caregiver, staff).
class CallLauncher {
  static bool _starting = false;

  static Future<void> start(
    BuildContext context, {
    required String receiverId,
    String? patientId, // null only for the NGO helpline
    required bool video,
    required String peerName,
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    if (_starting) return;
    if (CallScreen.active || IncomingCallScreen.ringingCallId != null) {
      messenger.showSnackBar(SnackBar(content: Text(S.t('callBusy'))));
      return;
    }
    _starting = true;
    try {
      final out = await CallService().initiate(
        receiverId: receiverId,
        patientId: patientId,
        callType: video ? 'VIDEO' : 'AUDIO',
      );
      if (!context.mounted) return;
      AppRoutes.push(
        context,
        CallScreen(
          callId: out.callId,
          appId: out.appId,
          channelName: out.channelName,
          token: out.token,
          video: video,
          peerName: peerName,
          isCaller: true,
        ),
      );
    } on ApiException catch (e) {
      // Shows the server's own reason (for example "Unauthorized calling participant combination.").
      messenger.showSnackBar(SnackBar(content: Text(e.message.isEmpty ? S.t('callFailed') : e.message)));
    } catch (_) {
      messenger.showSnackBar(SnackBar(content: Text(S.t('callFailed'))));
    } finally {
      _starting = false;
    }
  }
}
