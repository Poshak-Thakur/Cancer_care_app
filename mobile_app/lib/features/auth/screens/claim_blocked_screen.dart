import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../services/auth_state.dart';
import 'login_screen.dart';

/// Final answer to a claim that cannot be retried from here: the record or the
/// account is already set up (409), or too many wrong codes were tried (429).
/// There is deliberately no "create my profile" button: a second record would
/// split the patient's data.
class ClaimBlockedScreen extends StatelessWidget {
  final String message;
  const ClaimBlockedScreen({super.key, required this.message});

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
                  const Icon(Icons.link_off, size: 44, color: AppColors.primary),
                  const SizedBox(height: 16),
                  Text(S.t('claimBlockedTitle'),
                      textAlign: TextAlign.center, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(message,
                      textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.45)),
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
