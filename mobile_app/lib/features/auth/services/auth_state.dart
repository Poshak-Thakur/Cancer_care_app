import '../../../core/authorization/access_scope.dart';
import '../../../core/localization/lang.dart';
import '../../../core/realtime/socket_service.dart';
import '../../shared/calls/call_coordinator.dart';
import '../../patient/profile/models/patient.dart';
import '../../patient/profile/models/patient_link.dart';
import 'auth_api_service.dart';

/// In-memory session for the signed-in user. Tokens live in [TokenStorage].
class AuthState {
  AuthState._();

  static String userId = '';
  static String email = '';

  // ---- account fields (useraccount) ----
  static String? accountName;
  static DateTime? accountDob;
  static String? phone;
  static String? avatarUrl;
  static String? caregiverType; // FAMILY | VOLUNTEER
  static bool profileCompleted = false;
  static bool ngoRecognized = false; // caregivers: set by the NGO, read-only here

  /// Roles reported by the backend: PATIENT, CAREGIVER, STAFF, NEW_USER.
  static List<String> roles = const [];

  /// Which side of the app is open: 'patient' or 'caregiver'. Chosen on the
  /// login screen, then confirmed by the router from [roles].
  static String role = 'patient';

  /// The patient being shown. Patients: their own record. Caregivers: the
  /// patient they selected.
  static Patient? patient;

  /// How the signed-in user relates to [patient]: SELF (own account) or
  /// DELEGATE (a family member operating the patient's account).
  static String relationshipType = 'SELF';

  /// access_scopes of the CURRENT relationship (the selected patient's link).
  /// Always replaced together with [patient] so it can never belong to a
  /// previously selected patient.
  static List<String> scopes = const [];

  /// May the signed-in user do [scope] for the selected patient?
  static bool can(String scope) => AccessScope.hasScope(scopes, scope, caregiver: isCaregiver);

  /// Refreshes the scopes of the selected patient (e.g. from the dashboard).
  static void refreshScopes(List<String> latest) {
    if (latest.isNotEmpty) scopes = latest;
  }

  /// Every patient this account may operate (usually one).
  static List<PatientLink> patientLinks = const [];

  static String? get patientId => patient?.id;

  /// True when the signed-in person is operating someone else's patient account.
  static bool get isManagingOther => !isCaregiver && patient != null && relationshipType == 'DELEGATE';
  static bool get isCaregiver => role == 'caregiver';

  /// Copies the account fields reported by the backend into the session.
  static void applyLogin(AuthResult r) {
    userId = r.userId;
    email = r.email;
    roles = r.roles;
    applyAccount(r);
  }

  /// Account fields only (after a profile edit); keeps roles as they are.
  static void applyAccount(AuthResult r) {
    accountName = r.fullName;
    accountDob = r.dateOfBirth;
    phone = r.phoneNumber;
    avatarUrl = r.avatarUrl;
    caregiverType = r.caregiverType ?? caregiverType;
    ngoRecognized = r.ngoRecognized;
    profileCompleted = r.isProfileCompleted;
    // A brand-new account has no saved preference yet: keep the language the
    // person picked on the login screen.
    if (r.isProfileCompleted) Lang.isHindi.value = r.preferredLanguage == 'hi';
  }

  static void setPatient(Patient p, {String relationship = 'SELF', List<String> accessScopes = const ['ALL']}) {
    patient = p;
    relationshipType = relationship;
    scopes = List<String>.unmodifiable(accessScopes);
  }

  static void selectLink(PatientLink l) => setPatient(l.patient, relationship: l.relationshipType, accessScopes: l.accessScopes);

  /// Name shown for the *signed-in person*: their account name, falling back
  /// to the patient record (patients) and finally the email.
  static String get displayName {
    final a = accountName?.trim() ?? '';
    if (a.isNotEmpty) return a;
    if (!isCaregiver) {
      final p = patient?.fullName.trim() ?? '';
      if (p.isNotEmpty) return p;
    }
    final at = email.indexOf('@');
    return at > 0 ? email.substring(0, at) : email;
  }

  /// First name for greetings.
  static String get firstName {
    final n = displayName.trim();
    return n.isEmpty ? '' : n.split(RegExp(r'\s+')).first;
  }

  static String get fullName => displayName;
  static String get initial => displayName.isEmpty ? '?' : displayName[0].toUpperCase();

  static String get bornDisplay {
    final d = accountDob ?? patient?.dateOfBirth;
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
    accountName = null;
    accountDob = null;
    phone = null;
    avatarUrl = null;
    caregiverType = null;
    profileCompleted = false;
    roles = const [];
    role = 'patient';
    patient = null;
    relationshipType = 'SELF';
    scopes = const [];
    ngoRecognized = false;
    patientLinks = const [];
    SocketService.instance.stop();
    CallCoordinator.onSignedOut();
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
