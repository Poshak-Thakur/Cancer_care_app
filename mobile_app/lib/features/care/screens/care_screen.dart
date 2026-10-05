import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/check_row.dart';
import '../../../core/widgets/info_row.dart';
import '../../../core/widgets/saathi_card.dart';
import '../../../core/widgets/section_label.dart';

class CareScreen extends StatefulWidget {
  const CareScreen({super.key});

  @override
  State<CareScreen> createState() => _CareScreenState();
}

class _CareScreenState extends State<CareScreen> {
  final List<bool> _done = [true, true, false];
  final List<String> _labelKeys = ['medication', 'checkin', 'appointment'];

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
          children: [
            Text(S.t('yourCare'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(S.t('careSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),

            SectionLabel(S.t('today')),
            SaathiCard(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Column(
                children: List.generate(_done.length, (i) {
                  return CheckRow(
                    label: S.t(_labelKeys[i]),
                    done: _done[i],
                    onTap: () => setState(() => _done[i] = !_done[i]),
                  );
                }),
              ),
            ),

            SectionLabel(S.t('medicines')),
            SaathiCard(
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
            ),

            SectionLabel(S.t('appointments')),
            SaathiCard(
              child: InfoRow(icon: Icons.calendar_today_outlined, title: S.t('followUpVisit'), subtitle: S.t('followUpTime')),
            ),

            SectionLabel(S.t('learn')),
            SaathiCard(
              onTap: () {},
              child: InfoRow(
                icon: Icons.menu_book_outlined,
                title: S.t('eatingWell'),
                subtitle: S.t('reviewedByOrg'),
                trailing: const Text('→', style: TextStyle(fontSize: 16, color: AppColors.primary)),
              ),
            ),
          ],
        );
      },
    );
  }
}
