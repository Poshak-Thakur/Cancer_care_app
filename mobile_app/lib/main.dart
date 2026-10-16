import 'dart:async';
import 'package:flutter/material.dart';
import 'core/constants/app_brand.dart';
import 'core/localization/lang.dart';
import 'core/localization/strings.dart';
import 'core/network/session_events.dart';
import 'core/push/push_service.dart';
import 'core/realtime/socket_service.dart';
import 'core/routing/app_routes.dart';
import 'core/storage/local_offline_storage.dart';
import 'core/storage/token_storage.dart';
import 'core/sync/sync_engine.dart';
import 'core/theme/app_theme.dart';
import 'features/auth/screens/login_screen.dart';
import 'features/auth/screens/splash_screen.dart';
import 'features/auth/services/auth_state.dart';
import 'features/shared/calls/call_coordinator.dart';
import 'features/shared/calls/models/call_models.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await TokenStorage.load(); // restores the saved refresh token, if any
  await LocalOfflineStore.instance.init();
  await AuthState.restoreFromLocalCache(); // restores last activated offline workspace

  // Launch UI immediately so offline launch never blocks on Firebase/network
  runApp(const SaathiApp());

  // Initialize push notifications, call coordinator, and sync engine safely in background
  unawaited(_initOnlineServicesSafely());
}

Future<void> _initOnlineServicesSafely() async {
  try {
    await PushService.init().timeout(const Duration(seconds: 5));
  } catch (_) {}
  try {
    await CallCoordinator.init().timeout(const Duration(seconds: 5));
  } catch (_) {}
  try {
    await SyncEngine.instance.init();
  } catch (_) {}
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

  /// The server rejected our refresh token (401): back to the login screen.
  void _onSessionExpired() {
    if (AuthState.userId.isEmpty) return;
    AuthState.clearLocal();
    AppRoutes.pushAndClearGlobal(const LoginScreen());
    AppRoutes.messengerKey.currentState?.showSnackBar(
      SnackBar(content: Text(S.t('sessionExpired'))),
    );
  }

  void _onIncomingCall(IncomingCall call) => CallCoordinator.showIncoming(call);

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      SocketService.instance.reconnectIfNeeded();
      CallCoordinator.onResume();
      SyncEngine.instance.flushQueue();
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return MaterialApp(
          title: AppBrand.fullName,
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