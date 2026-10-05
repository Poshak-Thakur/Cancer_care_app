import '../../../../core/constants/api_endpoints.dart';
import '../../../../core/network/api_client.dart';
import '../models/post.dart';

class CommunityService {
  final ApiClient _api = ApiClient.instance;

  /// Approved public posts only, newest first.
  Future<List<CommunityPost>> feed() async {
    final res = await _api.get(ApiEndpoints.communityFeed);
    return (res['data'] as List).map((e) => CommunityPost.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// [visibility]: PUBLIC (needs NGO approval before it shows) or PRIVATE
  /// (hidden from the community, shared with the assigned NGO counsellor).
  Future<CreatedPost> create({required String content, required String visibility}) async {
    final res = await _api.post(ApiEndpoints.communityPosts, body: {
      'content': content,
      'visibility': visibility,
    });
    return CreatedPost(CommunityPost.fromJson(res['data'] as Map<String, dynamic>), res['message'] as String?);
  }
}
