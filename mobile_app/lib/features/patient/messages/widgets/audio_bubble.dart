import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/material.dart';
import '../../../../core/localization/strings.dart';

/// Plays one voice note from its signed URL (valid for 3 days; the backend
/// deletes the file after that).
class AudioBubble extends StatefulWidget {
  final String mediaUrl;
  final bool isMe;

  const AudioBubble({required this.mediaUrl, required this.isMe, super.key});

  @override
  State<AudioBubble> createState() => _AudioBubbleState();
}

class _AudioBubbleState extends State<AudioBubble> {
  final AudioPlayer _player = AudioPlayer();
  final List<StreamSubscription> _subs = [];
  PlayerState _state = PlayerState.stopped;
  Duration _position = Duration.zero;
  Duration _total = Duration.zero;
  bool _loading = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _subs.add(_player.onPlayerStateChanged.listen((s) {
      if (mounted) setState(() => _state = s);
    }));
    _subs.add(_player.onPositionChanged.listen((p) {
      if (mounted) setState(() => _position = p);
    }));
    _subs.add(_player.onDurationChanged.listen((d) {
      if (mounted) setState(() => _total = d);
    }));
    _subs.add(_player.onPlayerComplete.listen((_) {
      if (mounted) setState(() => _position = Duration.zero);
    }));
  }

  @override
  void dispose() {
    for (final s in _subs) {
      s.cancel();
    }
    _player.dispose();
    super.dispose();
  }

  Future<void> _toggle() async {
    if (_loading) return;
    try {
      if (_state == PlayerState.playing) {
        await _player.pause();
      } else if (_state == PlayerState.paused) {
        await _player.resume();
      } else {
        setState(() {
          _loading = true;
          _failed = false;
        });
        await _player.play(UrlSource(widget.mediaUrl));
      }
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted && _loading) setState(() => _loading = false);
    }
  }

  String _fmt(Duration d) => '${d.inMinutes}:${(d.inSeconds % 60).toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final fg = widget.isMe ? Colors.white : Colors.black87;
    final playing = _state == PlayerState.playing;
    final progress = _total.inMilliseconds == 0 ? 0.0 : (_position.inMilliseconds / _total.inMilliseconds).clamp(0.0, 1.0);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        _loading
            ? const Padding(
                padding: EdgeInsets.all(8),
                child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2.5)),
              )
            : IconButton(
                icon: Icon(playing ? Icons.pause_circle_filled : Icons.play_circle_fill),
                color: fg,
                iconSize: 36,
                onPressed: _toggle,
              ),
        const SizedBox(width: 2),
        Flexible(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              SizedBox(
                width: 120,
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 3,
                  color: fg,
                  backgroundColor: fg.withOpacity(0.25),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                _failed
                    ? S.t('voiceUnavailable')
                    : (_total == Duration.zero ? S.t('voiceNote') : '${_fmt(_position)} / ${_fmt(_total)}'),
                style: TextStyle(fontSize: 12, color: fg),
              ),
            ],
          ),
        ),
        const SizedBox(width: 6),
      ],
    );
  }
}
