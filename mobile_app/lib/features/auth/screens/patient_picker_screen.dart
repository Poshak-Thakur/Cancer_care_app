import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/saathi_card.dart';
import '../../../core/widgets/user_avatar.dart';
import '../../patient/patient_shell.dart';
import '../../patient/profile/models/patient_link.dart';
import '../services/auth_state.dart';

/// Shown when one account can operate more than one patient (their own and/or
/// family members'). Every patient-specific request afterwards uses the chosen
/// patient's id, never the signed-in user's id.
class PatientPickerScreen extends StatelessWidget {
  final List<PatientLink> links;
  const PatientPickerScreen({super.key, required this.links});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('switchPatient'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: [
                Text(S.t('choosePatient'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(S.t('choosePatientSub'), style: const TextStyle(fontSize: 14.5, color: AppColors.textSecondary)),
                const SizedBox(height: 18),
                for (final l in links)
                  SaathiCard(
                    onTap: () {
                      AuthState.selectLink(l);
                      AppRoutes.pushAndClear(context, const PatientShell());
                    },
                    child: Row(
                      children: [
                        UserAvatar(initial: l.patient.fullName, radius: 22, teal: l.relationshipType == 'SELF'),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(l.patient.fullName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16)),
                              Text(
                                l.relationshipType == 'SELF' ? S.t('ownAccount') : (l.relationshipLabel.isEmpty ? S.t('managingFor') : l.relationshipLabel),
                                style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                              ),
                            ],
                          ),
                        ),
                        const Icon(Icons.chevron_right, color: AppColors.primary),
                      ],
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
