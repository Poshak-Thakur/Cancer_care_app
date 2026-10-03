// Session store: who is signed in and which patient the app is showing.
//
// Login is email OTP against the real backend (see auth_api_service.dart).
// After login the app resolves the patient record with GET /api/patients/me
// and uses the first patient (the user's own SELF link is preferred).
// If the user has no patient yet, the onboarding screen creates one.
import '../../../core/network/api_exception.dart';
import '../../patient/profile/services/patient_service.dart';
import '../models/user_profile.dart';
import 'auth_api_service.dart';

enum SessionResult { ready, needsOnboarding }

class AuthState {
  /// Shows the "test mode" hint on login/OTP screens while the backend only
  /// prints codes to its console. Set to false once real email is wired up.
  static const showDevBanner = true;

  static String email = '';

  /// Only 'patient' is supported in this version.
  static const String role = 'patient';

  static String? userId;
  static UserProfile? profile;

  static bool get hasPatient => profile != null;
  static String get patientId => profile?.patientId ?? '';

  /// Looks up the user's patient. Throws [ApiException] on network/server
  /// errors so callers can show "Try again" instead of guessing.
  static Future<SessionResult> loadPatient() async {
    final links = await PatientService().myPatients();
    if (links.isEmpty) return SessionResult.needsOnboarding;
    final chosen = links.firstWhere(
      (l) => l['relationship_type'] == 'SELF',
      orElse: () => links.first,
    );
    profile = UserProfile.fromPatientJson(Map<String, dynamic>.from(chosen['patient'] as Map));
    return SessionResult.ready;
  }

  /// Creates the patient (onboarding) and keeps it as the active profile.
  static Future<void> createPatient({
    required String name,
    required DateTime dob,
    required String languageCode,
  }) async {
    final data = await PatientService().createProfile(
      fullName: name.trim(),
      dateOfBirth: dob,
      preferredLanguage: languageCode,
    );
    profile = UserProfile.fromPatientJson(Map<String, dynamic>.from(data['patient'] as Map));
  }

  /// First name for greetings.
  static String get firstName {
    final n = profile?.name ?? '';
    return n.isEmpty ? '' : n.split(RegExp(r'\s+')).first;
  }

  static String get fullName => profile?.name ?? '';
  static String get initial => fullName.isEmpty ? '·' : fullName[0].toUpperCase();

  static String get bornDisplay {
    final d = profile?.dob;
    if (d == null) return '';
    return '${d.day} ${_months[d.month - 1]} ${d.year}';
  }

  /// User-facing text for a failed request.
  static String describe(Object error, String fallback) =>
      error is ApiException ? error.message : fallback;

  static void signOut() {
    AuthApiService().signOut(); // clears the JWT
    email = '';
    userId = null;
    profile = null;
  }

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
}
