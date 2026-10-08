import 'dart:io';
import 'package:http_parser/http_parser.dart' show MediaType;
import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';

class MediaUploadService {
  /// Uploads a recorded voice note and returns its signed playback URL.
  /// Goes through [ApiClient], so an expired access token is refreshed first.
  Future<String> uploadVoiceNote(File file, {required String conversationId}) async {
    final bytes = await file.readAsBytes();
    final name = file.path.split(Platform.pathSeparator).last;
    final res = await ApiClient.instance.postMultipart(
      ApiEndpoints.chatUploadAudio,
      fields: {'conversation_id': conversationId},
      fileBytes: bytes,
      filename: name,
      fileField: 'audio', // the field name multer expects on /api/chat/upload-audio
      contentType: MediaType('audio', 'mp4'), // .m4a (AAC); without it the server stores octet-stream
    );
    final url = (res['data'] as Map?)?['media_url'] as String?;
    if (url == null || url.isEmpty) {
      throw const ApiException('Voice note upload failed. Please try again.');
    }
    return url;
  }
}
