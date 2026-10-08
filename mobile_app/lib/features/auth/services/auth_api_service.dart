import 'dart:typed_data';
import 'package:http_parser/http_parser.dart' show MediaType;
import '../../../core/constants/api_endpoints.dart';
import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/storage/token_storage.dart';

/// The signed-in account, as reported by the backend (verify-otp, /me and
/// PATCH /profile all return the same user fields).
class AuthResult {
  final String userId;
  final String email;
  final String? fullName;
  final DateTime? dateOfBirth;
  final String? phoneNumber;
  final String? avatarUrl;
  final String preferredLanguage; // 'en' | 'hi'
  final String? caregiverType; // FAMILY | VOLUNTEER | null

  /// NGO recognition of this caregiver (ngo_recognition_status == RECOGNIZED).
  /// Recognition is set by the NGO only; the app just reads it.
  final bool ngoRecognized;

  /// Any of PATIENT, CAREGIVER, STAFF, or NEW_USER (no role yet).
  final List<String> roles;
  final bool isProfileCompleted;

  const AuthResult({
    required this.userId,
    required this.email,
    required this.roles,
    required this.isProfileCompleted,
    this.fullName,
    this.dateOfBirth,
    this.phoneNumber,
    this.avatarUrl,
    this.preferredLanguage = 'en',
    this.caregiverType,
    this.ngoRecognized = false,
  });

  factory AuthResult.fromUser(Map<String, dynamic> u) {
    final rawDob = u['date_of_birth'] as String?;
    final cg = u['caregiverprofile'];
    return AuthResult(
      userId: u['id'] as String,
      email: (u['email'] as String?) ?? '',
      fullName: u['full_name'] as String?,
      dateOfBirth: rawDob == null || rawDob.length < 10
          ? null
          : (() {
              final d = DateTime.tryParse(rawDob.substring(0, 10));
              return d == null ? null : DateTime(d.year, d.month, d.day);
            })(),
      phoneNumber: u['phone_number'] as String?,
      avatarUrl: u['avatar_url'] as String?,
      preferredLanguage: (u['preferred_language'] as String?) ?? 'en',
      caregiverType: cg is Map ? cg['caregiver_type'] as String? : null,
      ngoRecognized: cg is Map && cg['ngo_recognition_status'] == 'RECOGNIZED',
      roles: ((u['roles'] as List?) ?? const []).map((e) => e.toString()).toList(),
      isProfileCompleted: (u['is_profile_completed'] as bool?) ?? ((u['full_name'] as String?)?.isNotEmpty ?? false),
    );
  }
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

  /// PATCH /api/auth/profile. Only the fields you pass are changed.
  /// [caregiverType] (FAMILY | VOLUNTEER) also creates the caregiver profile.
  /// Setting a name marks the profile as completed.
  Future<AuthResult> updateProfile({
    String? fullName,
    DateTime? dateOfBirth,
    String? phoneNumber,
    String? preferredLanguage,
    String? caregiverType,
  }) async {
    final res = await _api.patch(ApiEndpoints.authProfile, body: {
      if (fullName != null) 'full_name': fullName.trim(),
      if (dateOfBirth != null) 'date_of_birth': _dateOnly(dateOfBirth),
      if (phoneNumber != null) 'phone_number': phoneNumber.trim(),
      if (preferredLanguage != null) 'preferred_language': preferredLanguage,
      if (caregiverType != null) 'caregiver_type': caregiverType,
    });
    final data = Map<String, dynamic>.from(res['data'] as Map);
    final result = AuthResult.fromUser(data);
    // PATCH does not echo the caregiver profile; keep what we asked for.
    if (caregiverType != null && result.caregiverType == null) {
      return AuthResult(
        userId: result.userId,
        email: result.email,
        roles: result.roles,
        isProfileCompleted: result.isProfileCompleted,
        fullName: result.fullName,
        dateOfBirth: result.dateOfBirth,
        phoneNumber: result.phoneNumber,
        avatarUrl: result.avatarUrl,
        preferredLanguage: result.preferredLanguage,
        caregiverType: caregiverType,
        ngoRecognized: result.ngoRecognized,
      );
    }
    return result;
  }

  /// POST /api/caregivers/avatar (multipart field 'avatar', max 5 MB). The
  /// route only needs a signed-in user, so patients use it too. Returns the
  /// permanent public URL.
  Future<String> uploadAvatar({required Uint8List bytes, required String filename, String mime = 'image/jpeg'}) async {
    final parts = mime.split('/');
    final res = await _api.postMultipart(
      ApiEndpoints.caregiverAvatar,
      fields: const {},
      fileBytes: bytes,
      filename: filename,
      fileField: 'avatar',
      contentType: MediaType(parts.first, parts.length > 1 ? parts[1] : 'jpeg'),
    );
    final url = (res['data'] as Map?)?['avatar_url'] as String?;
    if (url == null || url.isEmpty) throw const ApiException('Could not save the photo. Please try again.');
    return url;
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

  static String _dateOnly(DateTime d) =>
      '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}
