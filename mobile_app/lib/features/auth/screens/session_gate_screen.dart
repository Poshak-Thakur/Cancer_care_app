import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../patient/patient_shell.dart';
import '../services/auth_state.dart';
import 'login_screen.dart';
import 'onboarding_screen.dart';

/// Shown right after a successful OTP. Finds the user's patient record:
///   - has a patient  -> home (PatientShell)
///   - has none       -> onboarding (creates one)
///   - request failed -> "Try again" (never guess "new user" on an error)
class SessionGateScreen extends StatefulWidget {
  const SessionGateScreen({super.key});

  @override
  State<SessionGateScreen> createState() => _SessionGateScreenState();
}

class _SessionGateScreenState extends State<SessionGateScreen> {
  bool _failed = false;
  String _message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _failed = false);
    try {
      final result = await AuthState.loadPatient();
      if (!mounted) return;
      AppRoutes.pushAndClear(
        context,
        result == SessionResult.ready ? const PatientShell() : const OnboardingScreen(),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _failed = true;
        _message = AuthState.describe(e, S.t('couldntLoadSub'));
      });
    }
  }

  void _signOut() {
    AuthState.signOut();
    AppRoutes.pushAndClear(context, const LoginScreen());
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          body: SafeArea(
            child: Center(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 28),
                child: _failed ? _error() : _loading(),
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _loading() => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 30,
            height: 30,
            child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary),
          ),
          const SizedBox(height: 16),
          Text(S.t('loadingAccount'),
              style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary)),
        ],
      );

  Widget _error() => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.cloud_off_outlined, size: 44, color: AppColors.textFaint),
          const SizedBox(height: 16),
          Text(S.t('couldntLoad'),
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: AppColors.ink)),
          const SizedBox(height: 8),
          Text(_message,
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 14.5, color: AppColors.textSecondary, height: 1.45)),
          const SizedBox(height: 24),
          PrimaryButton(label: S.t('tryAgain'), onPressed: _load),
          const SizedBox(height: 6),
          TextButton(
            onPressed: _signOut,
            child: Text(S.t('signOut'),
                style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
          ),
        ],
      );
}
