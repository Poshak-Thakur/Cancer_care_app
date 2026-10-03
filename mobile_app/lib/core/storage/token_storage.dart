/// Holds the JWT returned by POST /api/auth/verify-otp.
///
/// In-memory for now (lost on app restart). For production, back this with
/// flutter_secure_storage so the session survives restarts.
class TokenStorage {
  static String? _token;

  static String? get token => _token;
  static bool get hasToken => _token != null && _token!.isNotEmpty;

  static void save(String token) => _token = token;
  static void clear() => _token = null;
}
