import 'package:flutter/material.dart';
import '../theme/app_colors.dart';

class SaathiCard extends StatelessWidget {
  final Widget child;
  final bool rose;
  final VoidCallback? onTap;
  final EdgeInsetsGeometry padding;

  const SaathiCard({
    super.key,
    required this.child,
    this.rose = false,
    this.onTap,
    this.padding = const EdgeInsets.all(16),
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      color: rose ? AppColors.roseLight : AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(14),
        side: rose ? BorderSide.none : BorderSide(color: AppColors.ink.withOpacity(0.06)),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(padding: padding, child: child),
      ),
    );
  }
}
