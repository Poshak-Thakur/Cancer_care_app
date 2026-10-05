import 'package:flutter/material.dart';
import '../../../core/theme/app_colors.dart';

class AvatarWidget extends StatelessWidget {
  final String letter;
  final bool tealVariant;
  const AvatarWidget(this.letter, {super.key, this.tealVariant = false});

  @override
  Widget build(BuildContext context) {
    return CircleAvatar(
      radius: 19,
      backgroundColor: tealVariant ? AppColors.primaryLight : AppColors.roseLight,
      child: Text(
        letter,
        style: TextStyle(
          fontWeight: FontWeight.bold,
          fontSize: 14,
          color: tealVariant ? AppColors.primaryDeep : AppColors.roseText,
        ),
      ),
    );
  }
}
