import 'package:flutter/material.dart';

/// Thin navigation helpers so screens don't repeat MaterialPageRoute boilerplate.
class AppRoutes {
  /// Lets code outside a widget tree (socket events, session expiry) navigate.
  static final GlobalKey<NavigatorState> navigatorKey = GlobalKey<NavigatorState>();
  static final GlobalKey<ScaffoldMessengerState> messengerKey = GlobalKey<ScaffoldMessengerState>();

  static Future<T?> push<T>(BuildContext context, Widget page) {
    return Navigator.of(context).push<T>(MaterialPageRoute(builder: (_) => page));
  }

  /// Replace the whole stack (after login, onboarding, sign-out).
  static Future<T?> pushAndClear<T>(BuildContext context, Widget page) {
    return Navigator.of(context).pushAndRemoveUntil<T>(
      MaterialPageRoute(builder: (_) => page),
      (route) => false,
    );
  }

  static Future<T?> fadeReplace<T, R>(BuildContext context, Widget page) {
    return Navigator.of(context).pushReplacement<T, R>(
      PageRouteBuilder(
        transitionDuration: const Duration(milliseconds: 500),
        pageBuilder: (_, __, ___) => page,
        transitionsBuilder: (_, anim, __, child) => FadeTransition(opacity: anim, child: child),
      ),
    );
  }

  /// Same as [pushAndClear] but without a BuildContext.
  static Future<T?>? pushAndClearGlobal<T>(Widget page) {
    return navigatorKey.currentState?.pushAndRemoveUntil<T>(
      MaterialPageRoute(builder: (_) => page),
      (route) => false,
    );
  }

  static Future<T?>? pushGlobal<T>(Widget page) {
    return navigatorKey.currentState?.push<T>(MaterialPageRoute(builder: (_) => page));
  }
}
