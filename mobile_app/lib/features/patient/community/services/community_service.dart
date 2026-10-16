import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/storage/local_offline_storage.dart';
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
  final LocalOfflineStore _cache = LocalOfflineStore.instance;

  static const _feedCacheKey = 'community_feed';
  static String _commentsCacheKey(String postId) => 'community_comments_$postId';

  /// GET /api/community/feed: approved public posts, newest first (cached for offline reading).
  Future<List<Post>> feed() async {
    try {
      final res = await _api.get(ApiEndpoints.communityFeed);
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: _feedCacheKey, data: rawList);
      return rawList.map(Post.fromJson).toList();
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(_feedCacheKey);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((e) => Post.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return const <Post>[];
    }
  }

  /// POST /api/community/posts (multipart; up to 5 files under 'media').
  Future<({String message, String status})> createPost({
    required String content,
    String visibility = 'PUBLIC',
    List<PostMedia> media = const [],
  }) async {
    final hasVideo = media.any((m) => isVideoUrl(m.filename));
    final type = media.isEmpty ? 'TEXT' : (hasVideo ? 'VIDEO' : 'IMAGE');
    final res = await _api.postMultipartFiles(
      ApiEndpoints.communityPosts,
      fields: {
        'content': content,
        'post_type': type,
        'visibility': visibility,
      },
      files: [
        for (final m in media)
          UploadFile(
            field: 'media',
            bytes: m.bytes,
            filename: m.filename,
            contentType: mediaTypeFor(m.filename),
          ),
      ],
      timeout: const Duration(seconds: 180),
    );
    final data = res['data'] as Map?;
    return (
      message: (res['message'] as String?) ?? '',
      status: (data?['status'] as String?) ?? 'PENDING',
    );
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
    final key = _commentsCacheKey(postId);
    try {
      final res = await _api.get(ApiEndpoints.postComments(postId));
      final rawList = (res['data'] as List)
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList();
      await _cache.putCache(cacheKey: key, data: rawList);
      return rawList.map(PostComment.fromJson).toList();
    } on ApiException catch (e) {
      if (e.statusCode != null) rethrow;
      final cached = await _cache.getCache(key);
      if (cached != null && cached.data is List) {
        return (cached.data as List)
            .map((e) => PostComment.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return const <PostComment>[];
    }
  }

  /// POST /api/community/poll/:optionId/vote (one vote per poll).
  Future<void> vote(String optionId) async {
    await _api.post(ApiEndpoints.pollVote(optionId));
  }
}