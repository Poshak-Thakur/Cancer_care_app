import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/network/session_events.dart';
import '../../../core/push/push_service.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/storage/token_storage.dart';
import '../../../core/sync/sync_engine.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/async_states.dart';
import '../../shared/calls/call_coordinator.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../services/session_router.dart';
import 'login_screen.dart';

/// Shown right after the splash.
///
/// Offline-first behavior:
/// 1. If the user has already activated their account on this device
///    ([TokenStorage.hasRefresh] and a cached workspace in [AuthState]),
///    immediately opens the local PatientShell or CaregiverShell without
///    waiting for the internet, then refreshes tokens & data in the background.
/// 2. If there is no cached workspace yet, attempts an online session restore.
/// 3. If no refresh token is saved, opens [LoginScreen] immediately (even offline).
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

    // Case 1: Never signed in on this device -> go straight to LoginScreen (works offline)
    if (!TokenStorage.hasRefresh) {
      if (!mounted) return;
      AppRoutes.pushAndClear(context, const LoginScreen());
      return;
    }

    // Case 2: Already activated locally -> open cached workspace immediately (offline-first!)
    await AuthState.restoreFromLocalCache();
    final offlineHome = SessionRouter.offlineDestinationIfReady();
    if (offlineHome != null) {
      if (!mounted) return;
      SocketService.instance.start(AuthState.userId);
      AppRoutes.pushAndClear(context, offlineHome);
      CallCoordinator.onSessionReady();
      unawaited(_refreshActivatedWorkspaceInBackground());
      return;
    }

    // Case 3: Refresh token exists, but onboarding/workspace was never cached -> try online restore
    try {
      final result = await AuthApiService().restoreSession();
      if (!mounted) return;
      if (result == null) {
        AuthState.clearLocal();
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

  /// Runs silently in the background after an instant offline launch.
  /// Only logs the user out if the server explicitly rejects the refresh token (401).
  Future<void> _refreshActivatedWorkspaceInBackground() async {
    try {
      final result = await AuthApiService().restoreSession();
      if (result == null) {
        // Refresh token was explicitly rejected (401) by the server
        SessionEvents.expire();
        return;
      }
      AuthState.applyLogin(result);
      await AuthState.syncScopes();
      await AuthState.persistSession();
      PushService.registerForUser();
      await SyncEngine.instance.flushQueue();
    } catch (_) {
      // Offline or temporary network error: keep using the local workspace uninterrupted
    }
  }

  Future<void> _signInAgain() async {
    await TokenStorage.clear();
    AuthState.clearLocal();
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
                  return const CircularProgressIndicator(
                    strokeWidth: 3,
                    color: AppColors.primary,
                  );
                }
                return Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    ErrorView(message: S.t('loadFailed'), onRetry: _restore),
                    TextButton(
                      onPressed: _signInAgain,
                      child: Text(S.t('signInAgain')),
                    ),
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