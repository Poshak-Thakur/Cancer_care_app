import 'package:flutter/material.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../dashboard/models/care_event.dart';
import '../../dashboard/widgets/care_event_labels.dart';

/// Today's appointments (events of type APPOINTMENT).
class AppointmentCard extends StatelessWidget {
  final List<CareEvent> events;
  const AppointmentCard({super.key, required this.events});

  @override
  Widget build(BuildContext context) {
    final appts = events.where((e) => e.isAppointment).toList();
    if (appts.isEmpty) {
      return SaathiCard(
        child: Text(S.t('noneToday'), style: const TextStyle(fontSize: 14.5, color: AppColors.textSecondary)),
      );
    }
    return SaathiCard(
      child: Column(
        children: [
          for (var i = 0; i < appts.length; i++) ...[
            if (i > 0) const SizedBox(height: 14),
            InfoRow(
              icon: Icons.calendar_today_outlined,
              title: careEventTitle(appts[i]),
              subtitle: careEventTime(appts[i]),
            ),
          ],
        ],
      ),
    );
  }
}
