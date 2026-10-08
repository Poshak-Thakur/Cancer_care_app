import 'package:flutter/material.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../dashboard/models/care_event.dart';
import '../../dashboard/widgets/care_event_labels.dart';

/// The day's medication doses (events of type MEDICATION_DOSE).
class MedicineListCard extends StatelessWidget {
  final List<CareEvent> events;
  const MedicineListCard({super.key, required this.events});

  @override
  Widget build(BuildContext context) {
    final meds = events.where((e) => e.isMedication).toList();
    if (meds.isEmpty) {
      return SaathiCard(
        child: Text(S.t('noneToday'), style: const TextStyle(fontSize: 14.5, color: AppColors.textSecondary)),
      );
    }
    return SaathiCard(
      child: Column(
        children: [
          for (var i = 0; i < meds.length; i++) ...[
            if (i > 0) const SizedBox(height: 14),
            InfoRow(
              icon: Icons.medication_outlined,
              title: careEventTitle(meds[i]),
              subtitle: careEventTime(meds[i]),
              trailing: Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: meds[i].isCompleted ? AppColors.positive : AppColors.ink.withOpacity(0.15),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}
