import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class CheckRow extends StatelessWidget {
  final String label;
  final bool done;
  final VoidCallback onTap;

  const CheckRow({
    super.key,
    required this.label,
    required this.done,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: done ? AppColors.positive : Colors.transparent,
                border: Border.all(color: done ? AppColors.positive : AppColors.textFaint, width: 2),
                borderRadius: BorderRadius.circular(7),
              ),
              child: done ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
            ),
            const SizedBox(width: 12),
            Text(
              label,
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: done ? AppColors.textFaint : AppColors.ink,
                decoration: done ? TextDecoration.lineThrough : TextDecoration.none,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
