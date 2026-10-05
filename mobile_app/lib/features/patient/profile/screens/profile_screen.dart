import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../auth/services/auth_state.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../auth/screens/login_screen.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import 'invite_caregiver_screen.dart';
import '../../../../core/widgets/section_label.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return ListView(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
          children: [
            Text(S.t('yourProfile'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(S.t('profileSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
            const SizedBox(height: 18),

            SaathiCard(
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 26,
                    backgroundColor: AppColors.roseLight,
                    child: Text(AuthState.initial, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: AppColors.roseText)),
                  ),
                  const SizedBox(width: 14),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(AuthState.fullName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
                      Text(_bornMeta(), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                    ],
                  ),
                ],
              ),
            ),

            SectionLabel(S.t('moreAboutYou')),
            SaathiCard(
              child: Column(
                children: [
                  _fieldRow(S.t('cancerType'), S.t('cancerWhy'), border: true),
                  _fieldRow(S.t('treatmentPlan'), S.t('treatmentWhy'), border: true),
                  _fieldRow(S.t('diagnosisDate'), S.t('diagnosisWhy'), border: false),
                  const SizedBox(height: 10),
                  Text(S.t('inviteNote'), style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint, height: 1.5)),
                ],
              ),
            ),

            SectionLabel(S.t('linkedCaregiver')),
            SaathiCard(
              onTap: () => AppRoutes.push(context, const InviteCaregiverScreen()),
              child: InfoRow(
                icon: Icons.person_add_alt_1_outlined,
                title: S.t('inviteCaregiver'),
                subtitle: S.t('inviteCaregiverSub'),
                trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
              ),
            ),
            const SizedBox(height: 6),
            SecondaryButton(label: S.t('signOut'), onPressed: () => _confirmSignOut(context)),
          ],
        );
      },
    );
  }

  String _bornMeta() {
    final hi = Lang.isHindi.value;
    final born = AuthState.bornDisplay;
    final lang = hi ? 'हिन्दी' : 'English';
    if (born.isEmpty) return lang;
    return '${hi ? 'जन्म' : 'Born'} $born · $lang';
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(S.t('signOutTitle'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        content: Text(S.t('signOutBody'), style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.textSecondary)),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(S.t('cancel'), style: const TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600)),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(S.t('signOut'), style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) {
      await AuthState.signOut();
      if (!context.mounted) return;
      AppRoutes.pushAndClear(context, const LoginScreen());
    }
  }

  Widget _fieldRow(String label, String why, {required bool border}) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 12),
      decoration: BoxDecoration(
        border: border ? Border(bottom: BorderSide(color: AppColors.ink.withOpacity(0.06))) : null,
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
                const SizedBox(height: 2),
                Text(why, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary, height: 1.4)),
              ],
            ),
          ),
          TextButton(onPressed: () {}, child: Text(S.t('add'), style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600))),
        ],
      ),
    );
  }
}
