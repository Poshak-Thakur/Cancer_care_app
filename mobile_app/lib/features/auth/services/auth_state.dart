import '../../../core/realtime/socket_service.dart';
import '../../patient/profile/models/patient.dart';
import 'auth_api_service.dart';

/// In-memory session for the signed-in user. Tokens live in [TokenStorage].
class AuthState {
  static String userId = '';
  static String email = '';

  /// Roles reported by the backend: PATIENT, CAREGIVER, STAFF, NEW_USER.
  static List<String> roles = const [];

  /// Which side of the app is open: 'patient' or 'caregiver'. Chosen on the
  /// login screen, then confirmed by the router from [roles].
  static String role = 'patient';

  /// The patient being shown. Patients: their own record. Caregivers: the
  /// patient they selected.
  static Patient? patient;

  static String? get patientId => patient?.id;
  static bool get isCaregiver => role == 'caregiver';

  static void applyLogin(AuthResult r) {
    userId = r.userId;
    email = r.email;
    roles = r.roles;
  }

  static void setPatient(Patient p) => patient = p;

  /// First name for greetings; empty until a patient is loaded.
  static String get firstName {
    final n = patient?.fullName.trim() ?? '';
    return n.isEmpty ? '' : n.split(RegExp(r'\s+')).first;
  }

  static String get fullName => patient?.fullName ?? '';
  static String get initial => fullName.isEmpty ? '?' : fullName[0].toUpperCase();

  static String get bornDisplay {
    final d = patient?.dateOfBirth;
    if (d == null) return '';
    return '${d.day} ${_months[d.month - 1]} ${d.year}';
  }

  /// "ab***@example.com"
  static String get maskedEmail {
    final at = email.indexOf('@');
    if (at < 1) return email;
    final name = email.substring(0, at);
    final shown = name.length <= 2 ? name.substring(0, 1) : name.substring(0, 2);
    return '$shown***${email.substring(at)}';
  }

  /// Forget everything held in memory (does not touch the server).
  static void clearLocal() {
    userId = '';
    email = '';
    roles = const [];
    role = 'patient';
    patient = null;
    SocketService.instance.stop();
  }

  /// Explicit sign-out: revoke the refresh token on the server, then clear.
  static Future<void> signOut() async {
    await AuthApiService().signOut();
    clearLocal();
  }

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
}
