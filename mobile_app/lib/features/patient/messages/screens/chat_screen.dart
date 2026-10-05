import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../auth/services/auth_state.dart';
import '../../../shared/calls/call_launcher.dart';
import '../models/care_contact.dart';
import '../models/chat_message.dart';
import '../services/chat_service.dart';
import '../services/media_upload_service.dart';
import '../widgets/audio_bubble.dart';

/// One conversation. The backend has no push for chat yet, so new messages
/// are fetched every few seconds while the screen is open.
class ChatScreen extends StatefulWidget {
  final ChatThread thread;
  final CareContact peer;
  const ChatScreen({super.key, required this.thread, required this.peer});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _chat = ChatService();
  final _controller = TextEditingController();
  final _scroll = ScrollController();
  final _recorder = AudioRecorder();

  List<ChatMessage> _messages = [];
  bool _loading = true;
  bool _failed = false;
  bool _sending = false;
  Timer? _poll;

  bool _recording = false;
  DateTime? _recStart;
  Timer? _recTick;
  String _recElapsed = '0:00';

  @override
  void initState() {
    super.initState();
    _load();
    _poll = Timer.periodic(const Duration(seconds: 5), (_) => _load(silent: true));
  }

  @override
  void dispose() {
    _poll?.cancel();
    _recTick?.cancel();
    _recorder.dispose();
    _controller.dispose();
    _scroll.dispose();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final list = await _chat.messages(widget.thread.id);
      if (!mounted) return;
      final changed = list.length != _messages.length || (list.isNotEmpty && _messages.isNotEmpty && list.last.id != _messages.last.id);
      setState(() { _messages = list; _loading = false; _failed = false; });
      if (changed) _scrollToEnd();
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; if (!silent && _messages.isEmpty) _failed = true; });
    }
  }

  void _scrollToEnd() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) _scroll.animateTo(_scroll.position.maxScrollExtent, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    });
  }

  void _toast(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
  }

  Future<void> _sendText() async {
    final text = _controller.text.trim();
    if (text.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      final m = await _chat.sendText(widget.thread.id, text);
      if (!mounted) return;
      _controller.clear();
      setState(() { _messages = [..._messages, m]; _sending = false; });
      _scrollToEnd();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      _toast(e.message);
    }
  }

  // ---- voice notes ----

  Future<void> _startRecording() async {
    if (!await _recorder.hasPermission()) {
      _toast(S.t('micDenied'));
      return;
    }
    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/vn_${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc), path: path);
    _recStart = DateTime.now();
    _recTick = Timer.periodic(const Duration(seconds: 1), (_) {
      final s = DateTime.now().difference(_recStart!).inSeconds;
      if (mounted) setState(() => _recElapsed = '${s ~/ 60}:${(s % 60).toString().padLeft(2, '0')}');
    });
    setState(() { _recording = true; _recElapsed = '0:00'; });
  }

  Future<void> _cancelRecording() async {
    _recTick?.cancel();
    final path = await _recorder.stop();
    if (path != null) {
      try { await File(path).delete(); } catch (_) {}
    }
    if (mounted) setState(() => _recording = false);
  }

  Future<void> _sendRecording() async {
    _recTick?.cancel();
    final path = await _recorder.stop();
    if (mounted) setState(() { _recording = false; _sending = true; });
    if (path == null) {
      if (mounted) setState(() => _sending = false);
      return;
    }
    try {
      final url = await MediaUploadService().uploadVoiceNote(File(path), conversationId: widget.thread.id);
      final m = await _chat.sendAudio(widget.thread.id, url);
      if (!mounted) return;
      setState(() { _messages = [..._messages, m]; _sending = false; });
      _scrollToEnd();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _sending = false);
      _toast(e.message);
    } finally {
      try { await File(path).delete(); } catch (_) {}
    }
  }

  String _time(DateTime t) {
    final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
    return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}';
  }

  @override
  Widget build(BuildContext context) {
    final pid = widget.thread.patientId;
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, value, child) {
        return Scaffold(
          backgroundColor: AppColors.bg,
          appBar: AppBar(
            title: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.peer.displayName, style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.bold)),
                Text(widget.peer.role, style: const TextStyle(fontSize: 12, color: AppColors.textSecondary)),
              ],
            ),
            actions: [
              IconButton(
                tooltip: S.t('audioCall'),
                icon: const Icon(Icons.call_outlined),
                onPressed: () => CallLauncher.start(context, receiverId: widget.peer.userId, patientId: pid, video: false, peerName: widget.peer.displayName),
              ),
              IconButton(
                tooltip: S.t('videoCall'),
                icon: const Icon(Icons.videocam_outlined),
                onPressed: () => CallLauncher.start(context, receiverId: widget.peer.userId, patientId: pid, video: true, peerName: widget.peer.displayName),
              ),
            ],
          ),
          body: SafeArea(
            child: Column(
              children: [
                Expanded(child: _list()),
                _inputBar(),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _list() {
    if (_loading && _messages.isEmpty) return const LoadingView();
    if (_failed) return Center(child: ErrorView(message: S.t('loadFailed'), onRetry: _load));
    if (_messages.isEmpty) {
      return Center(child: Text(S.t('noMessagesYet'), style: const TextStyle(color: AppColors.textSecondary, fontSize: 15)));
    }
    return ListView.builder(
      controller: _scroll,
      padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
      itemCount: _messages.length,
      itemBuilder: (_, i) => _bubble(_messages[i]),
    );
  }

  Widget _bubble(ChatMessage m) {
    final mine = m.senderId == AuthState.userId;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: mine ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.only(
            topLeft: const Radius.circular(16),
            topRight: const Radius.circular(16),
            bottomLeft: Radius.circular(mine ? 16 : 4),
            bottomRight: Radius.circular(mine ? 4 : 16),
          ),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            if (m.isAudio)
              AudioBubble(mediaUrl: m.mediaUrl!, isMe: mine)
            else
              Text(m.content ?? '', style: TextStyle(fontSize: 15, height: 1.35, color: mine ? Colors.white : AppColors.ink)),
            const SizedBox(height: 3),
            Text(_time(m.createdAt), style: TextStyle(fontSize: 11, color: mine ? Colors.white70 : AppColors.textFaint)),
          ],
        ),
      ),
    );
  }

  Widget _inputBar() {
    if (_recording) {
      return Container(
        color: AppColors.surface,
        padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
        child: Row(
          children: [
            IconButton(tooltip: S.t('cancel'), icon: const Icon(Icons.delete_outline), color: AppColors.warning, onPressed: _cancelRecording),
            const Icon(Icons.fiber_manual_record, color: Colors.red, size: 14),
            const SizedBox(width: 8),
            Expanded(child: Text('${S.t('recording')} $_recElapsed', style: const TextStyle(fontSize: 15))),
            IconButton.filled(
              tooltip: S.t('send'),
              style: IconButton.styleFrom(backgroundColor: AppColors.primary),
              icon: const Icon(Icons.send),
              onPressed: _sendRecording,
            ),
          ],
        ),
      );
    }
    return Container(
      color: AppColors.surface,
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 8),
      child: Row(
        children: [
          Expanded(
            child: TextField(
              controller: _controller,
              minLines: 1,
              maxLines: 4,
              textCapitalization: TextCapitalization.sentences,
              onSubmitted: (_) => _sendText(),
              decoration: InputDecoration(
                hintText: S.t('typeMessage'),
                filled: true,
                fillColor: AppColors.bg,
                contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: BorderSide.none),
              ),
            ),
          ),
          // We use a GestureDetector here to allow "hold to record" functionality
          GestureDetector(
            onLongPress: _sending ? null : _startRecording,
            onLongPressUp: _sending ? null : _sendRecording,
            child: IconButton(
              tooltip: S.t('voiceNote'),
              icon: const Icon(Icons.mic_none),
              color: AppColors.primary,
              onPressed: () {}, // Handled by LongPress
            ),
          ),
          _sending
              ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primary)))
              : IconButton.filled(
                  tooltip: S.t('send'),
                  style: IconButton.styleFrom(backgroundColor: AppColors.primary),
                  icon: const Icon(Icons.send),
                  onPressed: _sendText,
                ),
        ],
      ),
    );
  }
}