import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_fonts.dart';
import 'app_text.dart';

/// The one ThemeData of the app: Saathi colours and typefaces.
/// Screens get their look from here; do not hard-code colours or font families.
class AppTheme {
  AppTheme._();

  static const _radius = 14.0;

  static const ColorScheme colorScheme = ColorScheme(
    brightness: Brightness.light,
    primary: AppColors.teal,
    onPrimary: AppColors.warmWhite,
    primaryContainer: AppColors.tealLight,
    onPrimaryContainer: AppColors.tealDeep,
    primaryFixed: AppColors.tealLight,
    primaryFixedDim: AppColors.teal,
    onPrimaryFixed: AppColors.tealAbyss,
    onPrimaryFixedVariant: AppColors.tealDeep,
    secondary: AppColors.sageDark,
    onSecondary: AppColors.warmWhite,
    secondaryContainer: AppColors.sageLight,
    onSecondaryContainer: AppColors.sageDark,
    tertiary: AppColors.ochre,
    onTertiary: AppColors.inkDeep,
    tertiaryContainer: AppColors.ochreLight,
    onTertiaryContainer: AppColors.ochreDark,
    error: AppColors.red,
    onError: AppColors.warmWhite,
    errorContainer: AppColors.redLight,
    onErrorContainer: AppColors.red,
    surface: AppColors.cream,
    onSurface: AppColors.ink,
    onSurfaceVariant: AppColors.inkSoft,
    surfaceDim: AppColors.creamDeep,
    surfaceBright: AppColors.warmWhite,
    surfaceContainerLowest: AppColors.warmWhite,
    surfaceContainerLow: AppColors.cream,
    surfaceContainer: AppColors.creamDeep,
    surfaceContainerHigh: AppColors.creamDeep,
    surfaceContainerHighest: AppColors.creamDeep,
    outline: AppColors.inkFaint,
    outlineVariant: Color(0x1F2C2721), // ink at 12 %
    shadow: AppColors.inkDeep,
    scrim: AppColors.inkDeep,
    inverseSurface: AppColors.tealDeep,
    onInverseSurface: AppColors.warmWhite,
    inversePrimary: AppColors.tealLight,
    surfaceTint: Colors.transparent, // no tinted overlays on cards and sheets
  );

  static RoundedRectangleBorder get _shape => RoundedRectangleBorder(borderRadius: BorderRadius.circular(_radius));

  static ThemeData get theme {
    final text = AppText.textTheme;
    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: AppColors.cream,
      canvasColor: AppColors.cream,
      primaryColor: AppColors.teal,
      fontFamily: AppFonts.body,
      textTheme: text,
      primaryTextTheme: text,
      iconTheme: const IconThemeData(color: AppColors.inkSoft),
      dividerTheme: DividerThemeData(color: AppColors.ink.withOpacity(0.10), space: 1, thickness: 1),
      splashFactory: InkRipple.splashFactory,
      appBarTheme: AppBarTheme(
        backgroundColor: AppColors.cream,
        foregroundColor: AppColors.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0,
        centerTitle: false,
        titleTextStyle: text.titleLarge,
        iconTheme: const IconThemeData(color: AppColors.ink),
      ),
      cardTheme: CardThemeData(
        color: AppColors.creamDeep,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: const EdgeInsets.only(bottom: 14),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(_radius),
          side: BorderSide(color: AppColors.ink.withOpacity(0.06)),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.teal,
          foregroundColor: AppColors.warmWhite,
          disabledBackgroundColor: AppColors.teal.withOpacity(0.35),
          disabledForegroundColor: AppColors.warmWhite,
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
          shape: _shape,
          textStyle: text.labelLarge,
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.teal,
          foregroundColor: AppColors.warmWhite,
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
          shape: _shape,
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.teal,
          side: const BorderSide(color: AppColors.teal, width: 1.5),
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 13),
          shape: _shape,
          textStyle: text.labelLarge,
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: AppColors.teal,
          textStyle: text.labelLarge,
        ),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AppColors.teal,
        foregroundColor: AppColors.warmWhite,
      ),
      dialogTheme: DialogThemeData(
        backgroundColor: AppColors.warmWhite,
        surfaceTintColor: Colors.transparent,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        titleTextStyle: text.headlineSmall,
        contentTextStyle: text.bodyMedium,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: AppColors.warmWhite,
        surfaceTintColor: Colors.transparent,
        modalBackgroundColor: AppColors.warmWhite,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      ),
      snackBarTheme: SnackBarThemeData(
        backgroundColor: AppColors.tealDeep,
        contentTextStyle: text.bodyMedium?.copyWith(color: AppColors.warmWhite),
        actionTextColor: AppColors.tealLight,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: AppColors.warmWhite,
        selectedItemColor: AppColors.teal,
        unselectedItemColor: AppColors.inkFaint,
        selectedLabelStyle: text.bodySmall?.copyWith(fontWeight: FontWeight.w600),
        unselectedLabelStyle: text.bodySmall,
        type: BottomNavigationBarType.fixed,
        elevation: 0,
      ),
      progressIndicatorTheme: const ProgressIndicatorThemeData(
        color: AppColors.teal,
        linearTrackColor: AppColors.tealLight,
        circularTrackColor: AppColors.tealLight,
      ),
      listTileTheme: ListTileThemeData(
        iconColor: AppColors.inkSoft,
        textColor: AppColors.ink,
        titleTextStyle: text.titleMedium,
        subtitleTextStyle: text.bodyMedium?.copyWith(color: AppColors.inkSoft),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AppColors.creamDeep,
        selectedColor: AppColors.tealLight,
        side: BorderSide(color: AppColors.ink.withOpacity(0.10)),
        labelStyle: text.bodyMedium,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      switchTheme: SwitchThemeData(
        thumbColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.warmWhite : AppColors.inkFaint),
        trackColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.teal : AppColors.creamDeep),
      ),
      checkboxTheme: CheckboxThemeData(
        fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.teal : Colors.transparent),
        checkColor: WidgetStateProperty.all(AppColors.warmWhite),
        side: const BorderSide(color: AppColors.inkFaint, width: 1.6),
      ),
      radioTheme: RadioThemeData(
        fillColor: WidgetStateProperty.resolveWith((s) => s.contains(WidgetState.selected) ? AppColors.teal : AppColors.inkFaint),
      ),
      textSelectionTheme: TextSelectionThemeData(
        cursorColor: AppColors.teal,
        selectionColor: AppColors.teal.withOpacity(0.25),
        selectionHandleColor: AppColors.teal,
      ),
    );
  }
}
