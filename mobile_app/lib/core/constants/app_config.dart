/// Build-time configuration, passed with --dart-define. Example:
///   flutter run \
///     --dart-define=API_BASE_URL=http://192.168.1.10:3000 \
///     --dart-define=SUPABASE_URL=https://xxxx.supabase.co \
///     --dart-define=SUPABASE_ANON_KEY=xxxx \
///     --dart-define=SUPABASE_BUCKET=chat-media
///
/// The Agora App ID is no longer needed here: the backend returns it with every
/// call (`appId`), both when you start a call and in the `incomingCall` event.
class AppConfig {
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');
  static const supabaseBucket = String.fromEnvironment('SUPABASE_BUCKET', defaultValue: 'chat-media');

  static bool get voiceUploadConfigured => supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;
}
