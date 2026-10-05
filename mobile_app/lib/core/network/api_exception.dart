class ApiException implements Exception {
  final String message;
  final int? statusCode;

  /// The response's `data` field, when the server sent one with the error
  /// (e.g. the existing patient in a 409 from POST /api/patients).
  final dynamic data;

  const ApiException(this.message, {this.statusCode, this.data});

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;

  @override
  String toString() => 'ApiException($statusCode): $message';
}
