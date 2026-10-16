import 'package:flutter/material.dart';
import '../theme/app_colors.dart';
import 'cancer_care_logo.dart';

/// Small logo for headers. [size] is the height; [color] is kept so existing
/// calls still compile (the logo has its own colours).
Widget saathiLogo({
  double size = 26,
  Color color = AppColors.primary,
}) {
  return CancerCareLogo(height: size);
}
