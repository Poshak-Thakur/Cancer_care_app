import 'package:flutter/material.dart';
import '../constants/app_brand.dart';
import '../theme/app_colors.dart';

/// The Dost - The cancer care companion logo (dragonfly mark),
/// drawn from `assets/images/cancer_care_logo.png` (transparent background).
class CancerCareLogo extends StatelessWidget {
  static const asset = 'assets/images/cancer_care_logo.png';

  /// Width / height of the picture file (1248 x 961).
  static const aspectRatio = 1248 / 961;

  final double height;

  const CancerCareLogo({super.key, this.height = 64});

  @override
  Widget build(BuildContext context) {
    final pixelRatio = MediaQuery.devicePixelRatioOf(context);
    return SizedBox(
      height: height,
      width: height * aspectRatio,
      child: Image.asset(
        asset,
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
        cacheHeight: (height * pixelRatio).round(),
        semanticLabel: AppBrand.fullName,
        errorBuilder: (_, __, ___) => Icon(Icons.spa_outlined, size: height, color: AppColors.teal),
      ),
    );
  }
}