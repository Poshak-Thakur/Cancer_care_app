import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/async_states.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../services/session_router.dart';
import 'login_screen.dart';

/// Shown right after the splash. If a refresh token is saved, signs the user
/// back in silently and opens the right home screen; otherwise shows login.
class SessionGateScreen extends StatefulWidget {
  const SessionGateScreen({super.key});

  @override
  State<SessionGateScreen> createState() => _SessionGateScreenState();
}

class _SessionGateScreenState extends State<SessionGateScreen> {
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _restore();
  }

  Future<void> _restore() async {
    if (_failed) setState(() => _failed = false);
    try {
      final result = await AuthApiService().restoreSession();
      if (!mounted) return;
      if (result == null) {
        AppRoutes.pushAndClear(context, const LoginScreen());
        return;
      }
      AuthState.applyLogin(result);
      await SessionRouter.go(context);
    } on ApiException {
      if (!mounted) return;
      setState(() => _failed = true);
    }
  }

  Future<void> _signInAgain() async {
    await TokenStorage.clear();
    if (!mounted) return;
    AppRoutes.pushAndClear(context, const LoginScreen());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: ValueListenableBuilder<bool>(
              valueListenable: Lang.isHindi,
              builder: (context, _, __) {
                if (!_failed) {
                  return const CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary);
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ErrorView(message: S.t('loadFailed'), onRetry: _restore),
                    TextButton(onPressed: _signInAgain, child: Text(S.t('signInAgain'))),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}
