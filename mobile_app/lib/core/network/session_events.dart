import 'package:flutter/foundation.dart';

/// Fired when the server rejects the refresh token. The app root listens and
/// sends the user back to the login screen.
class SessionEvents {
  static final ValueNotifier<int> expired = ValueNotifier<int>(0);
  static void expire() => expired.value++;
}
