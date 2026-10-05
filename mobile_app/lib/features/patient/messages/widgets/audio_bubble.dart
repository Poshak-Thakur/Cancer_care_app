import 'package:flutter/material.dart';
import 'package:audioplayers/audioplayers.dart';

class AudioBubble extends StatefulWidget {
  final String mediaUrl;
  final bool isMe;
  
  const AudioBubble({required this.mediaUrl, required this.isMe, super.key});

  @override
  State<AudioBubble> createState() => _AudioBubbleState();
}

class _AudioBubbleState extends State<AudioBubble> {
  final AudioPlayer _audioPlayer = AudioPlayer();
  bool _isPlaying = false;

  @override
  void initState() {
    super.initState();
    _audioPlayer.onPlayerStateChanged.listen((state) {
      if (mounted) {
        setState(() => _isPlaying = state == PlayerState.playing);
      }
    });
  }

  @override
  void dispose() {
    _audioPlayer.dispose();
    super.dispose();
  }

  void _togglePlay() async {
    if (_isPlaying) {
      await _audioPlayer.pause();
    } else {
      await _audioPlayer.play(UrlSource(widget.mediaUrl)); 
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12.0, vertical: 8.0),
      decoration: BoxDecoration(
        color: widget.isMe ? Colors.teal.shade100 : Colors.grey.shade200,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          IconButton(
            icon: Icon(_isPlaying ? Icons.pause_circle_filled : Icons.play_circle_fill),
            color: widget.isMe ? Colors.teal.shade800 : Colors.black87,
            iconSize: 32,
            onPressed: _togglePlay,
          ),
          const SizedBox(width: 4),
          Text(
            'Voice Note', 
            style: TextStyle(
              fontWeight: FontWeight.w500,
              color: widget.isMe ? Colors.teal.shade900 : Colors.black87,
            )
          ),
          const SizedBox(width: 16),
        ],
      ),
    );
  }
}