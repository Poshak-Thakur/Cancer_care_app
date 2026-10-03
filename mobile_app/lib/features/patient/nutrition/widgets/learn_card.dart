import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';

class LearnCard extends StatelessWidget {
  const LearnCard({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return SaathiCard(
          onTap: () {},
          child: InfoRow(
            icon: Icons.menu_book_outlined,
            title: S.t('eatingWell'),
            subtitle: S.t('reviewedByOrg'),
            trailing: const Text('→', style: TextStyle(fontSize: 16, color: AppColors.primary)),
          ),
        );
      },
    );
  }
}
