import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keeps the "code from Dost" between the code screen and the moment the
/// user has signed in (email + OTP). The code is a secret: it lives only in
/// secure storage, never in logs, and is removed after any final result
/// (success, refused code, "already set up", "too many attempts") and on
/// sign-out.
class ClaimCodeStorage {
  static const _store = FlutterSecureStorage();
  static const _key = 'saathi_claim_code';

  /// Upper-case, without spaces or dashes ("ab12-cd34" -> "AB12CD34").
  static String normalize(String input) => input.toUpperCase().replaceAll(RegExp(r'[\s\-]'), '');

  /// 8 letters/digits, like the codes the NGO generates.
  static bool isValid(String normalized) => RegExp(r'^[A-Z0-9]{8}$').hasMatch(normalized);

  static Future<void> save(String normalizedCode) async {
    try {
      await _store.write(key: _key, value: normalizedCode);
    } catch (_) {}
  }

  static Future<String?> read() async {
    try {
      final v = await _store.read(key: _key);
      return (v == null || v.isEmpty) ? null : v;
    } catch (_) {
      return null;
    }
  }

  static Future<void> clear() async {
    try {
      await _store.delete(key: _key);
    } catch (_) {}
  }
}
