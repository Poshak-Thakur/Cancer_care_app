/// ============================================================================
///  THE ONE PLACE TO POINT THE APP AT A BACKEND
/// ============================================================================
///
///  When the backend is hosted, change [kApiBaseUrl] below and nothing else.
///  Every REST call, the Socket.io connection (calls + live chat) and all
///  derived URLs are built from it.
///
///  Rules:
///    * Include the scheme (http:// or https://), no trailing slash, and no
///      "/api" suffix (the endpoint paths already start with /api/...).
///    * Use https:// for a hosted server. Socket.io then uses wss:// by itself.
///
///  Examples
///    Android emulator -> your PC     'http://10.0.2.2:3000'
///    Real phone on the same Wi-Fi    'http://192.168.1.10:3000'
///    Hosted (Render/Railway/VPS)     'https://saathi-api.onrender.com'
const String kApiBaseUrl = 'http://10.0.2.2:3000';

/// Optional: user id of the NGO helpline staff account. Unlinked users (no
/// patient yet) have no care team to look the helpline up from, so they reach
/// it through this id. Leave empty if the helpline is only for linked users.
const String kHelplineStaffUserId = '';

/// Runtime configuration derived from the constants above.
///
/// Both values can also be overridden at build time without editing code:
///   flutter run --dart-define=API_BASE_URL=https://api.example.org \
///               --dart-define=HELPLINE_USER_ID=<uuid>
class AppConfig {
  AppConfig._();

  static const String _definedUrl = String.fromEnvironment('API_BASE_URL');
  static const String _definedHelpline = String.fromEnvironment('HELPLINE_USER_ID');

  /// Base URL of the Saathi backend, without a trailing slash.
  static String get baseUrl {
    final raw = _definedUrl.isNotEmpty ? _definedUrl : kApiBaseUrl;
    return raw.trim().replaceAll(RegExp(r'/+$'), '');
  }

  /// Socket.io connects to the same host as the REST API.
  static String get socketUrl => baseUrl;

  static String get helplineStaffUserId =>
      (_definedHelpline.isNotEmpty ? _definedHelpline : kHelplineStaffUserId).trim();

  static bool get hasHelplineId => helplineStaffUserId.isNotEmpty;
}
