import 'dart:async';
import 'package:socket_io_client/socket_io_client.dart' as io;
import '../constants/api_endpoints.dart';
import '../network/api_client.dart';
import '../storage/token_storage.dart';
import '../../features/shared/calls/models/call_models.dart';

/// Socket.io connection used for instant call ringing.
///
/// The backend authenticates the handshake with the access token
/// (`auth: { token }`) and puts the user in their private room itself, so the
/// app no longer emits `join`. Events used: `incomingCall`, `callStatusUpdated`.
///
/// Access tokens last 1 hour. When the server rejects the handshake (expired
/// token), the app refreshes the token and reconnects.
class SocketService {
  SocketService._();
  static final SocketService instance = SocketService._();

  io.Socket? _socket;
  String? _userId;
  Timer? _retry;
  int _failures = 0;

  final _incoming = StreamController<IncomingCall>.broadcast();
  final _status = StreamController<CallStatusUpdate>.broadcast();

  Stream<IncomingCall> get incomingCalls => _incoming.stream;
  Stream<CallStatusUpdate> get statusUpdates => _status.stream;

  Future<void> start(String userId) async {
    if (_socket != null && _userId == userId) return;
    stop();
    _userId = userId;

    // Make sure the handshake carries a valid token.
    await ApiClient.instance.ensureFreshToken();
    if (_userId != userId) return; // stopped or switched user while waiting

    final s = io.io(
      ApiEndpoints.baseUrl,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .setAuth({'token': TokenStorage.accessToken ?? ''})
          .disableAutoConnect()
          .disableReconnection() // reconnects are handled below so the token can be renewed first
          .build(),
    );

    s.onConnect((_) => _failures = 0);
    s.onConnectError((_) => _scheduleReconnect());
    s.onDisconnect((_) => _scheduleReconnect());

    s.on('incomingCall', (data) {
      try {
        _incoming.add(IncomingCall.fromJson(Map<String, dynamic>.from(data as Map)));
      } catch (_) {}
    });
    s.on('callStatusUpdated', (data) {
      try {
        _status.add(CallStatusUpdate.fromJson(Map<String, dynamic>.from(data as Map)));
      } catch (_) {}
    });

    s.connect();
    _socket = s;
  }

  void _scheduleReconnect() {
    final s = _socket;
    if (s == null || _userId == null || _retry != null) return;
    _failures++;
    final seconds = _failures > 5 ? 30 : _failures * 3;
    _retry = Timer(Duration(seconds: seconds), () async {
      _retry = null;
      if (_socket != s) return;
      if (s.connected) return;
      await ApiClient.instance.ensureFreshToken();
      if (_socket != s) return;
      s.auth = {'token': TokenStorage.accessToken ?? ''};
      s.connect();
    });
  }

  void stop() {
    _retry?.cancel();
    _retry = null;
    _failures = 0;
    _socket?.dispose();
    _socket = null;
    _userId = null;
  }
}
