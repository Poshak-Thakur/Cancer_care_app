import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class CardIconBox extends StatelessWidget {
  final IconData icon;
  final bool rose;
  const CardIconBox(this.icon, {super.key, this.rose = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 44,
      height: 44,
      decoration: BoxDecoration(
        color: rose ? Colors.white : AppColors.primaryLight,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(icon, color: rose ? AppColors.roseText : AppColors.primary, size: 22),
    );
  }
}
