import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/saathi_card.dart';
import '../models/post.dart';
import '../widgets/avatar_widget.dart';
import '../widgets/compose_sheet.dart';

class CommunityScreen extends StatefulWidget {
  const CommunityScreen({super.key});

  @override
  State<CommunityScreen> createState() => _CommunityScreenState();
}

class _CommunityScreenState extends State<CommunityScreen> {
  final List<Post> _posts = [
    Post(
      initial: 'R',
      name: 'Rekha M.',
      time: '2 hours ago',
      body:
          'Third cycle done today. The nausea was worse this time but my daughter sat with me through it. Small wins.',
      likes: 12,
    ),
    Post(
      initial: 'A',
      name: 'You',
      time: 'Yesterday',
      body:
          'Ginger tea before my morning dose has really helped with the nausea for me — sharing in case it helps someone else.',
      badgeKey: 'beingReviewed',
    ),
    Post(
      initial: 'S',
      name: 'Suresh P.',
      time: '2 days ago',
      body:
          'Small, frequent meals worked better for me than three big ones — easier to keep down on chemo days.',
      badgeKey: 'reviewedOn',
      likes: 28,
    ),
  ];

  void _showToast(String msg) {
    ScaffoldMessenger.of(context).clearSnackBars();

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          msg,
          textAlign: TextAlign.center,
        ),
        backgroundColor: AppColors.primaryDeep,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
        ),
        duration: const Duration(
          milliseconds: 2600,
        ),
      ),
    );
  }

  void _openCompose() async {
    final result = await showModalBottomSheet<Map<String, String>>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(22),
        ),
      ),
      isScrollControlled: true,
      builder: (_) => const ComposeSheet(),
    );

    if (result == null) return;

    setState(() {
      _posts.insert(
        0,
        Post(
          initial: 'A',
          name: S.t('you'),
          time: S.t('justNow'),
          body: result['text']!,
          badgeKey: result['type'] == 'suggestion'
              ? 'beingReviewed'
              : null,
        ),
      );
    });

    _showToast(
      result['type'] == 'suggestion'
          ? S.t('sharedReview')
          : S.t('sharedCommunity'),
    );
  }

  void _report(int index) {
    setState(() {
      _posts.removeAt(index);
    });

    _showToast(S.t('reportedToast'));
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(
            18,
            20,
            18,
            24,
          ),
          children: [
            Text(
              S.t('yourCommunity'),
              style: const TextStyle(
                fontSize: 21,
                fontWeight: FontWeight.bold,
              ),
            ),

            const SizedBox(height: 2),

            Text(
              S.t('communitySub'),
              style: const TextStyle(
                fontSize: 15,
                color: AppColors.textSecondary,
              ),
            ),

            const SizedBox(height: 18),

            SaathiCard(
              onTap: _openCompose,
              child: Row(
                children: [
                  const AvatarWidget('A'),

                  const SizedBox(width: 12),

                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 16,
                        vertical: 11,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.bg,
                        borderRadius: BorderRadius.circular(999),
                      ),
                      child: Text(
                        S.t('shareSomething'),
                        style: const TextStyle(
                          fontSize: 14.5,
                          color: AppColors.textFaint,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),

            for (int i = 0; i < _posts.length; i++)
              _postCard(i),
          ],
        );
      },
    );
  }

  Widget _postCard(int i) {
    final post = _posts[i];

    return SaathiCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              AvatarWidget(post.initial),

              const SizedBox(width: 10),

              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      post.name,
                      style: const TextStyle(
                        fontWeight: FontWeight.w600,
                        fontSize: 14.5,
                      ),
                    ),
                    Text(
                      post.time,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.textFaint,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),

          if (post.badgeKey != null) ...[
            const SizedBox(height: 10),

            Container(
              constraints: const BoxConstraints(
                maxWidth: double.infinity,
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 5,
              ),
              decoration: BoxDecoration(
                color: post.badgeKey == 'reviewedOn'
                    ? AppColors.sageLight
                    : AppColors.primaryLight,
                borderRadius: BorderRadius.circular(999),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(
                    post.badgeKey == 'reviewedOn'
                        ? Icons.check
                        : Icons.access_time,
                    size: 13,
                    color: post.badgeKey == 'reviewedOn'
                        ? AppColors.positive
                        : AppColors.primaryDeep,
                  ),

                  const SizedBox(width: 6),

                  Flexible(
                    child: Text(
                      S.t(post.badgeKey!),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: post.badgeKey == 'reviewedOn'
                            ? AppColors.positive
                            : AppColors.primaryDeep,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: 10),

          Text(
            post.body,
            style: const TextStyle(
              fontSize: 14.5,
              height: 1.45,
              color: AppColors.ink,
            ),
          ),

          if (post.likes != null) ...[
            const SizedBox(height: 10),

            Row(
              children: [
                const Icon(
                  Icons.favorite_border,
                  size: 16,
                  color: AppColors.textFaint,
                ),

                const SizedBox(width: 5),

                Text(
                  '${post.likes}',
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textFaint,
                  ),
                ),

                const SizedBox(width: 16),

                const Icon(
                  Icons.chat_bubble_outline,
                  size: 16,
                  color: AppColors.textFaint,
                ),

                const SizedBox(width: 5),

                Text(
                  S.t('reply'),
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textFaint,
                  ),
                ),

                const Spacer(),

                InkWell(
                  onTap: () => _report(i),
                  child: const Icon(
                    Icons.flag_outlined,
                    size: 16,
                    color: AppColors.textFaint,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}