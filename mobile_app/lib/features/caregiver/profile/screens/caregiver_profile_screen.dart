import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/lang_toggle.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/screens/login_screen.dart';
import '../../../auth/services/auth_state.dart';
import '../../../patient/messages/models/care_contact.dart';
import '../../../shared/helpline/helpline_screen.dart';
import '../../patients/screens/accept_invite_screen.dart';
import '../../../shared/profile/edit_profile_screen.dart';

class CaregiverProfileScreen extends StatefulWidget {
  /// Called after a patient was linked (so the Patients tab reloads).
  final VoidCallback? onLinked;
  const CaregiverProfileScreen({super.key, this.onLinked});

  @override
  State<CaregiverProfileScreen> createState() => _CaregiverProfileScreenState();
}

class _CaregiverProfileScreenState extends State<CaregiverProfileScreen> {
  Future<void> _signOut() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(S.t('signOutTitle')),
        content: Text(S.t('signOutBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(S.t('cancel'))),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(S.t('signOut'))),
        ],
      ),
    );
    if (ok != true) return;
    await AuthState.signOut();
    ContactDirectory.clear();
    if (mounted) AppRoutes.pushAndClear(context, const LoginScreen());
  }

  Future<void> _linkPatient() async {
    final linked = await AppRoutes.push<bool>(context, const AcceptInviteScreen());
    if (linked == true) {
      if (mounted) setState(() {});
      widget.onLinked?.call();
    }
  }

  Future<void> _edit() async {
    await AppRoutes.push(context, const EditProfileScreen());
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final type = AuthState.caregiverType == 'VOLUNTEER' ? S.t('cgVolunteer') : S.t('cgFamily');
        return ListView(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
          children: [
            Row(
              children: [
                Expanded(child: Text(S.t('profile'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold))),
                const LangToggle(),
              ],
            ),
            const SizedBox(height: 16),
            SaathiCard(
              onTap: _edit,
              child: Row(
                children: [
                  UserAvatar(url: AuthState.avatarUrl, initial: AuthState.initial, radius: 28, teal: true),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(AuthState.fullName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
                        Text(type, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                        Text(AuthState.ngoRecognized ? S.t('recognizedBadge') : S.t('awaitingRecognition'),
                            style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: AuthState.ngoRecognized ? AppColors.positive : AppColors.warning)),
                        Text(AuthState.email, style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint)),
                      ],
                    ),
                  ),
                  const Icon(Icons.edit_outlined, color: AppColors.primary, size: 20),
                ],
              ),
            ),
            SaathiCard(
              onTap: _linkPatient,
              child: InfoRow(
                icon: Icons.link,
                title: S.t('linkPatientRecord'),
                subtitle: S.t('linkPatientRecordSub'),
                trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
              ),
            ),
            SaathiCard(
              rose: true,
              onTap: () => AppRoutes.push(context, const HelplineScreen()),
              child: InfoRow(icon: Icons.support_agent, rose: true, title: S.t('ngoHelpline'), subtitle: S.t('helplineSub'), trailing: const Icon(Icons.chevron_right, color: AppColors.roseText)),
            ),
            const SizedBox(height: 10),
            SecondaryButton(label: S.t('signOut'), onPressed: _signOut),
          ],
        );
      },
    );
  }
}
