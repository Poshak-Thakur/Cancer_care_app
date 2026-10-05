import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';

/// Result popped by the sheet.
class ComposeResult {
  final String content;
  final String visibility; // PUBLIC | PRIVATE
  const ComposeResult(this.content, this.visibility);
}

/// Write a post. Private entries show a safety disclaimer before submitting:
/// they are hidden from the community but visible to the assigned counsellor.
class ComposeSheet extends StatefulWidget {
  const ComposeSheet({super.key});

  @override
  State<ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<ComposeSheet> {
  final _controller = TextEditingController();
  String _visibility = 'PUBLIC';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final private = _visibility == 'PRIVATE';
        return Padding(
          padding: EdgeInsets.only(left: 20, right: 20, top: 22, bottom: 22 + MediaQuery.of(context).viewInsets.bottom),
          child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(S.t('composeTitle'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
                const SizedBox(height: 12),
                SegmentedButton<String>(
                  showSelectedIcon: false,
                  segments: [
                    ButtonSegment(value: 'PUBLIC', icon: const Icon(Icons.groups_outlined, size: 18), label: Text(S.t('visPublic'))),
                    ButtonSegment(value: 'PRIVATE', icon: const Icon(Icons.lock_outline, size: 18), label: Text(S.t('visPrivate'))),
                  ],
                  selected: {_visibility},
                  onSelectionChanged: (v) => setState(() => _visibility = v.first),
                ),
                const SizedBox(height: 8),
                Text(
                  private ? S.t('visPrivateSub') : S.t('visPublicSub'),
                  style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.4),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _controller,
                  minLines: 4,
                  maxLines: 6,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: private ? S.t('journalPlaceholder') : S.t('composePlaceholder'),
                    filled: true,
                    fillColor: AppColors.bg,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
                  ),
                ),
                if (private) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.shield_outlined, size: 18, color: AppColors.primaryDeep),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(S.t('privateDisclaimer'),
                              style: const TextStyle(fontSize: 13, color: AppColors.primaryDeep, height: 1.4, fontWeight: FontWeight.w500)),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                Opacity(
                  opacity: _controller.text.trim().isEmpty ? 0.5 : 1,
                  child: PrimaryButton(
                    label: S.t('post'),
                    onPressed: () {
                      final text = _controller.text.trim();
                      if (text.isEmpty) return;
                      Navigator.of(context).pop(ComposeResult(text, _visibility));
                    },
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
