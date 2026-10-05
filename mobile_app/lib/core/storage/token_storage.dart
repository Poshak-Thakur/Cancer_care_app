import 'dart:convert';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Access token (1 hour) lives in memory only. The refresh token (30 days) is
/// kept in the platform keystore so the user stays signed in across restarts.
class TokenStorage {
  static const _store = FlutterSecureStorage();
  static const _refreshKey = 'saathi_refresh_token';

  static String? _access;
  static String? _refresh;
  static DateTime? _accessExpiry;

  static String? get accessToken => _access;
  static String? get refreshToken => _refresh;
  static bool get hasAccess => _access != null && _access!.isNotEmpty;
  static bool get hasRefresh => _refresh != null && _refresh!.isNotEmpty;

  /// True when there is no access token, or it expires within 30 seconds.
  static bool get accessMissingOrExpiring {
    if (!hasAccess || _accessExpiry == null) return true;
    return DateTime.now().isAfter(_accessExpiry!.subtract(const Duration(seconds: 30)));
  }

  /// Call once at app start, before runApp.
  static Future<void> load() async {
    try {
      _refresh = await _store.read(key: _refreshKey);
    } catch (_) {
      _refresh = null;
    }
  }

  static Future<void> save({required String access, required String refresh}) async {
    _access = access;
    _accessExpiry = _expiryOf(access);
    _refresh = refresh;
    try {
      await _store.write(key: _refreshKey, value: refresh);
    } catch (_) {
      // Keystore unavailable: the session still works until the app closes.
    }
  }

  static Future<void> clear() async {
    _access = null;
    _accessExpiry = null;
    _refresh = null;
    try {
      await _store.delete(key: _refreshKey);
    } catch (_) {}
  }

  static DateTime? _expiryOf(String jwt) {
    try {
      final parts = jwt.split('.');
      if (parts.length != 3) return null;
      final payload = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(parts[1])))) as Map<String, dynamic>;
      final exp = payload['exp'];
      return exp is num ? DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000) : null;
    } catch (_) {
      return null;
    }
  }
}
