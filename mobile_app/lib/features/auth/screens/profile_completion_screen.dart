import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../shared/profile/edit_profile_screen.dart';

/// Shown once when the signed-in account has no name yet
/// (`is_profile_completed == false`) but is not a brand-new patient or
/// caregiver, for example a family member who manages a patient's account.
/// Saving goes through PATCH /api/auth/profile; "Later" skips to [next].
class ProfileCompletionScreen extends StatelessWidget {
  final Widget next;
  const ProfileCompletionScreen({super.key, required this.next});

  Future<void> _complete(BuildContext context) async {
    await AppRoutes.push(context, const EditProfileScreen());
    if (context.mounted) AppRoutes.pushAndClear(context, next);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          body: SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Spacer(),
                  const Icon(Icons.person_outline, size: 48, color: AppColors.primary),
                  const SizedBox(height: 16),
                  Text(S.t('completeProfile'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Text(S.t('completeProfileSub'), style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary, height: 1.45)),
                  const Spacer(),
                  PrimaryButton(label: S.t('completeProfile'), onPressed: () => _complete(context)),
                  const SizedBox(height: 8),
                  Center(child: TextButton(onPressed: () => AppRoutes.pushAndClear(context, next), child: Text(S.t('later')))),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
