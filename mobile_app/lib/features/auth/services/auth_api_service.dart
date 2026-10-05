import '../../../core/constants/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/storage/token_storage.dart';

/// Who just signed in, as reported by the backend.
class AuthResult {
  final String userId;
  final String email;

  /// Any of PATIENT, CAREGIVER, STAFF, or NEW_USER (no role yet).
  final List<String> roles;

  const AuthResult({required this.userId, required this.email, required this.roles});

  factory AuthResult.fromUser(Map<String, dynamic> u) => AuthResult(
        userId: u['id'] as String,
        email: (u['email'] as String?) ?? '',
        roles: ((u['roles'] as List?) ?? const []).map((e) => e.toString()).toList(),
      );
}

/// Talks to /api/auth/*. The backend identifies users by email.
class AuthApiService {
  final ApiClient _api = ApiClient.instance;

  Future<void> requestOtp(String email) async {
    await _api.post(ApiEndpoints.requestOtp, body: {'email': email});
  }

  /// Verifies the OTP and stores both tokens (refresh token in secure storage).
  Future<AuthResult> verifyOtp({required String email, required String otp}) async {
    final res = await _api.post(ApiEndpoints.verifyOtp, body: {'email': email, 'otp': otp});
    await TokenStorage.save(access: res['token'] as String, refresh: res['refresh_token'] as String);
    return AuthResult.fromUser(res['user'] as Map<String, dynamic>);
  }

  Future<AuthResult> me() async {
    final res = await _api.get(ApiEndpoints.me);
    return AuthResult.fromUser(res['data'] as Map<String, dynamic>);
  }

  /// Silent sign-in at app start. Returns null when there is no saved session
  /// or the server rejected it (the user must sign in again). Throws
  /// [ApiException] when the network is down, so the caller can offer a retry
  /// instead of signing the user out.
  Future<AuthResult?> restoreSession() async {
    if (!TokenStorage.hasRefresh) return null;
    switch (await _api.refreshSession()) {
      case RefreshOutcome.ok:
        return me();
      case RefreshOutcome.rejected:
        return null;
      case RefreshOutcome.failed:
        throw const ApiException('No connection. Please check your network.');
    }
  }

  /// POST /api/auth/logout, then forget the tokens locally. Local sign-out
  /// always happens, even if the server cannot be reached.
  Future<void> signOut() async {
    try {
      await _api.ensureFreshToken(); // logout needs a valid access token
      await _api.post(ApiEndpoints.logout, body: {'refresh_token': TokenStorage.refreshToken});
    } catch (_) {
      // best effort
    } finally {
      await TokenStorage.clear();
    }
  }
}
