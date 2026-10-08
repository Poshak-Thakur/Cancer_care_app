import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../models/call_models.dart';

class CallService {
  final ApiClient _api = ApiClient.instance;

  /// [callType]: VIDEO | AUDIO. The backend also rings the receiver over the socket.
  Future<OutgoingCall> initiate({
    required String receiverId,
    String? patientId, // null only for a direct call to the NGO helpline
    String callType = 'VIDEO',
  }) async {
    final res = await _api.post(ApiEndpoints.callInitiate, body: {
      'receiver_id': receiverId,
      if (patientId != null) 'patient_id': patientId,
      'call_type': callType,
    });
    return OutgoingCall.fromJson(res['data'] as Map<String, dynamic>);
  }

  /// [status]: ONGOING | REJECTED | COMPLETED | MISSED
  /// GET /api/calls/incoming: calls started for this user in the last 120
  /// seconds that nobody has answered yet. Returns the raw rows (id, status,
  /// call_type, caller...). Useful to detect a ring the socket missed; the
  /// live ring itself (with the Agora token) comes from the socket or push.
  Future<List<Map<String, dynamic>>> incoming() async {
    final res = await _api.get(ApiEndpoints.callsIncoming);
    return ((res['data'] as List?) ?? const []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
  }

  Future<void> updateStatus(String callId, String status) async {
    await _api.patch(ApiEndpoints.callStatus(callId), body: {'status': status});
  }
}
