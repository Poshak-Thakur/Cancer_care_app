import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../models/care_contact.dart';
import '../models/chat_message.dart';

class ChatService {
  final ApiClient _api = ApiClient.instance;

  /// Assigned NGO staff + linked caregivers.
  Future<List<CareContact>> contacts(String patientId) async {
    final res = await _api.get(ApiEndpoints.chatContacts(patientId));
    final list = (res['data'] as List).map((e) => CareContact.fromJson(e as Map<String, dynamic>)).toList();
    ContactDirectory.remember(list);
    return list;
  }

  /// Opens (or creates) the thread with [participantId].
  Future<ChatThread> openThread({required String patientId, required String participantId}) async {
    final res = await _api.post(ApiEndpoints.chatThread, body: {
      'patient_id': patientId,
      'participant_id': participantId,
    });
    return ChatThread.fromJson(res['data'] as Map<String, dynamic>);
  }

  /// Oldest first. The backend marks the other side's messages as read.
  Future<List<ChatMessage>> messages(String conversationId) async {
    final res = await _api.get(ApiEndpoints.chatMessages(conversationId));
    return (res['data'] as List).map((e) => ChatMessage.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<ChatMessage> sendText(String conversationId, String text) async {
    final res = await _api.post(ApiEndpoints.chatSend, body: {
      'conversation_id': conversationId,
      'message_type': 'TEXT',
      'content': text,
    });
    return ChatMessage.fromJson(res['data'] as Map<String, dynamic>);
  }

  Future<ChatMessage> sendAudio(String conversationId, String mediaUrl) async {
    final res = await _api.post(ApiEndpoints.chatSend, body: {
      'conversation_id': conversationId,
      'message_type': 'AUDIO',
      'media_url': mediaUrl,
    });
    return ChatMessage.fromJson(res['data'] as Map<String, dynamic>);
  }
}
