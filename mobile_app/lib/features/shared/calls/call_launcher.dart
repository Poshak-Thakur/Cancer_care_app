import 'package:flutter/material.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import 'screens/call_screen.dart';
import 'services/call_service.dart';

/// Starts an outgoing call: POST /api/calls/initiate (which also rings the
/// receiver over the socket), then opens the call screen.
class CallLauncher {
  static Future<void> start(
    BuildContext context, {
    required String receiverId,
    required String patientId,
    required bool video,
    required String peerName,
  }) async {
    final messenger = ScaffoldMessenger.of(context);
    if (CallScreen.active) return;
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
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
  }
}
