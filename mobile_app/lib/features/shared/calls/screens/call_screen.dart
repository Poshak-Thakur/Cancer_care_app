import 'dart:async';
import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:flutter/material.dart';
import 'package:permission_handler/permission_handler.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/realtime/socket_service.dart';
import '../../../../core/theme/app_colors.dart';
import '../models/call_models.dart';
import '../services/call_service.dart';
import '../../../../core/theme/app_fonts.dart';

/// Live audio/video call over Agora. The backend supplies the channel name and
/// a signed token and the Agora App ID.
class CallScreen extends StatefulWidget {
  final String callId;
  final String appId;
  final String channelName;
  final String? token;
  final bool video;
  final String peerName;
  final bool isCaller;

  const CallScreen({
    super.key,
    required this.callId,
    required this.appId,
    required this.channelName,
    required this.token,
    required this.video,
    required this.peerName,
    required this.isCaller,
  });

  /// True while a call screen is open, so a second ring is ignored.
  static bool active = false;

  @override
  State<CallScreen> createState() => _CallScreenState();
}

class _CallScreenState extends State<CallScreen> {
  static const _ringTimeout = Duration(seconds: 45);

  /// After answering, how long to wait for the caller to be in the channel
  /// before concluding that they already hung up.
  static const _peerTimeout = Duration(seconds: 25);

  RtcEngine? _engine;
  StreamSubscription<CallStatusUpdate>? _statusSub;
  Timer? _ringTimer;
  Timer? _peerTimer;
  Timer? _clock;

  int? _remoteUid;
  bool _joined = false;
  bool _muted = false;
  bool _camOff = false;
  bool _ending = false;
  String? _error;
  int _seconds = 0;
  String? _endNote;

  @override
  void initState() {
    super.initState();
    CallScreen.active = true;
    _statusSub = SocketService.instance.statusUpdates.listen(_onStatus);
    _init();
  }

  void _onStatus(CallStatusUpdate update) {
    if (update.callId != widget.callId || _ending) return;
    if (update.status == 'REJECTED') {
      _finish(note: S.t('callDeclined'), notifyServer: false);
    } else if (update.status == 'COMPLETED' || update.status == 'MISSED') {
      _finish(note: S.t('callEnded'), notifyServer: false);
    }
  }

  Future<void> _init() async {
    if (widget.appId.isEmpty) {
      setState(() => _error = S.t('callFailed'));
      return;
    }
    final perms = <Permission>[Permission.microphone, if (widget.video) Permission.camera];
    final results = await perms.request();
    if (results.values.any((s) => !s.isGranted)) {
      if (mounted) setState(() => _error = S.t('callPermissionDenied'));
      return;
    }

    try {
      final engine = createAgoraRtcEngine();
      _engine = engine;
      await engine.initialize(RtcEngineContext(
        appId: widget.appId,
        channelProfile: ChannelProfileType.channelProfileCommunication,
      ));
      engine.registerEventHandler(RtcEngineEventHandler(
        onJoinChannelSuccess: (connection, elapsed) {
          if (mounted) setState(() => _joined = true);
        },
        onUserJoined: (connection, remoteUid, elapsed) {
          _ringTimer?.cancel();
          _peerTimer?.cancel();
          _startClock();
          if (mounted) setState(() => _remoteUid = remoteUid);
        },
        onUserOffline: (connection, remoteUid, reason) {
          _finish(note: S.t('callEnded'));
        },
        onError: (err, msg) {
          // While the other side is only ringing (the join was issued, the ring timer runs) an engine
          // warning must not turn into "couldn't connect": the ring timer decides below, by whether
          // this phone really joined the channel. Before that, a join error is a real failure.
          if (_ringTimer?.isActive == true || _peerTimer?.isActive == true) return;
          if (mounted && _remoteUid == null && !_joined) setState(() => _error = S.t('callFailed'));
        },
      ));

      if (widget.video) {
        await engine.enableVideo();
        await engine.startPreview();
      } else {
        await engine.enableAudio();
      }

      await engine.joinChannel(
        token: widget.token ?? '',
        channelId: widget.channelName,
        uid: 0,
        options: ChannelMediaOptions(
          clientRoleType: ClientRoleType.clientRoleBroadcaster,
          channelProfile: ChannelProfileType.channelProfileCommunication,
          publishMicrophoneTrack: true,
          publishCameraTrack: widget.video,
          autoSubscribeAudio: true,
          autoSubscribeVideo: widget.video,
        ),
      );

      if (widget.isCaller) {
        // Nobody picked up. "No answer" is only the right words if this phone really joined the
        // channel and waited; if it never got in, the call itself could not connect.
        _ringTimer = Timer(
          _ringTimeout,
          () => _finish(note: _joined ? S.t('callNoAnswer') : S.t('callFailed'), missed: true),
        );
      } else {
        // The receiver accepted before this screen opened; the clock starts when the caller is present.
        // If the caller is not there shortly after, they hung up first: end instead of waiting forever.
        _peerTimer = Timer(_peerTimeout, () {
          if (_remoteUid == null) _finish(note: S.t('callEnded'));
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = S.t('callFailed'));
    }
  }

  void _startClock() {
    _clock ??= Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _seconds++);
    });
  }

  Future<void> _finish({String? note, bool notifyServer = true, bool missed = false}) async {
    if (_ending) return;
    _ending = true;
    _ringTimer?.cancel();
    _peerTimer?.cancel();
    _clock?.cancel();
    if (notifyServer) {
      // Hanging up before anyone answered counts as missed.
      final status = (missed || (widget.isCaller && _remoteUid == null)) ? 'MISSED' : 'COMPLETED';
      try {
        await CallService().updateStatus(widget.callId, status);
      } catch (_) {}
    }
    try {
      await _engine?.leaveChannel();
      await _engine?.release();
    } catch (_) {}
    _engine = null;
    if (!mounted) return;
    if (note != null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(note)));
    }
    Navigator.of(context).pop();
  }

  @override
  void dispose() {
    CallScreen.active = false;
    _statusSub?.cancel();
    _ringTimer?.cancel();
    _peerTimer?.cancel();
    _clock?.cancel();
    final engine = _engine;
    if (engine != null) {
      // Screen closed without hanging up (e.g. system back): free the devices.
      engine.leaveChannel().then((_) => engine.release()).catchError((_) {});
    }
    super.dispose();
  }

  String get _clockText => '${_seconds ~/ 60}:${(_seconds % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _finish();
      },
      child: Scaffold(
        backgroundColor: AppColors.primaryDeep,
        body: SafeArea(
          child: _error != null ? _errorView() : _callView(),
        ),
      ),
    );
  }

  Widget _errorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.call_end, color: Colors.white, size: 40),
            const SizedBox(height: 14),
            Text(_error!, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16, height: 1.4)),
            const SizedBox(height: 22),
            FilledButton(
              style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: AppColors.primaryDeep),
              onPressed: () => _finish(),
              child: Text(S.t('close')),
            ),
          ],
        ),
      ),
    );
  }

  Widget _callView() {
    final engine = _engine;
    final inCall = _remoteUid != null;
    return Stack(
      children: [
        // Remote video (or a plain background for audio calls / while ringing)
        if (widget.video && inCall && engine != null)
          Positioned.fill(
            child: AgoraVideoView(
              controller: VideoViewController.remote(
                rtcEngine: engine,
                canvas: VideoCanvas(uid: _remoteUid),
                connection: RtcConnection(channelId: widget.channelName),
              ),
            ),
          ),
        // Self preview
        if (widget.video && _joined && !_camOff && engine != null)
          Positioned(
            top: 16,
            right: 16,
            width: 100,
            height: 140,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: AgoraVideoView(
                controller: VideoViewController(rtcEngine: engine, canvas: VideoCanvas(uid: 0)),
              ),
            ),
          ),
        // Name + status
        if (!(widget.video && inCall))
          Align(
            alignment: Alignment.center,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                CircleAvatar(
                  radius: 44,
                  backgroundColor: AppColors.primaryLight,
                  child: Text(widget.peerName.isEmpty ? '?' : widget.peerName[0].toUpperCase(),
                      style: const TextStyle(fontFamily: AppFonts.heading, fontSize: 34, fontWeight: FontWeight.bold, color: AppColors.primaryDeep)),
                ),
                const SizedBox(height: 16),
                Text(widget.peerName, style: const TextStyle(fontFamily: AppFonts.heading, color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Text(inCall ? _clockText : (widget.isCaller ? S.t('calling') : S.t('connecting')),
                    style: const TextStyle(color: Colors.white70, fontSize: 15)),
              ],
            ),
          ),
        if (widget.video && inCall)
          Positioned(
            top: 16,
            left: 16,
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(999)),
              child: Text('${widget.peerName} · $_clockText', style: const TextStyle(color: Colors.white, fontSize: 13)),
            ),
          ),
        // Controls
        Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: const EdgeInsets.only(bottom: 28),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                _roundButton(
                  icon: _muted ? Icons.mic_off : Icons.mic,
                  onTap: () async {
                    setState(() => _muted = !_muted);
                    await _engine?.muteLocalAudioStream(_muted);
                  },
                ),
                const SizedBox(width: 18),
                _roundButton(icon: Icons.call_end, color: AppColors.error, onTap: () => _finish()),
                if (widget.video) ...[
                  const SizedBox(width: 18),
                  _roundButton(
                    icon: _camOff ? Icons.videocam_off : Icons.videocam,
                    onTap: () async {
                      setState(() => _camOff = !_camOff);
                      await _engine?.muteLocalVideoStream(_camOff);
                    },
                  ),
                  const SizedBox(width: 18),
                  _roundButton(icon: Icons.cameraswitch, onTap: () => _engine?.switchCamera()),
                ],
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _roundButton({required IconData icon, required VoidCallback onTap, Color color = Colors.white24}) {
    return InkResponse(
      onTap: onTap,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(shape: BoxShape.circle, color: color),
        child: Icon(icon, color: Colors.white),
      ),
    );
  }
}
