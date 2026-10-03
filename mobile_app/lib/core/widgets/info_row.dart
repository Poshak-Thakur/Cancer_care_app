import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import 'card_icon_box.dart';

class InfoRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final bool rose;
  final Widget? trailing;

  const InfoRow({
    super.key,
    required this.icon,
    required this.title,
    required this.subtitle,
    this.rose = false,
    this.trailing,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        CardIconBox(icon, rose: rose),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5, color: AppColors.ink),
              ),
              const SizedBox(height: 1),
              Text(
                subtitle,
                style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
              ),
            ],
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}
