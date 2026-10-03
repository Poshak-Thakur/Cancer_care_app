import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/section_label.dart';
import '../../appointments/widgets/appointment_card.dart';
import '../../medicines/widgets/medicine_list_card.dart';
import '../../nutrition/widgets/learn_card.dart';
import '../widgets/today_checklist_card.dart';

class CareScreen extends StatelessWidget {
  const CareScreen({super.key});

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
            const TodayChecklistCard(
              labelKeys: ['medication', 'checkin', 'appointment'],
              initialDone: [true, true, false],
            ),

            SectionLabel(S.t('medicines')),
            const MedicineListCard(),

            SectionLabel(S.t('appointments')),
            const AppointmentCard(),

            SectionLabel(S.t('learn')),
            const LearnCard(),
          ],
        );
      },
    );
  }
}
