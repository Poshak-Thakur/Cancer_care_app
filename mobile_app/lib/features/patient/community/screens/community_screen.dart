import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../auth/services/auth_state.dart';
import '../models/post.dart';
import '../services/community_service.dart';
import '../widgets/avatar_widget.dart';
import '../widgets/compose_sheet.dart';

/// The community feed: posts the NGO team has approved. New public posts are
/// reviewed first, so they appear here only after approval.
class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  final _service = CommunityService();
  List<CommunityPost>? _posts;

  /// Posts the user submitted during this session. The backend has no "my
  /// posts" endpoint, so this is the only place a pending or private entry shows.
  final List<CommunityPost> _mine = [];
  bool _loading = true;
  bool _failed = false;
  bool _posting = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final posts = await _service.feed();
      if (!mounted) return;
      setState(() { _posts = posts; _loading = false; _failed = false; });
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; _failed = _posts == null; });
    }
  }

  void _toast(String msg) {
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg, textAlign: TextAlign.center),
        backgroundColor: AppColors.primaryDeep,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        duration: const Duration(seconds: 5),
      ),
    );
  }

  Future<void> _openCompose() async {
    if (_posting) return;
    final result = await showModalBottomSheet<ComposeResult>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      isScrollControlled: true,
      builder: (_) => const ComposeSheet(),
    );
    if (result == null || !mounted) return;

    setState(() => _posting = true);
    try {
      final created = await _service.create(content: result.content, visibility: result.visibility);
      if (!mounted) return;
      setState(() {
        _posting = false;
        _mine.insert(0, created.post);
      });
      // The server's message already says whether the post is private or waiting for review.
      _toast(created.message ?? (result.visibility == 'PRIVATE' ? S.t('privateSaved') : S.t('sentForReview')));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _posting = false);
      _toast(e.message);
    }
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
              Text(S.t('yourCommunity'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
              const SizedBox(height: 2),
              Text(S.t('communitySub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
              const SizedBox(height: 18),
              SaathiCard(
                onTap: _openCompose,
                child: Row(
                  children: [
                    AvatarWidget(AuthState.initial),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                        decoration: BoxDecoration(color: AppColors.bg, borderRadius: BorderRadius.circular(999)),
                        child: Text(S.t('shareSomething'), style: const TextStyle(fontSize: 14.5, color: AppColors.textFaint)),
                      ),
                    ),
                    if (_posting)
                      const Padding(
                        padding: EdgeInsets.only(left: 10),
                        child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primary)),
                      ),
                  ],
                ),
              ),
              for (final p in _mine) _myPostCard(p),
              if (_loading && posts == null)
                const LoadingView()
              else if (_failed || posts == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else if (posts.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 30),
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

  String _ago(DateTime t) {
    final d = DateTime.now().difference(t);
    final hi = Lang.isHindi.value;
    if (d.inMinutes < 1) return S.t('justNow');
    if (d.inMinutes < 60) return hi ? '${d.inMinutes} मिनट पहले' : '${d.inMinutes} min ago';
    if (d.inHours < 24) return hi ? '${d.inHours} घंटे पहले' : '${d.inHours} h ago';
    return hi ? '${d.inDays} दिन पहले' : '${d.inDays} d ago';
  }

  Widget _postCard(CommunityPost post) {
    final mine = post.authorId == AuthState.userId;
    // The feed only carries an author id, so people appear anonymously.
    final name = mine ? S.t('you') : S.t('communityMember');
    return SaathiCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarWidget(mine ? AuthState.initial : name[0], tealVariant: mine),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(name, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                    Text(_ago(post.createdAt), style: const TextStyle(fontSize: 12, color: AppColors.textFaint)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(color: const Color(0xFFEEF1E8), borderRadius: BorderRadius.circular(999)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.check, size: 13, color: AppColors.positive),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(S.t('approvedBadge'),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: AppColors.positive)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(post.content, style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.ink)),
        ],
      ),
    );
  }

  /// A post the user just submitted: shown with its real state instead of as live.
  Widget _myPostCard(CommunityPost post) {
    final isPrivate = post.visibility == 'PRIVATE';
    final String badge;
    final IconData icon;
    final Color color;
    final Color bg;
    if (isPrivate) {
      badge = S.t('badgePrivate');
      icon = Icons.lock_outline;
      color = AppColors.primaryDeep;
      bg = AppColors.primaryLight;
    } else if (post.status == 'APPROVED') {
      badge = S.t('approvedBadge');
      icon = Icons.check;
      color = AppColors.positive;
      bg = const Color(0xFFEEF1E8);
    } else if (post.status == 'REJECTED') {
      badge = S.t('badgeRejected');
      icon = Icons.info_outline;
      color = AppColors.warning;
      bg = AppColors.roseLight;
    } else {
      badge = S.t('badgePending');
      icon = Icons.access_time;
      color = AppColors.primaryDeep;
      bg = AppColors.primaryLight;
    }
    return SaathiCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarWidget(AuthState.initial, tealVariant: true),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(S.t('you'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                    Text(_ago(post.createdAt), style: const TextStyle(fontSize: 12, color: AppColors.textFaint)),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
            decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 13, color: color),
                const SizedBox(width: 6),
                Flexible(
                  child: Text(badge,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: color)),
                ),
              ],
            ),
          ),
          const SizedBox(height: 10),
          Text(post.content, style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.ink)),
          if (post.moderatorFeedback != null && post.moderatorFeedback!.isNotEmpty) ...[
            const SizedBox(height: 8),
            Text(post.moderatorFeedback!, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.4)),
          ],
        ],
      ),
    );
  }
}
