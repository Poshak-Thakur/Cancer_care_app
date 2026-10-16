import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../services/auth_state.dart';
import 'login_screen.dart';
import '../../../core/theme/app_fonts.dart';

/// NGO staff work in the web dashboard, not in the mobile app.
class StaffNoticeScreen extends StatelessWidget {
  const StaffNoticeScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  const Icon(Icons.desktop_windows_outlined, size: 44, color: AppColors.primary),
                  const SizedBox(height: 16),
                  Text(S.t('staffTitle'), textAlign: TextAlign.center, style: const TextStyle(fontFamily: AppFonts.heading, fontSize: 20, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(S.t('staffBody'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.45)),
                  const SizedBox(height: 24),
                  SecondaryButton(
                    label: S.t('signOut'),
                    onPressed: () async {
                      await AuthState.signOut();
                      if (context.mounted) AppRoutes.pushAndClear(context, const LoginScreen());
                    },
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
