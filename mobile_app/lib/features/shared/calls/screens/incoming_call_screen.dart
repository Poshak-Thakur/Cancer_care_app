import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/realtime/socket_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../patient/messages/models/care_contact.dart';
import '../models/call_models.dart';
import '../services/call_service.dart';
import 'call_screen.dart';

/// Full-screen "ringing" UI, opened when the socket delivers `incomingCall`.
class IncomingCallScreen extends StatefulWidget {
  final IncomingCall call;
  const IncomingCallScreen({super.key, required this.call});

  /// Call id currently ringing, to ignore duplicate events.
  static String? ringingCallId;

  @override
  State<IncomingCallScreen> createState() => _IncomingCallScreenState();
}

class _IncomingCallScreenState extends State<IncomingCallScreen> {
  StreamSubscription? _sub;
  Timer? _giveUp;
  bool _busy = false;

  Timer? _buzz;

  String get _callerName => widget.call.callerName.isNotEmpty
      ? widget.call.callerName
      : (ContactDirectory.nameFor(widget.call.callerId) ?? S.t('careTeamMember'));

  @override
  void initState() {
    super.initState();
    IncomingCallScreen.ringingCallId = widget.call.callId;
    // The caller hung up before we answered.
    _sub = SocketService.instance.statusUpdates.listen((u) {
      if (u.callId == widget.call.callId && (u.status == 'COMPLETED' || u.status == 'MISSED')) {
        _close(note: S.t('callMissed'));
      }
    });
    _giveUp = Timer(const Duration(seconds: 60), () => _close(note: S.t('callMissed')));
    // Fallback ringing (the system call screen is used first): vibrate and beep.
    _buzz = Timer.periodic(const Duration(milliseconds: 1500), (_) {
      HapticFeedback.vibrate();
      SystemSound.play(SystemSoundType.alert);
    });
  }

  @override
  void dispose() {
    IncomingCallScreen.ringingCallId = null;
    _sub?.cancel();
    _giveUp?.cancel();
    _buzz?.cancel();
    super.dispose();
  }

  void _close({String? note}) {
    if (!mounted) return;
    if (note != null) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(note)));
    Navigator.of(context).pop();
  }

  Future<void> _accept() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await CallService().updateStatus(widget.call.callId, 'ONGOING');
    } on ApiException {
      _close(note: S.t('callEnded'));
      return;
    }
    if (!mounted) return;
    _giveUp?.cancel();
    Navigator.of(context).pushReplacement(MaterialPageRoute(
      builder: (_) => CallScreen(
        callId: widget.call.callId,
        appId: widget.call.appId,
        channelName: widget.call.channelName,
        token: widget.call.token,
        video: widget.call.isVideo,
        peerName: _callerName,
        isCaller: false,
      ),
    ));
  }

  Future<void> _decline() async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await CallService().updateStatus(widget.call.callId, 'REJECTED');
    } catch (_) {}
    _close();
  }

  @override
  Widget build(BuildContext context) {
    final name = _callerName;
    return PopScope(
      canPop: false,
      child: Scaffold(
        backgroundColor: AppColors.primaryDeep,
        body: SafeArea(
          child: Column(
            children: [
              const Spacer(flex: 2),
              CircleAvatar(
                radius: 52,
                backgroundColor: AppColors.primaryLight,
                child: Text(name.isEmpty ? '?' : name[0].toUpperCase(),
                    style: const TextStyle(fontSize: 40, fontWeight: FontWeight.bold, color: AppColors.primaryDeep)),
              ),
              const SizedBox(height: 18),
              Text(name, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
              const SizedBox(height: 6),
              Text(widget.call.isVideo ? S.t('incomingVideo') : S.t('incomingAudio'),
                  style: const TextStyle(color: Colors.white70, fontSize: 15)),
              const Spacer(flex: 3),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                children: [
                  _action(Icons.call_end, Colors.red, S.t('decline'), _decline),
                  _action(widget.call.isVideo ? Icons.videocam : Icons.call, Colors.green, S.t('accept'), _accept),
                ],
              ),
              const SizedBox(height: 48),
            ],
          ),
        ),
      ),
    );
  }

  Widget _action(IconData icon, Color color, String label, VoidCallback onTap) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        InkResponse(
          onTap: onTap,
          child: Container(
            width: 68,
            height: 68,
            decoration: BoxDecoration(shape: BoxShape.circle, color: color),
            child: Icon(icon, color: Colors.white, size: 30),
          ),
        ),
        const SizedBox(height: 8),
        Text(label, style: const TextStyle(color: Colors.white, fontSize: 14)),
      ],
    );
  }
}
