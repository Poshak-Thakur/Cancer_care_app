import '../../../core/constants/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/storage/token_storage.dart';

/// Talks to /api/auth/*. NOTE: the backend identifies users by **email**,
/// not phone number.
class AuthApiService {
  final ApiClient _api = ApiClient.instance;

  Future<void> requestOtp(String email) async {
    await _api.post(ApiEndpoints.requestOtp, body: {'email': email});
  }

  /// Verifies the OTP, stores the JWT, and returns the user account map
  /// (id, email, ...).
  Future<Map<String, dynamic>> verifyOtp({required String email, required String otp}) async {
    final res = await _api.post(ApiEndpoints.verifyOtp, body: {'email': email, 'otp': otp});
    TokenStorage.save(res['token'] as String);
    return Map<String, dynamic>.from(res['user'] as Map);
  }

  Future<Map<String, dynamic>> me() async {
    final res = await _api.get(ApiEndpoints.me);
    return Map<String, dynamic>.from(res['data'] as Map);
  }

  void signOut() => TokenStorage.clear();
}
