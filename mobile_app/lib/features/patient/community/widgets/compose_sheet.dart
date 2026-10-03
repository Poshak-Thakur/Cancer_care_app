import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';

class ComposeSheet extends StatefulWidget {
  const ComposeSheet({super.key});

  @override
  State<ComposeSheet> createState() => _ComposeSheetState();
}

class _ComposeSheetState extends State<ComposeSheet> {
  String? _type;
  final _controller = TextEditingController();

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
        return Padding(
          padding: EdgeInsets.only(
            left: 20,
            right: 20,
            top: 22,
            bottom: 22 + MediaQuery.of(context).viewInsets.bottom,
          ),
          child: _type == null ? _choiceStep() : _composeStep(),
        );
      },
    );
  }

  Widget _choiceStep() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(S.t('composeTitle'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
        const SizedBox(height: 4),
        Text(S.t('composeSub'), style: const TextStyle(fontSize: 14, color: AppColors.textSecondary, height: 1.4)),
        const SizedBox(height: 16),
        _choiceBtn(S.t('ownStory'), S.t('ownStorySub'), () => setState(() => _type = 'story')),
        _choiceBtn(S.t('suggestion'), S.t('suggestionSub'), () => setState(() => _type = 'suggestion')),
      ],
    );
  }

  Widget _choiceBtn(String title, String sub, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        width: double.infinity,
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.bg,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.ink.withOpacity(0.08), width: 1.5),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14.5)),
            const SizedBox(height: 2),
            Text(sub, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }

  Widget _composeStep() {
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(_type == 'story' ? S.t('ownStory') : S.t('suggestion'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
        const SizedBox(height: 12),
        TextField(
          controller: _controller,
          minLines: 4,
          maxLines: 6,
          decoration: InputDecoration(
            hintText: S.t('composePlaceholder'),
            filled: true,
            fillColor: AppColors.bg,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
          ),
        ),
        const SizedBox(height: 14),
        PrimaryButton(
          label: S.t('post'),
          onPressed: () {
            final text = _controller.text.trim();
            if (text.isEmpty) {
              Navigator.of(context).pop();
              return;
            }
            Navigator.of(context).pop({'type': _type!, 'text': text});
          },
        ),
      ],
    );
  }
}
