/// Row of POST /api/chat/thread (chatconversation). Exactly two participants.
class ChatThread {
  final String id;
  final String? patientId; // null for a direct NGO helpline conversation
  final String participantOneId;
  final String participantTwoId;

  const ChatThread({
    required this.id,
    this.patientId,
    required this.participantOneId,
    required this.participantTwoId,
  });

  /// The other person in the conversation, from [myUserId]'s point of view.
  String peerOf(String myUserId) => participantOneId == myUserId ? participantTwoId : participantOneId;

  factory ChatThread.fromJson(Map<String, dynamic> j) => ChatThread(
        id: j['id'] as String,
        patientId: j['patient_id'] as String?,
        participantOneId: (j['participant_one_id'] ?? '').toString(),
        participantTwoId: (j['participant_two_id'] ?? '').toString(),
      );
}

class ChatMessage {
  final String id;
  final String conversationId;
  final String senderId;
  final String type; // TEXT | IMAGE | AUDIO | SYSTEM
  final String? content;
  final String? mediaUrl;
  final bool isRead;
  final DateTime createdAt; // local time

  const ChatMessage({
    required this.id,
    required this.conversationId,
    required this.senderId,
    required this.type,
    required this.content,
    required this.mediaUrl,
    required this.isRead,
    required this.createdAt,
  });

  bool get isAudio => type == 'AUDIO' && (mediaUrl ?? '').isNotEmpty;

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
        id: j['id'] as String,
        conversationId: j['conversation_id'] as String,
        senderId: j['sender_id'] as String,
        type: (j['message_type'] as String?) ?? 'TEXT',
        content: j['content'] as String?,
        mediaUrl: j['media_url'] as String?,
        isRead: (j['is_read'] as bool?) ?? false,
        createdAt: DateTime.parse(j['created_at'] as String).toLocal(),
      );
}

/// One row of GET /api/chat/conversations: the thread, both participants and
/// the latest message.
class ConversationSummary {
  final ChatThread thread;
  final Map<String, String> _names; // user id -> name from the account
  final ChatMessage? last;

  /// Number of unread messages from the other person (GET /api/chat/conversations
  /// `unread_count`). Null when the backend does not send it yet.
  final int? unreadCount;

  /// The patient this conversation is about (`patient.full_name`); null for a
  /// direct helpline thread or an older backend.
  final String? patientName;

  const ConversationSummary({
    required this.thread,
    required Map<String, String> names,
    required this.last,
    this.unreadCount,
    this.patientName,
  }) : _names = names;

  String? accountNameOf(String userId) => _names[userId];

  /// True when the newest message came from the other person and is unread.
  bool unreadFor(String myUserId) {
    if (unreadCount != null) return unreadCount! > 0;
    return last != null && last!.senderId != myUserId && !last!.isRead;
  }

  /// How many to show on the badge (at least 1 when [unreadFor] is true).
  int unreadBadge(String myUserId) => unreadCount ?? (unreadFor(myUserId) ? 1 : 0);

  DateTime get sortTime => last?.createdAt ?? DateTime.fromMillisecondsSinceEpoch(0);

  factory ConversationSummary.fromJson(Map<String, dynamic> j) {
    String nameOf(dynamic u) {
      if (u is! Map) return '';
      final full = (u['full_name'] as String?)?.trim() ?? '';
      if (full.isNotEmpty) return full;
      final email = (u['email'] as String?) ?? '';
      final at = email.indexOf('@');
      return at > 0 ? email.substring(0, at) : email;
    }

    final names = <String, String>{};
    for (final key in const ['participant_one', 'participant_two']) {
      final u = j[key];
      if (u is Map && u['id'] != null) names[u['id'].toString()] = nameOf(u);
    }
    final msgs = j['messages'];
    final rawCount = j['unread_count'];
    final patient = j['patient'];
    final patientName = patient is Map ? (patient['full_name'] as String?)?.trim() : null;
    return ConversationSummary(
      unreadCount: rawCount is num ? rawCount.toInt() : int.tryParse('${rawCount ?? ''}'),
      patientName: (patientName == null || patientName.isEmpty) ? null : patientName,
      thread: ChatThread.fromJson(j),
      names: names,
      last: msgs is List && msgs.isNotEmpty ? ChatMessage.fromJson(Map<String, dynamic>.from(msgs.first as Map)) : null,
    );
  }
}
