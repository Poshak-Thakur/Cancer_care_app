import 'package:flutter/material.dart';

/// Thin navigation helpers so screens don't repeat MaterialPageRoute boilerplate.
/// Swap the internals for go_router / named routes later without touching screens.
class AppRoutes {
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
}
