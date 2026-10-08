class ApiException implements Exception {
  final String message;
  final int? statusCode;

  /// The response's `data` field, when the server sent one with the error
  /// (e.g. the existing patient in a 409 from POST /api/patients).
  final dynamic data;

  /// Machine-readable error code some endpoints send (e.g. CAREGIVER_NOT_RECOGNIZED).
  final String? code;

  const ApiException(this.message, {this.statusCode, this.data, this.code});

  bool get isUnauthorized => statusCode == 401;
  bool get isForbidden => statusCode == 403;

  @override
  String toString() => 'ApiException($statusCode): $message';
}
