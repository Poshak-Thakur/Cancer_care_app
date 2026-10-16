import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/sync/sync_engine.dart';
import '../../../../core/utils/uuid.dart';
import '../../../auth/services/auth_state.dart';
import '../models/care_contact.dart';
import '../models/chat_message.dart';

class ChatService {
  final ApiClient _api = ApiClient.instance;
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static String _contactsKey(String patientId) => 'chat_contacts_$patientId';
  static String _conversationsKey() => 'chat_conversations_${AuthState.userId}';
  static String _messagesKey(String conversationId) => 'chat_messages_$conversationId';

  /// Assigned NGO staff + linked caregivers (cached for offline access).
  Future<List<CareContact>> contacts(String patientId) async {
    final key = _contactsKey(patientId);
    try {
      final res = await _api.get(ApiEndpoints.chatContacts(patientId));
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: key, patientId: patientId, data: rawList);
      final list = rawList.map(CareContact.fromJson).toList();
      ContactDirectory.remember(list);
      return list;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        final list = (cached.data as List)
            .map((e) => CareContact.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
        ContactDirectory.remember(list);
        return list;
      }
      return const <CareContact>[];
    }
  }

  /// GET /api/chat/conversations: every thread the user is in, newest first.
  Future<List<ConversationSummary>> conversations() async {
    final key = _conversationsKey();
    try {
      final res = await _api.get(ApiEndpoints.chatConversations);
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: key, data: rawList);
      final list = rawList.map(ConversationSummary.fromJson).toList()
        ..sort((a, b) => b.sortTime.compareTo(a.sortTime));
      return list;
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        final list = (cached.data as List)
            .map((e) => ConversationSummary.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList()
          ..sort((a, b) => b.sortTime.compareTo(a.sortTime));
        return list;
      }
      return const <ConversationSummary>[];
    }
  }

  /// Opens (or creates) the thread with [participantId].
  Future<ChatThread> openThread({String? patientId, required String participantId}) async {
    final threadKey = 'chat_thread_${patientId ?? 'none'}_$participantId';
    try {
      final res = await _api.post(ApiEndpoints.chatThread, body: {
        if (patientId != null) 'patient_id': patientId,
        'participant_id': participantId,
      });
      final map = Map<String, dynamic>.from(res['data'] as Map);
      await _cache.putCache(cacheKey: threadKey, patientId: patientId, data: map);
      return ChatThread.fromJson(map);
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(threadKey);
      if (cached != null && cached.data is Map) {
        return ChatThread.fromJson(Map<String, dynamic>.from(cached.data as Map));
      }
      rethrow;
    }
  }

  /// Oldest first. Cached locally so chat history stays readable offline.
  Future<List<ChatMessage>> messages(String conversationId) async {
    final key = _messagesKey(conversationId);
    try {
      final res = await _api.get(ApiEndpoints.chatMessages(conversationId));
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: key, data: rawList);
      return rawList.map(ChatMessage.fromJson).toList();
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((e) => ChatMessage.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return const <ChatMessage>[];
    }
  }

  /// Sends a text message. If offline, saves the message in the local thread
  /// cache and enqueues it for delivery when connectivity returns.
  Future<ChatMessage> sendText(String conversationId, String text) async {
    final payload = {
      'conversation_id': conversationId,
      'message_type': 'TEXT',
      'content': text,
    };
    try {
      final res = await _api.post(ApiEndpoints.chatSend, body: payload);
      final map = Map<String, dynamic>.from(res['data'] as Map);
      await _appendMessageToCache(conversationId, map);
      return ChatMessage.fromJson(map);
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;

      final localId = Uuid.v4();
      final localMap = <String, dynamic>{
        'id': localId,
        'conversation_id': conversationId,
        'sender_id': AuthState.userId,
        'message_type': 'TEXT',
        'content': text,
        'media_url': null,
        'is_read': false,
        'created_at': DateTime.now().toUtc().toIso8601String(),
      };
      await _appendMessageToCache(conversationId, localMap);
      await _cache.enqueueOperation(
        operationId: localId,
        patientId: AuthState.patientId ?? '',
        operationType: 'CHAT_SEND_TEXT',
        endpoint: ApiEndpoints.chatSend,
        httpMethod: 'POST',
        payload: payload,
      );
      SyncEngine.instance.status.value =
          SyncEngine.instance.status.value.copyWith(isOnline: false);
      return ChatMessage.fromJson(localMap);
    }
  }

  Future<ChatMessage> sendAudio(String conversationId, String mediaUrl) async {
    final res = await _api.post(ApiEndpoints.chatSend, body: {
      'conversation_id': conversationId,
      'message_type': 'AUDIO',
      'media_url': mediaUrl,
    });
    final map = Map<String, dynamic>.from(res['data'] as Map);
    await _appendMessageToCache(conversationId, map);
    return ChatMessage.fromJson(map);
  }

  Future<void> _appendMessageToCache(String conversationId, Map<String, dynamic> msg) async {
    final key = _messagesKey(conversationId);
    final cached = await _cache.getCache(key);
    final list = <Map<String, dynamic>>[];
    if (cached != null && cached.data is List) {
      for (final item in cached.data as List) {
        if (item is Map) list.add(Map<String, dynamic>.from(item));
      }
    }
    list.add(msg);
    await _cache.putCache(cacheKey: key, data: list);
  }
}