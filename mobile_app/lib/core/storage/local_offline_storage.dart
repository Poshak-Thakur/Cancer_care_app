import 'dart:convert';
import 'package:path/path.dart' as p;
import 'package:sqflite/sqflite.dart';

class LocalOfflineStore {
  LocalOfflineStore._();
  static final LocalOfflineStore instance = LocalOfflineStore._();

  Database? _db;

  Future<void> init() async {
    await database;
  }

  Future<Database> get database async {
    if (_db != null) return _db!;
    final dbPath = await getDatabasesPath();
    _db = await openDatabase(
      p.join(dbPath, 'dost_offline_v1.db'),
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE session_snapshot (
            key TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE cached_records (
            cache_key TEXT PRIMARY KEY,
            patient_id TEXT,
            payload TEXT NOT NULL,
            last_synced_at TEXT NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE sync_queue (
            operation_id TEXT PRIMARY KEY,
            patient_id TEXT NOT NULL,
            operation_type TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            http_method TEXT NOT NULL,
            payload TEXT NOT NULL,
            sync_state TEXT NOT NULL DEFAULT 'PENDING',
            last_error TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        ''');
      },
    );
    return _db!;
  }

  // ---------------- SESSION SNAPSHOT (OFFLINE LAUNCH) ----------------

  Future<void> saveActivatedSession(Map<String, dynamic> sessionJson) async {
    try {
      final db = await database;
      await db.insert(
        'session_snapshot',
        {
          'key': 'active_session',
          'payload': jsonEncode(sessionJson),
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    } catch (_) {}
  }

  Future<Map<String, dynamic>?> getActivatedSession() async {
    try {
      final db = await database;
      final rows = await db.query(
        'session_snapshot',
        where: 'key = ?',
        whereArgs: ['active_session'],
        limit: 1,
      );
      if (rows.isEmpty) return null;
      return jsonDecode(rows.first['payload'] as String) as Map<String, dynamic>;
    } catch (_) {
      return null;
    }
  }

  Future<void> clearActivatedSession() async {
    try {
      final db = await database;
      await db.delete('session_snapshot');
      await db.delete('cached_records');
      await db.delete('sync_queue');
    } catch (_) {}
  }

  Future<void> clearAll() => clearActivatedSession();

  // ---------------- LOCAL-FIRST ENTITY CACHE ----------------

  Future<void> putCache({
    required String cacheKey,
    String? patientId,
    required dynamic data,
  }) async {
    try {
      final db = await database;
      await db.insert(
        'cached_records',
        {
          'cache_key': cacheKey,
          'patient_id': patientId,
          'payload': jsonEncode(data),
          'last_synced_at': DateTime.now().toUtc().toIso8601String(),
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    } catch (_) {}
  }

  Future<CachedRecord?> getCache(String cacheKey) async {
    try {
      final db = await database;
      final rows = await db.query(
        'cached_records',
        where: 'cache_key = ?',
        whereArgs: [cacheKey],
        limit: 1,
      );
      if (rows.isEmpty) return null;
      return CachedRecord(
        cacheKey: rows.first['cache_key'] as String,
        data: jsonDecode(rows.first['payload'] as String),
        lastSyncedAt: DateTime.parse(rows.first['last_synced_at'] as String),
      );
    } catch (_) {
      return null;
    }
  }

  // ---------------- PERSISTENT OFFLINE SYNC QUEUE ----------------

  Future<void> enqueueOperation({
    required String operationId,
    required String patientId,
    required String operationType,
    required String endpoint,
    required String httpMethod,
    required Map<String, dynamic> payload,
  }) async {
    try {
      final db = await database;
      final now = DateTime.now().toUtc().toIso8601String();
      await db.insert(
        'sync_queue',
        {
          'operation_id': operationId,
          'patient_id': patientId,
          'operation_type': operationType,
          'endpoint': endpoint,
          'http_method': httpMethod,
          'payload': jsonEncode(payload),
          'sync_state': 'PENDING',
          'created_at': now,
          'updated_at': now,
        },
        conflictAlgorithm: ConflictAlgorithm.replace,
      );
    } catch (_) {}
  }

  Future<List<Map<String, dynamic>>> getPendingOperations() async {
    try {
      final db = await database;
      return db.query(
        'sync_queue',
        where: "sync_state IN ('PENDING', 'RETRYING')",
        orderBy: 'created_at ASC',
      );
    } catch (_) {
      return const [];
    }
  }

  Future<void> markOperationSynced(String operationId) async {
    try {
      final db = await database;
      await db.delete(
        'sync_queue',
        where: 'operation_id = ?',
        whereArgs: [operationId],
      );
    } catch (_) {}
  }

  Future<void> markOperationFailed(String operationId, String error, {bool permanent = false}) async {
    try {
      final db = await database;
      await db.update(
        'sync_queue',
        {
          'sync_state': permanent ? 'FAILED_PERMANENT' : 'RETRYING',
          'last_error': error,
          'updated_at': DateTime.now().toUtc().toIso8601String(),
        },
        where: 'operation_id = ?',
        whereArgs: [operationId],
      );
    } catch (_) {}
  }
}

class CachedRecord {
  final String cacheKey;
  final dynamic data;
  final DateTime lastSyncedAt;

  CachedRecord({
    required this.cacheKey,
    required this.data,
    required this.lastSyncedAt,
  });
}