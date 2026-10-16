import 'dart:async';
import 'dart:convert';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../constants/api_endpoints.dart';
import '../network/api_client.dart';
import '../storage/local_offline_storage.dart';
import '../storage/token_storage.dart';

class SyncStatus {
  final bool isOnline;
  final bool isSyncing;
  final int pendingCount;
  final DateTime? lastSyncedAt;

  const SyncStatus({
    required this.isOnline,
    this.isSyncing = false,
    this.pendingCount = 0,
    this.lastSyncedAt,
  });

  SyncStatus copyWith({
    bool? isOnline,
    bool? isSyncing,
    int? pendingCount,
    DateTime? lastSyncedAt,
  }) {
    return SyncStatus(
      isOnline: isOnline ?? this.isOnline,
      isSyncing: isSyncing ?? this.isSyncing,
      pendingCount: pendingCount ?? this.pendingCount,
      lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
    );
  }
}

class SyncEngine {
  SyncEngine._();
  static final SyncEngine instance = SyncEngine._();

  final ValueNotifier<SyncStatus> status = ValueNotifier(
    const SyncStatus(isOnline: true),
  );

  StreamSubscription<List<ConnectivityResult>>? _connectivitySub;
  String? _baseUrl;
  Future<String?> Function()? _getAccessToken;

  /// Default initializer that binds automatically to [ApiEndpoints.baseUrl] and [TokenStorage].
  Future<void> init() {
    return initialize(
      baseUrl: ApiEndpoints.baseUrl,
      getAccessToken: () async {
        await ApiClient.instance.ensureFreshToken();
        return TokenStorage.accessToken;
      },
    );
  }

  Future<void> initialize({
    required String baseUrl,
    required Future<String?> Function() getAccessToken,
  }) async {
    _baseUrl = baseUrl;
    _getAccessToken = getAccessToken;

    final initial = await Connectivity().checkConnectivity();
    final online = !initial.contains(ConnectivityResult.none);
    final pending = await LocalOfflineStore.instance.getPendingOperations();
    status.value = status.value.copyWith(
      isOnline: online,
      pendingCount: pending.length,
    );

    _connectivitySub?.cancel();
    _connectivitySub = Connectivity().onConnectivityChanged.listen((results) {
      final nowOnline = !results.contains(ConnectivityResult.none);
      status.value = status.value.copyWith(isOnline: nowOnline);
      if (nowOnline) {
        flushQueue();
      }
    });

    if (online && pending.isNotEmpty) {
      unawaited(flushQueue());
    }
  }

  Future<void> flushQueue() async {
    if (status.value.isSyncing) return;
    _baseUrl ??= ApiEndpoints.baseUrl;
    _getAccessToken ??= () async {
      await ApiClient.instance.ensureFreshToken();
      return TokenStorage.accessToken;
    };

    final pending = await LocalOfflineStore.instance.getPendingOperations();
    if (pending.isEmpty) {
      status.value = status.value.copyWith(pendingCount: 0);
      return;
    }

    status.value = status.value.copyWith(isSyncing: true, pendingCount: pending.length);

    try {
      final token = await _getAccessToken!();
      if (token == null || token.isEmpty) return;

      for (final op in pending) {
        final opId = op['operation_id'] as String;
        final endpoint = op['endpoint'] as String;
        final method = (op['http_method'] as String).toUpperCase();
        final bodyMap = jsonDecode(op['payload'] as String) as Map<String, dynamic>;

        final uri = Uri.parse('$_baseUrl$endpoint');
        final headers = {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer $token',
        };

        http.Response response;
        if (method == 'PATCH') {
          response = await http
              .patch(uri, headers: headers, body: jsonEncode(bodyMap))
              .timeout(const Duration(seconds: 15));
        } else {
          response = await http
              .post(uri, headers: headers, body: jsonEncode(bodyMap))
              .timeout(const Duration(seconds: 15));
        }

        if ((response.statusCode >= 200 && response.statusCode < 300) ||
            response.statusCode == 409) {
          // 2xx or 409 (already processed client_event_id) => remove from queue
          await LocalOfflineStore.instance.markOperationSynced(opId);
        } else if (response.statusCode == 403 || response.statusCode == 422) {
          // Permanent authorization/validation conflict (e.g., revoked consent)
          await LocalOfflineStore.instance.markOperationFailed(
            opId,
            'Rejected by server (${response.statusCode})',
            permanent: true,
          );
        } else {
          await LocalOfflineStore.instance.markOperationFailed(
            opId,
            'Temporary failure (${response.statusCode})',
          );
          break;
        }
      }
    } catch (_) {
      // Network dropped mid-sync; keep remaining items queued for next reconnect
    } finally {
      final remaining = await LocalOfflineStore.instance.getPendingOperations();
      status.value = status.value.copyWith(
        isSyncing: false,
        pendingCount: remaining.length,
        lastSyncedAt: DateTime.now(),
      );
    }
  }

  void dispose() {
    _connectivitySub?.cancel();
  }
}