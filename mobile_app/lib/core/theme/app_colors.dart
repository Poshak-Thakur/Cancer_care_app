import 'package:flutter/material.dart';

/// The Saathi brand palette. Every colour in the app comes from here.
///
/// Use the SEMANTIC names (primary, error, surface, ...) in screens; use the
/// brand names (teal, ochre, sage, ...) when you really mean that brand colour.
class AppColors {
  AppColors._();

  // ---------------------------------------------------------------- brand
  /// Primary brand colour.
  static const teal = Color(0xFF1C6B77);

  /// Dark background (call screens, splash).
  static const tealDeep = Color(0xFF0E3E45);

  /// Deepest dark.
  static const tealAbyss = Color(0xFF0A2F35);

  /// Page background.
  static const cream = Color(0xFFFBF8F0);

  /// Card background.
  static const creamDeep = Color(0xFFF4EFE2);

  /// Dialogs, sheets and bars that sit above the page.
  static const warmWhite = Color(0xFFFAF7F0);

  /// Main text.
  static const ink = Color(0xFF2C2721);

  /// Secondary text.
  static const inkSoft = Color(0xFF5D564D);

  /// Labels and placeholders.
  static const inkFaint = Color(0xFF70695F);

  /// Near black.
  static const inkDeep = Color(0xFF0F1415);

  /// Error / danger.
  static const red = Color(0xFF9C2727);

  /// Gold / yellow accent (fills, icons, borders).
  static const ochre = Color(0xFFB4914F);

  /// Text on ochre-tinted surfaces; also the readable "warning" colour.
  static const ochreDark = Color(0xFF826839);

  /// Pink accent.
  static const rose = Color(0xFFB3837E);

  /// Text on rose-tinted surfaces.
  static const roseDark = Color(0xFF886460);

  /// Green accent.
  static const sage = Color(0xFF7F9070);

  /// Text on sage-tinted surfaces.
  static const sageDark = Color(0xFF637057);

  /// Strong green (success, done, verified).
  static const leafGreen = Color(0xFF3F6B45);

  // ---------------------------------------------------------------- derived tints
  // Light backgrounds for badges and banners. These are NOT in the brand list;
  // they are pale versions of the brand colours above.
  static const tealLight = Color(0xFFD9E9EA);
  static const roseLight = Color(0xFFEFE2DE);
  static const sageLight = Color(0xFFEEF1E8);
  static const ochreLight = Color(0xFFF3EBDA);
  static const redLight = Color(0xFFF3E0E0);

  // ---------------------------------------------------------------- semantic names (use these in screens)
  static const bg = cream;
  static const surface = creamDeep;
  static const primary = teal;
  static const primaryDeep = tealDeep;
  static const primaryLight = tealLight;
  static const textPrimary = ink;
  static const textSecondary = inkSoft;
  static const textFaint = inkFaint;
  static const roseText = roseDark;
  static const positive = leafGreen;

  /// Errors, destructive actions, danger.
  static const error = red;

  /// Cautions that are not errors (needs attention, waiting).
  static const warning = ochreDark;
}
