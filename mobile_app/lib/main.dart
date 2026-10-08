import 'dart:async';
import 'package:flutter/material.dart';
import 'core/localization/lang.dart';
import 'core/localization/strings.dart';
import 'core/network/session_events.dart';
import 'core/push/push_service.dart';
import 'core/realtime/socket_service.dart';
import 'core/routing/app_routes.dart';
import 'core/storage/token_storage.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/splash_screen.dart';
import 'features/auth/services/auth_state.dart';
import 'features/shared/calls/call_coordinator.dart';
import 'features/shared/calls/models/call_models.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TokenStorage.load(); // restores the saved refresh token, if any
  await PushService.init(); // Firebase: wakes the phone for calls when the app is closed
  await CallCoordinator.init(); // system incoming-call screen
  runApp(const SaathiApp());
}

class SaathiApp extends StatefulWidget {
  const SaathiApp({super.key});

  @override
  State<SaathiApp> createState() => _SaathiAppState();
}

class _SaathiAppState extends State<SaathiApp> with WidgetsBindingObserver {
  StreamSubscription<IncomingCall>? _callSub;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    SessionEvents.expired.addListener(_onSessionExpired);
    _callSub = SocketService.instance.incomingCalls.listen(_onIncomingCall);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    SessionEvents.expired.removeListener(_onSessionExpired);
    _callSub?.cancel();
    super.dispose();
  }

  /// The server rejected our refresh token: back to the login screen.
  void _onSessionExpired() {
    AuthState.clearLocal();
    AppRoutes.pushAndClearGlobal(const LoginScreen());
    AppRoutes.messengerKey.currentState?.showSnackBar(SnackBar(content: Text(S.t('sessionExpired'))));
  }

  void _onIncomingCall(IncomingCall call) => CallCoordinator.showIncoming(call);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      SocketService.instance.reconnectIfNeeded();
      CallCoordinator.onResume();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return MaterialApp(
          title: 'Saathi',
          debugShowCheckedModeBanner: false,
          theme: AppTheme.theme,
          navigatorKey: AppRoutes.navigatorKey,
          scaffoldMessengerKey: AppRoutes.messengerKey,
          home: const SplashScreen(),
        );
      },
    );
  }
}
