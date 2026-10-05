import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../caregiver/patients/screens/accept_invite_screen.dart';
import '../../caregiver/patients/services/caregiver_service.dart';
import '../widgets/role_card.dart';

/// New caregiver: pick FAMILY or VOLUNTEER (POST /api/caregivers/profile), then
/// enter the invite code the patient shared.
class CaregiverOnboardingScreen extends StatefulWidget {
  const CaregiverOnboardingScreen({super.key});

  @override
  State<CaregiverOnboardingScreen> createState() => _CaregiverOnboardingScreenState();
}

class _CaregiverOnboardingScreenState extends State<CaregiverOnboardingScreen> {
  String _type = 'FAMILY';
  bool _saving = false;
  String? _error;

  Future<void> _continue() async {
    if (_saving) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await CaregiverService().createProfile(_type);
      if (!mounted) return;
      setState(() => _saving = false);
      AppRoutes.push(context, const AcceptInviteScreen(onboarding: true));
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 18, 22, 28),
              children: [
                Text(S.t('cgWelcome'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Text(S.t('cgWelcomeSub'), style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 24),
                Row(
                  children: [
                    Expanded(
                      child: RoleCard(
                        icon: Icons.family_restroom,
                        title: S.t('cgFamily'),
                        subtitle: S.t('cgFamilySub'),
                        selected: _type == 'FAMILY',
                        onTap: () => setState(() => _type = 'FAMILY'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: RoleCard(
                        icon: Icons.volunteer_activism_outlined,
                        title: S.t('cgVolunteer'),
                        subtitle: S.t('cgVolunteerSub'),
                        selected: _type == 'VOLUNTEER',
                        onTap: () => setState(() => _type = 'VOLUNTEER'),
                      ),
                    ),
                  ],
                ),
                if (_type == 'VOLUNTEER')
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(S.t('cgVolunteerNote'), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.4)),
                  ),
                const SizedBox(height: 22),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning))),
                      ],
                    ),
                  ),
                _saving
                    ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                    : PrimaryButton(label: S.t('continueBtn'), onPressed: _continue),
              ],
            ),
          ),
        );
      },
    );
  }
}
