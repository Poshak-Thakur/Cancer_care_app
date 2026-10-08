import 'package:http_parser/http_parser.dart' show MediaType;

/// MIME type from a file name. The backend trusts the multipart content type
/// (it rejects non-audio on voice notes and stores the rest as given), so
/// uploads must say what they are instead of "application/octet-stream".
MediaType mediaTypeFor(String filename) {
  final ext = filename.contains('.') ? filename.split('.').last.toLowerCase() : '';
  switch (ext) {
    case 'png':
      return MediaType('image', 'png');
    case 'webp':
      return MediaType('image', 'webp');
    case 'gif':
      return MediaType('image', 'gif');
    case 'heic':
      return MediaType('image', 'heic');
    case 'pdf':
      return MediaType('application', 'pdf');
    case 'mp4':
      return MediaType('video', 'mp4');
    case 'mov':
      return MediaType('video', 'quicktime');
    case 'm4a':
      return MediaType('audio', 'mp4');
    case 'jpg':
    case 'jpeg':
    default:
      return MediaType('image', 'jpeg');
  }
}

bool isVideoUrl(String url) {
  final path = Uri.tryParse(url)?.path.toLowerCase() ?? url.toLowerCase();
  return path.endsWith('.mp4') || path.endsWith('.mov') || path.endsWith('.webm') || path.endsWith('.mkv') || path.endsWith('.avi');
}
