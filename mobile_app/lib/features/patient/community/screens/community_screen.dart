import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/utils/media.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/services/auth_state.dart';
import '../models/post.dart';
import '../services/community_service.dart';
import 'video_player_screen.dart';

/// Community feed: stories, likes, comments, polls and photos. Posts by regular
/// users are reviewed by a moderator before they appear in the feed.
class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  final _service = CommunityService();
  List<Post>? _posts;
  final List<_Submission> _submitted = []; // this session's posts that are not in the feed (yet)
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final list = await _service.feed();
      if (!mounted) return;
      setState(() { _posts = list; _loading = false; _failed = false; });
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; _failed = _posts == null; });
    }
  }

  void _toast(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  void _replace(Post p) {
    final list = _posts;
    if (list == null) return;
    setState(() => _posts = [for (final x in list) x.id == p.id ? p : x]);
  }

  Future<void> _like(Post p) async {
    final optimistic = p.copyWith(likedByMe: !p.likedByMe, likes: p.likes + (p.likedByMe ? -1 : 1));
    _replace(optimistic);
    try {
      final liked = await _service.toggleLike(p.id);
      if (liked != optimistic.likedByMe) {
        _replace(p.copyWith(likedByMe: liked, likes: p.likes + (liked ? 1 : 0) - (p.likedByMe ? 1 : 0)));
      }
    } on ApiException {
      _replace(p);
      _toast(S.t('couldNotUpdate'));
    }
  }

  Future<void> _vote(Post p, PollOption o) async {
    if (p.myVoteOptionId != null) return;
    _replace(p.copyWith(
      myVoteOptionId: o.id,
      pollOptions: [for (final x in p.pollOptions) x.id == o.id ? PollOption(id: x.id, text: x.text, votes: x.votes + 1, votedByMe: true) : x],
    ));
    try {
      await _service.vote(o.id);
    } on ApiException catch (e) {
      _toast(e.message);
      _load(silent: true);
    }
  }

  void _comments(Post p) async {
    final added = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => _CommentsSheet(post: p, service: _service),
    );
    if (added != null && added > 0) _replace(p.copyWith(comments: p.comments + added));
  }

  Future<void> _compose() async {
    final r = await showModalBottomSheet<_ComposeResult>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => _ComposeSheet(service: _service),
    );
    if (r == null || !mounted) return;
    _toast(r.message.isNotEmpty ? r.message : (r.status == 'APPROVED' ? S.t('postPublished') : S.t('postPending')));
    if (r.status != 'APPROVED' || r.visibility == 'PRIVATE') {
      setState(() => _submitted.insert(0, _Submission(r.content, r.visibility, r.status)));
    }
    _load(silent: true);
  }

  String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    if (d.inMinutes < 1) return S.t('justNow');
    if (d.inHours < 1) return '${d.inMinutes}m';
    if (d.inDays < 1) return '${d.inHours}h';
    if (d.inDays < 7) return '${d.inDays}d';
    return Ist.dateLabel(Ist.dayOf(t));
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final posts = _posts;
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(silent: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
            children: [
              Text(S.t('community'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
              const SizedBox(height: 2),
              Text(S.t('communitySub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
              const SizedBox(height: 14),
              PrimaryButton(label: S.t('shareStory'), onPressed: _compose),
              const SizedBox(height: 8),
              for (final m in _submitted) _submissionCard(m),
              if (_loading && posts == null)
                const LoadingView()
              else if (_failed || posts == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else if (posts.isEmpty && _submitted.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 36),
                  child: Text(S.t('noPostsYet'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.4)),
                )
              else
                for (final p in posts) _postCard(p),
            ],
          ),
        );
      },
    );
  }

  /// A post the user just made that is awaiting moderation (or private).
  Widget _submissionCard(_Submission m) {
    final isPrivate = m.visibility == 'PRIVATE';
    return SaathiCard(
      rose: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(isPrivate ? Icons.lock_outline : Icons.hourglass_top, size: 16, color: AppColors.roseText),
              const SizedBox(width: 6),
              Expanded(child: Text(isPrivate ? S.t('badgePrivate') : S.t('awaitingReview'), style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AppColors.roseText))),
            ],
          ),
          if (m.content.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(m.content, style: const TextStyle(fontSize: 14.5, height: 1.4)),
          ],
        ],
      ),
    );
  }

  Widget _postCard(Post p) {
    final mine = p.authorId == AuthState.userId;
    final name = mine ? S.t('you') : (p.authorName.isEmpty ? S.t('communityMember') : p.authorName);
    return SaathiCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              UserAvatar(url: mine ? AuthState.avatarUrl : p.authorAvatar, initial: name, radius: 18),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                    Text(_ago(p.createdAt), style: const TextStyle(fontSize: 12, color: AppColors.textFaint)),
                  ],
                ),
              ),
            ],
          ),
          if (p.content.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(p.content, style: const TextStyle(fontSize: 15, height: 1.45)),
          ],
          if (p.mediaUrls.isNotEmpty) ...[
            const SizedBox(height: 10),
            _media(p.mediaUrls),
          ],
          if (p.isPoll) ...[
            const SizedBox(height: 12),
            _poll(p),
          ],
          const SizedBox(height: 8),
          Row(
            children: [
              InkWell(
                onTap: () => _like(p),
                borderRadius: BorderRadius.circular(10),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                  child: Row(children: [
                    Icon(p.likedByMe ? Icons.favorite : Icons.favorite_border, size: 20, color: p.likedByMe ? AppColors.rose : AppColors.textSecondary),
                    const SizedBox(width: 5),
                    Text('${p.likes}', style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary)),
                  ]),
                ),
              ),
              const SizedBox(width: 10),
              InkWell(
                onTap: () => _comments(p),
                borderRadius: BorderRadius.circular(10),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
                  child: Row(children: [
                    const Icon(Icons.chat_bubble_outline, size: 19, color: AppColors.textSecondary),
                    const SizedBox(width: 5),
                    Text('${p.comments}', style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary)),
                  ]),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _media(List<String> urls) {
    Widget tile(String u) {
      if (isVideoUrl(u)) {
        return InkWell(
          onTap: () => AppRoutes.push(context, VideoPlayerScreen(url: u)),
          child: Container(
            color: AppColors.ink.withOpacity(0.85),
            alignment: Alignment.center,
            child: const Icon(Icons.play_circle_outline, color: Colors.white, size: 52),
          ),
        );
      }
      return Image.network(u, fit: BoxFit.cover, errorBuilder: (_, __, ___) => Container(color: AppColors.primaryLight, child: const Icon(Icons.broken_image_outlined, color: AppColors.textFaint)));
    }

    if (urls.length == 1) {
      return ClipRRect(borderRadius: BorderRadius.circular(12), child: AspectRatio(aspectRatio: 16 / 10, child: SizedBox.expand(child: tile(urls.first))));
    }
    return SizedBox(
      height: 150,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: urls.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (_, i) => ClipRRect(borderRadius: BorderRadius.circular(12), child: SizedBox(width: 190, child: tile(urls[i]))),
      ),
    );
  }

  Widget _poll(Post p) {
    final voted = p.myVoteOptionId != null;
    final total = p.totalVotes;
    return Column(
      children: [
        for (final o in p.pollOptions)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: InkWell(
              onTap: voted ? null : () => _vote(p, o),
              borderRadius: BorderRadius.circular(12),
              child: Stack(
                children: [
                  if (voted)
                    Positioned.fill(
                      child: FractionallySizedBox(
                        alignment: Alignment.centerLeft,
                        widthFactor: total == 0 ? 0 : (o.votes / total).clamp(0.0, 1.0),
                        child: Container(decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12))),
                      ),
                    ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: o.id == p.myVoteOptionId ? AppColors.primary : AppColors.ink.withOpacity(0.12), width: o.id == p.myVoteOptionId ? 1.8 : 1.2),
                    ),
                    child: Row(
                      children: [
                        Expanded(child: Text(o.text, style: const TextStyle(fontSize: 14.5))),
                        if (voted) Text('${total == 0 ? 0 : (o.votes * 100 / total).round()}%', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        Align(alignment: Alignment.centerLeft, child: Text(S.votesCount(total), style: const TextStyle(fontSize: 12, color: AppColors.textFaint))),
      ],
    );
  }
}

class _Submission {
  final String content;
  final String visibility;
  final String status;
  const _Submission(this.content, this.visibility, this.status);
}

class _ComposeResult {
  final String message;
  final String status;
  final String visibility;
  final String content;
  const _ComposeResult(this.message, this.status, this.visibility, this.content);
}

// ---------------------------------------------------------------- comments

class _CommentsSheet extends StatefulWidget {
  final Post post;
  final CommunityService service;
  const _CommentsSheet({required this.post, required this.service});

  @override
  State<_CommentsSheet> createState() => _CommentsSheetState();
}

class _CommentsSheetState extends State<_CommentsSheet> {
  final _input = TextEditingController();
  List<PostComment>? _items;
  bool _failed = false;
  bool _sending = false;
  int _added = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final c = await widget.service.comments(widget.post.id);
      if (mounted) setState(() { _items = c; _failed = false; });
    } on ApiException {
      if (mounted) setState(() => _failed = true);
    }
  }

  Future<void> _send() async {
    final t = _input.text.trim();
    if (t.isEmpty || _sending) return;
    setState(() => _sending = true);
    try {
      await widget.service.addComment(widget.post.id, t);
      _input.clear();
      _added++;
      await _load();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_added);
      },
      child: Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.7,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 16, 8, 6),
                child: Row(children: [
                  Expanded(child: Text(S.t('comments'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17))),
                  IconButton(onPressed: () => Navigator.of(context).pop(_added), icon: const Icon(Icons.close)),
                ]),
              ),
              Expanded(
                child: _failed
                    ? ErrorView(message: S.t('loadFailed'), onRetry: _load)
                    : items == null
                        ? const LoadingView()
                        : items.isEmpty
                            ? Center(child: Text(S.t('noCommentsYet'), style: const TextStyle(color: AppColors.textSecondary)))
                            : ListView.builder(
                                padding: const EdgeInsets.symmetric(horizontal: 18),
                                itemCount: items.length,
                                itemBuilder: (_, i) {
                                  final c = items[i];
                                  return Padding(
                                    padding: const EdgeInsets.only(bottom: 14),
                                    child: Row(
                                      crossAxisAlignment: CrossAxisAlignment.start,
                                      children: [
                                        UserAvatar(url: c.authorAvatar, initial: c.authorName, radius: 16),
                                        const SizedBox(width: 10),
                                        Expanded(
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(c.authorName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 13.5)),
                                              const SizedBox(height: 2),
                                              Text(c.content, style: const TextStyle(fontSize: 14.5, height: 1.4)),
                                            ],
                                          ),
                                        ),
                                      ],
                                    ),
                                  );
                                },
                              ),
              ),
              Padding(
                padding: const EdgeInsets.fromLTRB(14, 6, 14, 12),
                child: Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: _input,
                        textCapitalization: TextCapitalization.sentences,
                        decoration: InputDecoration(
                          hintText: S.t('writeComment'),
                          filled: true,
                          fillColor: AppColors.bg,
                          contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: BorderSide.none),
                        ),
                        onSubmitted: (_) => _send(),
                      ),
                    ),
                    IconButton(
                      onPressed: _sending ? null : _send,
                      icon: _sending ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.send_rounded, color: AppColors.primary),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------- compose

class _ComposeSheet extends StatefulWidget {
  final CommunityService service;
  const _ComposeSheet({required this.service});

  @override
  State<_ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<_ComposeSheet> {
  final _text = TextEditingController();
  final List<PostMedia> _media = [];
  bool _hasVideo = false;
  bool _private = false;
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _addVideo() async {
    try {
      final f = await ImagePicker().pickVideo(source: ImageSource.gallery, maxDuration: const Duration(minutes: 3));
      if (f == null) return;
      final bytes = await f.readAsBytes();
      if (bytes.length > 50 * 1024 * 1024) {
        if (mounted) setState(() => _error = S.t('videoTooBig'));
        return;
      }
      if (!mounted) return;
      setState(() {
        _media
          ..clear()
          ..add(PostMedia(bytes, f.name)); // a video post carries exactly one video
        _hasVideo = true;
        _error = null;
      });
    } catch (_) {
      if (mounted) setState(() => _error = S.t('photoFailed'));
    }
  }

  Future<void> _addPhotos() async {
    if (_hasVideo) {
      setState(() {
        _media.clear();
        _hasVideo = false;
      });
    }
    try {
      final files = await ImagePicker().pickMultiImage(maxWidth: 1800, maxHeight: 1800, imageQuality: 85);
      for (final f in files) {
        if (_media.length >= 5) break;
        _media.add(PostMedia(await f.readAsBytes(), f.name));
      }
      if (mounted) setState(() {});
    } catch (_) {
      if (mounted) setState(() => _error = S.t('photoFailed'));
    }
  }

  Future<void> _post() async {
    final text = _text.text.trim();
    if (text.isEmpty && _media.isEmpty) {
      setState(() => _error = S.t('writeSomething'));
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final vis = _private ? 'PRIVATE' : 'PUBLIC';
      final r = await widget.service.createPost(content: text, visibility: vis, media: _media);
      if (mounted) Navigator.of(context).pop(_ComposeResult(r.message, r.status, vis, text));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 18, right: 18, top: 20, bottom: 18 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(S.t('shareStory'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 12),
            TextField(
              controller: _text,
              minLines: 4,
              maxLines: 8,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() => _error = null),
              decoration: InputDecoration(
                hintText: S.t('composeHint'),
                filled: true,
                fillColor: AppColors.bg,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
              ),
            ),
            if (_media.isNotEmpty && _hasVideo)
              Padding(
                padding: const EdgeInsets.only(top: 10),
                child: Row(children: [
                  const Icon(Icons.videocam_outlined, color: AppColors.primary),
                  const SizedBox(width: 8),
                  Expanded(child: Text(_media.first.filename, maxLines: 1, overflow: TextOverflow.ellipsis)),
                  IconButton(onPressed: () => setState(() { _media.clear(); _hasVideo = false; }), icon: const Icon(Icons.close)),
                ]),
              )
            else if (_media.isNotEmpty) ...[
              const SizedBox(height: 10),
              SizedBox(
                height: 76,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: _media.length,
                  separatorBuilder: (_, __) => const SizedBox(width: 8),
                  itemBuilder: (_, i) => Stack(
                    children: [
                      ClipRRect(borderRadius: BorderRadius.circular(10), child: Image.memory(Uint8List.fromList(_media[i].bytes), width: 76, height: 76, fit: BoxFit.cover)),
                      Positioned(
                        right: 2,
                        top: 2,
                        child: InkWell(
                          onTap: () => setState(() => _media.removeAt(i)),
                          child: const CircleAvatar(radius: 10, backgroundColor: Colors.black54, child: Icon(Icons.close, size: 13, color: Colors.white)),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: 8),
            Row(
              children: [
                TextButton.icon(onPressed: (!_hasVideo && _media.length >= 5) ? null : _addPhotos, icon: const Icon(Icons.photo_outlined), label: Text(S.t('addPhotos'))),
                TextButton.icon(onPressed: _addVideo, icon: const Icon(Icons.videocam_outlined), label: Text(S.t('addVideo'))),
                const Spacer(),
              ],
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _private,
              activeColor: AppColors.primary,
              onChanged: (v) => setState(() => _private = v),
              title: Text(S.t('onlyCounsellor'), style: const TextStyle(fontSize: 14.5)),
              subtitle: Text(_private ? S.t('privateNote') : S.t('reviewNote'), style: const TextStyle(fontSize: 12.5)),
            ),
            if (_error != null)
              Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning))),
            const SizedBox(height: 4),
            _sending
                ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                : PrimaryButton(label: S.t('postBtn'), onPressed: _post),
          ],
        ),
      ),
    );
  }
}
