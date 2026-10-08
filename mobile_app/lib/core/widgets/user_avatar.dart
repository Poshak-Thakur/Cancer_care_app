import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

/// Round avatar: the person's photo when there is one, otherwise their initial.
class UserAvatar extends StatelessWidget {
  final String? url;
  final String initial;
  final double radius;
  final bool teal;

  const UserAvatar({super.key, this.url, required this.initial, this.radius = 22, this.teal = false});

  @override
  Widget build(BuildContext context) {
    final letter = initial.isEmpty ? '?' : initial[0].toUpperCase();
    final bg = teal ? AppColors.primaryLight : AppColors.roseLight;
    final fg = teal ? AppColors.primaryDeep : AppColors.roseText;
    final fallback = CircleAvatar(
      radius: radius,
      backgroundColor: bg,
      child: Text(letter, style: TextStyle(fontWeight: FontWeight.bold, fontSize: radius * 0.8, color: fg)),
    );
    if (url == null || url!.isEmpty) return fallback;
    return ClipOval(
      child: SizedBox(
        width: radius * 2,
        height: radius * 2,
        child: Image.network(
          url!,
          fit: BoxFit.cover,
          errorBuilder: (_, __, ___) => fallback,
          loadingBuilder: (c, child, p) => p == null ? child : fallback,
        ),
      ),
    );
  }
}
