class PollOption {
  final String id;
  final String text;
  final int votes;
  final bool votedByMe;
  const PollOption({required this.id, required this.text, required this.votes, this.votedByMe = false});

  factory PollOption.fromJson(Map<String, dynamic> j) => PollOption(
        id: j['id'].toString(),
        text: (j['option'] ?? j['option_text'] ?? j['text'] ?? '').toString(),
        votedByMe: j['voted_by_me'] == true,
        votes: ((j['votes_count'] ?? j['vote_count'] ?? j['votes'] ?? 0) as num).toInt(),
      );
}

class Post {
  final String id;
  final String authorId;
  final String authorName;
  final String? authorAvatar;
  final String content;
  final String postType; // TEXT | IMAGE | VIDEO | POLL ...
  final List<String> mediaUrls;
  final DateTime createdAt;
  final String status; // PENDING | APPROVED | REJECTED
  final int likes;
  final int comments;
  final bool likedByMe;
  final List<PollOption> pollOptions;
  final String? myVoteOptionId;

  const Post({
    required this.id,
    required this.authorId,
    required this.authorName,
    required this.authorAvatar,
    required this.content,
    required this.postType,
    required this.mediaUrls,
    required this.createdAt,
    required this.status,
    required this.likes,
    required this.comments,
    required this.likedByMe,
    required this.pollOptions,
    required this.myVoteOptionId,
  });

  bool get isPoll => pollOptions.isNotEmpty;
  bool get isPending => status == 'PENDING';
  int get totalVotes => pollOptions.fold(0, (a, o) => a + o.votes);

  Post copyWith({int? likes, int? comments, bool? likedByMe, List<PollOption>? pollOptions, String? myVoteOptionId}) => Post(
        id: id,
        authorId: authorId,
        authorName: authorName,
        authorAvatar: authorAvatar,
        content: content,
        postType: postType,
        mediaUrls: mediaUrls,
        createdAt: createdAt,
        status: status,
        likes: likes ?? this.likes,
        comments: comments ?? this.comments,
        likedByMe: likedByMe ?? this.likedByMe,
        pollOptions: pollOptions ?? this.pollOptions,
        myVoteOptionId: myVoteOptionId ?? this.myVoteOptionId,
      );

  /// Tolerant of the several shapes the feed/create endpoints may return.
  factory Post.fromJson(Map<String, dynamic> j) {
    int count(String flat, String relation) {
      final v = j[flat];
      if (v is num) return v.toInt();
      final c = j['_count'];
      if (c is Map && c[relation] is num) return (c[relation] as num).toInt();
      return 0;
    }

    final author = j['author'] ?? j['useraccount'];
    String name = (j['author_name'] as String?) ?? '';
    String? avatar = j['author_avatar'] as String?;
    if (author is Map) {
      if (name.isEmpty) name = ((author['full_name'] as String?) ?? '').trim();
      if (name.isEmpty) {
        final e = (author['email'] as String?) ?? '';
        name = e.contains('@') ? e.split('@').first : e;
      }
      avatar ??= author['avatar_url'] as String?;
    }

    final media = j['media_urls'] ?? j['media'];
    final options = j['poll_options'] ?? j['polloption'] ?? j['options'];

    return Post(
      id: j['id'].toString(),
      authorId: (j['author_id'] ?? j['user_id'] ?? '').toString(),
      authorName: name,
      authorAvatar: avatar,
      content: (j['content'] as String?) ?? '',
      postType: (j['post_type'] as String?) ?? 'TEXT',
      mediaUrls: media is List ? media.map((e) => e is Map ? (e['url'] ?? e['media_url'] ?? '').toString() : e.toString()).where((e) => e.isNotEmpty).toList() : const [],
      createdAt: DateTime.tryParse((j['created_at'] as String?) ?? '') ?? DateTime.now(),
      status: (j['moderation_status'] ?? j['status'] ?? 'APPROVED').toString(),
      likes: count('likes_count', 'postlike'),
      comments: count('comments_count', 'postcomment'),
      likedByMe: (j['is_liked_by_me'] ?? j['liked_by_me'] ?? j['liked'] ?? false) == true,
      pollOptions: options is List ? options.map((e) => PollOption.fromJson(Map<String, dynamic>.from(e as Map))).toList() : const [],
      myVoteOptionId: () {
        if (options is! List) return null;
        for (final o in options) {
          if (o is Map && o['voted_by_me'] == true) return o['id'].toString();
        }
        return null;
      }(),
    );
  }
}

class PostComment {
  final String id;
  final String authorName;
  final String? authorAvatar;
  final String content;
  final DateTime createdAt;
  const PostComment({required this.id, required this.authorName, required this.authorAvatar, required this.content, required this.createdAt});

  factory PostComment.fromJson(Map<String, dynamic> j) {
    final a = j['author'] ?? j['user'];
    String name = (j['author_name'] as String?) ?? '';
    String? avatar = j['author_avatar'] as String?;
    if (a is Map) {
      if (name.isEmpty) name = ((a['full_name'] as String?) ?? '').trim();
      if (name.isEmpty) {
        final e = (a['email'] as String?) ?? '';
        name = e.contains('@') ? e.split('@').first : e;
      }
      avatar ??= a['avatar_url'] as String?;
    }
    return PostComment(
      id: j['id'].toString(),
      authorName: name,
      authorAvatar: avatar,
      content: (j['content'] as String?) ?? '',
      createdAt: DateTime.tryParse((j['created_at'] as String?) ?? '') ?? DateTime.now(),
    );
  }
}
