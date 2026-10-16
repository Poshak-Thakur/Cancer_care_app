import 'package:flutter/material.dart';
import '../localization/strings.dart';
import '../theme/app_colors.dart';
import 'buttons.dart';

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Padding(
      padding: EdgeInsets.symmetric(vertical: 60),
      child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)),
    );
  }
}

class ErrorView extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const ErrorView({super.key, required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 8),
      child: Column(
        children: [
          const Icon(Icons.info_outline, color: AppColors.error, size: 30),
          const SizedBox(height: 10),
          Text(message, textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
          const SizedBox(height: 16),
          SecondaryButton(label: S.t('retry'), onPressed: onRetry),
        ],
      ),
    );
  }
}
