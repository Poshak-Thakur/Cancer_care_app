import 'dart:async';
import 'package:flutter/material.dart';
import 'core/localization/lang.dart';
import 'core/localization/strings.dart';
import 'core/network/session_events.dart';
import 'core/realtime/socket_service.dart';
import 'core/routing/app_routes.dart';
import 'core/storage/token_storage.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/splash_screen.dart';
import 'features/auth/services/auth_state.dart';
import 'features/shared/calls/models/call_models.dart';
import 'features/shared/calls/screens/call_screen.dart';
import 'features/shared/calls/screens/incoming_call_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TokenStorage.load(); // restores the saved refresh token, if any
  runApp(const SaathiApp());
}

class SaathiApp extends StatefulWidget {
  const SaathiApp({super.key});

  @override
  State<SaathiApp> createState() => _SaathiAppState();
}

class _SaathiAppState extends State<SaathiApp> {
  StreamSubscription<IncomingCall>? _callSub;

  @override
  void initState() {
    super.initState();
    SessionEvents.expired.addListener(_onSessionExpired);
    _callSub = SocketService.instance.incomingCalls.listen(_onIncomingCall);
  }

  @override
  void dispose() {
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

  void _onIncomingCall(IncomingCall call) {
    // Ignore if we are already ringing or in a call.
    if (CallScreen.active || IncomingCallScreen.ringingCallId != null) return;
    AppRoutes.pushGlobal(IncomingCallScreen(call: call));
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
