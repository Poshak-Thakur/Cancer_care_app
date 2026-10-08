import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/utils/media.dart';
import '../models/post.dart';

/// A file picked for a post.
class PostMedia {
  final List<int> bytes;
  final String filename;
  const PostMedia(this.bytes, this.filename);
}

class CommunityService {
  final ApiClient _api = ApiClient.instance;

  /// GET /api/community/feed: approved public posts, newest first (max 50).
  Future<List<Post>> feed() async {
    final res = await _api.get(ApiEndpoints.communityFeed);
    return (res['data'] as List).map((e) => Post.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  }

  /// POST /api/community/posts (multipart; up to 5 files under 'media').
  /// Regular users' posts are PENDING until a moderator approves them.
  /// [visibility] PUBLIC or PRIVATE (private = shared only with the NGO
  /// counsellor, never in the feed). Returns the backend's message and status.
  Future<({String message, String status})> createPost({
    required String content,
    String visibility = 'PUBLIC',
    List<PostMedia> media = const [],
  }) async {
    // The backend ties media to the post type: IMAGE -> image/*, VIDEO ->
    // video/*, TEXT -> no files. Photos and a video are never mixed.
    final hasVideo = media.any((m) => isVideoUrl(m.filename));
    final type = media.isEmpty ? 'TEXT' : (hasVideo ? 'VIDEO' : 'IMAGE');
    final res = await _api.postMultipartFiles(
      ApiEndpoints.communityPosts,
      fields: {
        'content': content,
        'post_type': type,
        'visibility': visibility,
      },
      files: [for (final m in media) UploadFile(field: 'media', bytes: m.bytes, filename: m.filename, contentType: mediaTypeFor(m.filename))],
      timeout: const Duration(seconds: 180),
    );
    final data = res['data'] as Map?;
    return (message: (res['message'] as String?) ?? '', status: (data?['status'] as String?) ?? 'PENDING');
  }

  /// POST /api/community/posts/:id/like (toggles). Returns the new state.
  Future<bool> toggleLike(String postId) async {
    final res = await _api.post(ApiEndpoints.postLike(postId));
    return res['is_liked'] == true;
  }

  Future<void> addComment(String postId, String content) async {
    await _api.post(ApiEndpoints.postComment(postId), body: {'content': content});
  }

  Future<List<PostComment>> comments(String postId) async {
    final res = await _api.get(ApiEndpoints.postComments(postId));
    return (res['data'] as List).map((e) => PostComment.fromJson(Map<String, dynamic>.from(e as Map))).toList();
  }

  /// POST /api/community/poll/:optionId/vote (one vote per poll).
  Future<void> vote(String optionId) async {
    await _api.post(ApiEndpoints.pollVote(optionId));
  }
}
