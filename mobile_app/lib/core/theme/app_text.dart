import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_fonts.dart';

/// Text styles of the app. Screens should prefer `Theme.of(context).textTheme`
/// (built from these) or these constants over hand-made TextStyles.
class AppText {
  AppText._();

  // Health data (doses, dates, pain scores) must never show old-style figures.
  static const _lining = <FontFeature>[FontFeature.liningFigures()];

  /// Headings and titles: Bodoni Moda.
  static const heading = TextStyle(
    fontFamily: AppFonts.heading,
    fontWeight: FontWeight.w600,
    color: AppColors.ink,
    height: 1.2,
    fontFeatures: _lining,
  );

  /// Small labels and eyebrows: Cinzel. Write the text in UPPERCASE.
  static const eyebrow = TextStyle(
    fontFamily: AppFonts.label,
    fontWeight: FontWeight.w600,
    fontSize: 12,
    letterSpacing: 1.3,
    color: AppColors.inkFaint,
    fontFeatures: _lining,
  );

  /// Body text and buttons: EB Garamond.
  static const body = TextStyle(
    fontFamily: AppFonts.body,
    fontWeight: FontWeight.w400,
    fontSize: 16.5,
    height: 1.4,
    color: AppColors.ink,
    fontFeatures: _lining,
  );

  /// The Material text theme: Bodoni Moda for display/headline/titleLarge,
  /// Cinzel for the two small label sizes, EB Garamond for everything else.
  static TextTheme get textTheme => const TextTheme(
        displayLarge: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 48, height: 1.1),
        displayMedium: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 40, height: 1.12),
        displaySmall: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 34, height: 1.15),
        headlineLarge: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 30, height: 1.18),
        headlineMedium: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 26, height: 1.2),
        headlineSmall: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 22, height: 1.2),
        titleLarge: TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.w600, fontSize: 21, height: 1.2),
        titleMedium: TextStyle(fontFamily: AppFonts.body, fontWeight: FontWeight.w600, fontSize: 18, height: 1.3),
        titleSmall: TextStyle(fontFamily: AppFonts.body, fontWeight: FontWeight.w600, fontSize: 16, height: 1.3),
        bodyLarge: TextStyle(fontFamily: AppFonts.body, fontWeight: FontWeight.w400, fontSize: 18, height: 1.4),
        bodyMedium: TextStyle(fontFamily: AppFonts.body, fontWeight: FontWeight.w400, fontSize: 16.5, height: 1.4),
        bodySmall: TextStyle(fontFamily: AppFonts.body, fontWeight: FontWeight.w400, fontSize: 14, height: 1.35),
        labelLarge: TextStyle(fontFamily: AppFonts.body, fontWeight: FontWeight.w600, fontSize: 17),
        labelMedium: TextStyle(fontFamily: AppFonts.label, fontWeight: FontWeight.w600, fontSize: 12, letterSpacing: 1.2),
        labelSmall: TextStyle(fontFamily: AppFonts.label, fontWeight: FontWeight.w600, fontSize: 11, letterSpacing: 1.2),
      ).apply(bodyColor: AppColors.ink, displayColor: AppColors.ink);
}
