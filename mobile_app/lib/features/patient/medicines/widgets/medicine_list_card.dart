import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';

class MedicineListCard extends StatelessWidget {
  const MedicineListCard({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return SaathiCard(
          child: Column(
            children: [
              InfoRow(
                icon: Icons.medication_outlined,
                title: 'Tamoxifen — 10mg',
                subtitle: S.t('takenAt8'),
                trailing: Container(width: 8, height: 8, decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.positive)),
              ),
              const SizedBox(height: 14),
              InfoRow(
                icon: Icons.medication_outlined,
                title: 'Ondansetron — 4mg',
                subtitle: S.t('dueAt9'),
                trailing: Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: AppColors.ink.withOpacity(0.15))),
              ),
            ],
          ),
        );
      },
    );
  }
}
