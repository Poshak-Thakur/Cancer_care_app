class Post {
  final String initial;
  final String name;
  final String time;
  final String body;
  final String? badgeKey;
  final int? likes;

  Post({
    required this.initial,
    required this.name,
    required this.time,
    required this.body,
    this.badgeKey,
    this.likes,
  });
}
