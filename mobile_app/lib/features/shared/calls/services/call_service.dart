import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../models/call_models.dart';

class CallService {
  final ApiClient _api = ApiClient.instance;

  /// [callType]: VIDEO | AUDIO. The backend also rings the receiver over the socket.
  Future<OutgoingCall> initiate({
    required String receiverId,
    required String patientId,
    String callType = 'VIDEO',
  }) async {
    final res = await _api.post(ApiEndpoints.callInitiate, body: {
      'receiver_id': receiverId,
      'patient_id': patientId, // mandatory: the backend rejects calls without it (403)
      'call_type': callType,
    });
    return OutgoingCall.fromJson(res['data'] as Map<String, dynamic>);
  }

  /// [status]: ONGOING | REJECTED | COMPLETED | MISSED
  Future<void> updateStatus(String callId, String status) async {
    await _api.patch(ApiEndpoints.callStatus(callId), body: {'status': status});
  }
}
