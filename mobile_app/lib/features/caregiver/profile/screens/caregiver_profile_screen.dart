import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/lang_toggle.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../auth/screens/login_screen.dart';
import '../../../auth/services/auth_state.dart';

class CaregiverProfileScreen extends StatelessWidget {
  const CaregiverProfileScreen({super.key});

  Future<void> _signOut(BuildContext context) async {
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
    if (context.mounted) AppRoutes.pushAndClear(context, const LoginScreen());
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
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
              child: Row(
                children: [
                  const Icon(Icons.mail_outline, color: AppColors.primary),
                  const SizedBox(width: 12),
                  Expanded(child: Text(AuthState.email, style: const TextStyle(fontSize: 15))),
                ],
              ),
            ),
            const SizedBox(height: 16),
            SecondaryButton(label: S.t('signOut'), onPressed: () => _signOut(context)),
          ],
        );
      },
    );
  }
}
