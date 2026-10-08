import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';

/// Full-screen playback of a community video (network URL).
class VideoPlayerScreen extends StatefulWidget {
  final String url;
  const VideoPlayerScreen({super.key, required this.url});

  @override
  State<VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<VideoPlayerScreen> {
  late final VideoPlayerController _c = VideoPlayerController.networkUrl(Uri.parse(widget.url));
  bool _ready = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _c.initialize().then((_) {
      if (!mounted) return;
      setState(() => _ready = true);
      _c.play();
    }).catchError((_) {
      if (mounted) setState(() => _failed = true);
    });
    _c.addListener(() {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, elevation: 0),
      body: Center(
        child: _failed
            ? Text(S.t('loadFailed'), style: const TextStyle(color: Colors.white70))
            : !_ready
                ? const CircularProgressIndicator(color: AppColors.primaryLight)
                : Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      AspectRatio(aspectRatio: _c.value.aspectRatio, child: VideoPlayer(_c)),
                      VideoProgressIndicator(_c, allowScrubbing: true, colors: const VideoProgressColors(playedColor: AppColors.primary)),
                      IconButton(
                        iconSize: 44,
                        color: Colors.white,
                        icon: Icon(_c.value.isPlaying ? Icons.pause_circle_outline : Icons.play_circle_outline),
                        onPressed: () => _c.value.isPlaying ? _c.pause() : _c.play(),
                      ),
                    ],
                  ),
      ),
    );
  }
}
