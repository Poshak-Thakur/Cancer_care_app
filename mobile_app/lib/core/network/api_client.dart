import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import '../constants/api_endpoints.dart';
import '../storage/token_storage.dart';
import 'api_exception.dart';

/// Small JSON client for the Saathi backend. Every backend response has the
/// shape { status: 'success' | 'error', message?, data? }; [get]/[post]/[patch]
/// return that decoded map and throw [ApiException] on any non-2xx response.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _timeout = Duration(seconds: 20);
  final http.Client _http = http.Client();

  Uri _uri(String path, [Map<String, String>? query]) =>
      Uri.parse('${ApiEndpoints.baseUrl}$path').replace(queryParameters: query);

  Map<String, String> _headers({bool json = true}) => {
        if (json) 'Content-Type': 'application/json',
        'Accept': 'application/json',
        if (TokenStorage.hasToken) 'Authorization': 'Bearer ${TokenStorage.token}',
      };

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query}) =>
      _send(() => _http.get(_uri(path, query), headers: _headers()));

  Future<Map<String, dynamic>> post(String path, {Object? body}) =>
      _send(() => _http.post(_uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  Future<Map<String, dynamic>> patch(String path, {Object? body}) =>
      _send(() => _http.patch(_uri(path), headers: _headers(), body: jsonEncode(body ?? {})));

  /// multipart/form-data upload (documents). [fileField] must be 'file' for
  /// the backend's multer config.
  Future<Map<String, dynamic>> postMultipart(
    String path, {
    required Map<String, String> fields,
    required List<int> fileBytes,
    required String filename,
    String fileField = 'file',
  }) {
    return _send(() async {
      final req = http.MultipartRequest('POST', _uri(path))
        ..headers.addAll(_headers(json: false))
        ..fields.addAll(fields)
        ..files.add(http.MultipartFile.fromBytes(fileField, fileBytes, filename: filename));
      return http.Response.fromStream(await _http.send(req));
    });
  }

  Future<Map<String, dynamic>> _send(Future<http.Response> Function() call) async {
    try {
      final res = await call().timeout(_timeout);
      Map<String, dynamic> body = {};
      if (res.body.isNotEmpty) {
        final decoded = jsonDecode(res.body);
        if (decoded is Map<String, dynamic>) body = decoded;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw ApiException(
          (body['message'] as String?) ?? 'Request failed (${res.statusCode})',
          statusCode: res.statusCode,
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
}
