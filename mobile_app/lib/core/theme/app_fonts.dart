/// The three Saathi typefaces (bundled in assets/fonts, declared in pubspec.yaml).
///
///  * [heading] Bodoni Moda: headings and titles.
///  * [label]   Cinzel: small labels and eyebrows (set them in UPPERCASE).
///  * [body]    EB Garamond: body text and buttons (the default font of the app).
///
/// None of these fonts has Devanagari letters, so Hindi text is drawn with the
/// phone's own Devanagari font until a Devanagari companion font is added.
class AppFonts {
  AppFonts._();

  static const heading = 'Bodoni Moda';
  static const label = 'Cinzel';
  static const body = 'EB Garamond';

  /// Older name, kept so existing code keeps compiling.
  static const family = body;
}
