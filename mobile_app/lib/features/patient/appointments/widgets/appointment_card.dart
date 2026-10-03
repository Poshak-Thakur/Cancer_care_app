import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';

class AppointmentCard extends StatelessWidget {
  const AppointmentCard({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return SaathiCard(
          child: InfoRow(
            icon: Icons.calendar_today_outlined,
            title: S.t('followUpVisit'),
            subtitle: S.t('followUpTime'),
          ),
        );
      },
    );
  }
}
