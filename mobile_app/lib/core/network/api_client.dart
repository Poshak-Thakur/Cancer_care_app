import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../constants/api_endpoints.dart';
import '../storage/token_storage.dart';
import 'api_exception.dart';
import 'session_events.dart';

enum RefreshOutcome { ok, rejected, failed }

/// JSON client for the Saathi backend.
///
/// Every response has the shape { status, message?, data? }. Methods return the
/// decoded map and throw [ApiException] on any non-2xx response.
///
/// Sessions: the access token lasts 1 hour. The client refreshes it before it
/// expires, and if a request still gets a 401 it refreshes once and retries.
/// If the server rejects the refresh token, [SessionEvents.expire] fires.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _timeout = Duration(seconds: 20);
  final http.Client _http = http.Client();
  Future<RefreshOutcome>? _refreshing;

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('${ApiEndpoints.baseUrl}$path').replace(queryParameters: query);

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (TokenStorage.hasAccess) 'Authorization': 'Bearer ${TokenStorage.accessToken}',
      };

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _send(path, () => _http.get(_uri(path, query), headers: _headers()));

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _send(path, () => _http.post(_uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _send(path, () => _http.patch(_uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  /// multipart/form-data upload. [fileField] must be 'file' for the backend's
  /// multer config.
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required Map<String, String> fields,
    required List<int> fileBytes,
    required String filename,
    String fileField = 'file',
  }) {
    return _send(path, () async {
      final req = http.MultipartRequest('POST', _uri(path))
        ..headers.addAll(_headers(json: false))
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes(fileField, fileBytes, filename: filename));
      return http.Response.fromStream(await _http.send(req));
    });
  }

  /// Refreshes the access token now if it is missing or about to expire.
  Future<void> ensureFreshToken() async {
    if (TokenStorage.hasRefresh && TokenStorage.accessMissingOrExpiring) {
      await refreshSession();
    }
  }

  /// POST /api/auth/refresh. Only one refresh runs at a time; parallel callers
  /// share the result (the backend rotates the refresh token on every call).
  Future<RefreshOutcome> refreshSession() {
    return _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);
  }

  Future<RefreshOutcome> _doRefresh() async {
    final rt = TokenStorage.refreshToken;
    if (rt == null || rt.isEmpty) return RefreshOutcome.rejected;
    try {
      final res = await _http
          .post(
            _uri(ApiEndpoints.refresh),
            headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
            body: jsonEncode({'refresh_token': rt}),
          )
          .timeout(_timeout);
      if (res.statusCode == 200) {
        final body = jsonDecode(res.body) as Map<String, dynamic>;
        await TokenStorage.save(access: body['token'] as String, refresh: body['refresh_token'] as String);
        return RefreshOutcome.ok;
      }
      if (res.statusCode == 401) {
        await TokenStorage.clear();
        return RefreshOutcome.rejected;
      }
      return RefreshOutcome.failed;
    } catch (_) {
      // Network trouble: keep the tokens, the user is not signed out.
      return RefreshOutcome.failed;
    }
  }

  bool _isAuthPath(String path) => path.startsWith('/api/auth/');

  Future<Map<String, dynamic>> _send(String path, Future<http.Response> Function() call) async {
    try {
      final canRefresh = !_isAuthPath(path) && TokenStorage.hasRefresh;

      // Refresh early so most requests never see a 401.
      if (canRefresh && TokenStorage.accessMissingOrExpiring) {
        if (await refreshSession() == RefreshOutcome.rejected) _expired();
      }

      var res = await call().timeout(_timeout);

      // Fallback: the token was rejected anyway (clock skew, revoked...).
      if (res.statusCode == 401 && canRefresh) {
        switch (await refreshSession()) {
          case RefreshOutcome.ok:
            res = await call().timeout(_timeout);
            break;
          case RefreshOutcome.rejected:
            _expired();
            break;
          case RefreshOutcome.failed:
            throw const ApiException('No connection. Please check your network.');
        }
      }

      Map<String, dynamic> body = {};
      if (res.body.isNotEmpty) {
        final decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException(
          (body['message'] as String?) ?? 'Request failed (${res.statusCode})',
          statusCode: res.statusCode,
          data: body['data'],
        );
      }
      return body;
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw const ApiException('The server took too long to respond.');
    } on SocketException {
      throw const ApiException('No connection. Please check your network.');
    } on FormatException {
      throw const ApiException('Unexpected response from server.');
    }
  }

  Never _expired() {
    SessionEvents.expire();
    throw const ApiException('Your session has expired. Please sign in again.', statusCode: 401);
  }
}
