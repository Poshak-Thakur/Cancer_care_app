/// Payload of the socket event `incomingCall`.
class IncomingCall {
  final String callId;
  final String callerId;
  final String callerName; // sent by the backend; may be empty
  final String callType; // VIDEO | AUDIO
  final String channelName;
  final String? token;
  final String appId;

  const IncomingCall({
    required this.callId,
    required this.callerId,
    required this.callType,
    required this.channelName,
    required this.appId,
    this.callerName = '',
    this.token,
  });

  bool get isVideo => callType != 'AUDIO';

  /// Used for the socket event `incomingCall` and for the Firebase push
  /// (`CALL_INVITATION`), which carry the same keys. Push values are all strings.
  factory IncomingCall.fromJson(Map<String, dynamic> j) => IncomingCall(
        callId: j['call_id'].toString(),
        callerId: j['caller_id'].toString(),
        callerName: (j['caller_name'] as String?) ?? '',
        callType: (j['call_type'] as String?) ?? 'VIDEO',
        channelName: j['channelName'].toString(),
        token: j['token'] as String?,
        appId: (j['appId'] as String?) ?? '',
      );

  Map<String, dynamic> toJson() => {
        'call_id': callId,
        'caller_id': callerId,
        'caller_name': callerName,
        'call_type': callType,
        'channelName': channelName,
        'token': token ?? '',
        'appId': appId,
      };
}

/// Payload of the socket event `callStatusUpdated`.
class CallStatusUpdate {
  final String callId;
  final String status; // ONGOING | REJECTED | COMPLETED | MISSED

  const CallStatusUpdate({required this.callId, required this.status});

  factory CallStatusUpdate.fromJson(Map<String, dynamic> j) =>
      CallStatusUpdate(callId: j['call_id'] as String, status: j['status'] as String);
}

/// Response of POST /api/calls/initiate.
class OutgoingCall {
  final String callId;
  final String channelName; // provider_room
  final String? token;
  final String appId;
  final String callType;

  const OutgoingCall({
    required this.callId,
    required this.channelName,
    required this.callType,
    required this.appId,
    this.token,
  });

  factory OutgoingCall.fromJson(Map<String, dynamic> j) => OutgoingCall(
        callId: j['id'] as String,
        channelName: j['provider_room'] as String,
        token: j['token'] as String?,
        appId: (j['appId'] as String?) ?? '',
        callType: (j['call_type'] as String?) ?? 'VIDEO',
      );
}
