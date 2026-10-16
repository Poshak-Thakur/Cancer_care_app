import 'dart:async';
import '../../../core/authorization/access_scope.dart';
import '../../../core/localization/lang.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/storage/claim_code_storage.dart';
import '../../../core/storage/local_offline_storage.dart';
import '../../../core/storage/token_storage.dart';
import '../../shared/calls/call_coordinator.dart';
import '../../patient/profile/models/patient.dart';
import '../../patient/profile/models/patient_link.dart';
import '../../patient/profile/services/patient_service.dart';
import '../../caregiver/patients/services/caregiver_service.dart';
import 'auth_api_service.dart';

/// In-memory session for the signed-in user, backed by [LocalOfflineStore]
/// so an already-activated account opens immediately even without internet.
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

  /// Which side of the app is open: 'patient' or 'caregiver'.
  static String role = 'patient';

  /// The patient being shown. Patients: their own record. Caregivers: the
  /// patient they selected.
  static Patient? patient;

  /// How the signed-in user relates to [patient]: SELF or DELEGATE.
  static String relationshipType = 'SELF';

  /// access_scopes of the CURRENT relationship (the selected patient's link).
  static List<String> scopes = const [];

  /// True when this account has a verified email address attached.
  /// False when activated via NGO code ("I have a code") and not linked yet.
  static bool get hasEmail => email.trim().isNotEmpty;

  /// True when we have a locally activated workspace that can open offline.
  static bool get hasLocalActivatedWorkspace =>
      TokenStorage.hasRefresh &&
      userId.isNotEmpty &&
      (patient != null || roles.contains('CAREGIVER'));

  /// May the signed-in user do [scope] for the selected patient?
  static bool can(String scope) => AccessScope.hasScope(scopes, scope, caregiver: isCaregiver);

  static void refreshScopes(String patientId, List<String> latest) {
    if (patient?.id != patientId) return;
    scopes = List<String>.unmodifiable(latest);
    unawaited(persistSession());
  }

  static Future<void> syncScopes() async {
    final pid = patient?.id;
    if (pid == null) return;
    List<String>? fresh;
    if (isCaregiver) {
      for (final l in await CaregiverService().myPatients()) {
        if (l.patient.id == pid) {
          fresh = l.accessScopes;
          break;
        }
      }
    } else {
      for (final l in await PatientService().myPatients()) {
        if (l.patient.id == pid) {
          fresh = l.accessScopes;
          break;
        }
      }
    }
    refreshScopes(pid, fresh ?? const <String>[]);
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

  /// Account fields only (after a profile edit or email link); keeps roles as they are.
  static void applyAccount(AuthResult r) {
    if (r.email.isNotEmpty) email = r.email;
    accountName = r.fullName ?? accountName;
    accountDob = r.dateOfBirth ?? accountDob;
    phone = r.phoneNumber ?? phone;
    avatarUrl = r.avatarUrl ?? avatarUrl;
    caregiverType = r.caregiverType ?? caregiverType;
    ngoRecognized = r.ngoRecognized;
    profileCompleted = r.isProfileCompleted;
    if (r.isProfileCompleted) Lang.isHindi.value = r.preferredLanguage == 'hi';
    unawaited(persistSession());
  }

  static void setPatient(
    Patient p, {
    String relationship = 'SELF',
    List<String> accessScopes = const ['ALL'],
  }) {
    patient = p;
    relationshipType = relationship;
    scopes = List<String>.unmodifiable(accessScopes);
    unawaited(persistSession());
  }

  static void selectLink(PatientLink l) =>
      setPatient(l.patient, relationship: l.relationshipType, accessScopes: l.accessScopes);

  /// Saves the current session state to SQLite so the app can launch offline.
  static Future<void> persistSession() async {
    if (userId.isEmpty) return;
    final p = patient;
    final snapshot = <String, dynamic>{
      'user': {
        'id': userId,
        'email': email,
        'full_name': accountName,
        'date_of_birth': accountDob?.toIso8601String(),
        'phone_number': phone,
        'avatar_url': avatarUrl,
        'preferred_language': Lang.isHindi.value ? 'hi' : 'en',
        'caregiver_type': caregiverType,
        'ngo_recognized': ngoRecognized,
        'roles': roles,
        'is_profile_completed': profileCompleted,
      },
      'role': role,
      'relationship_type': relationshipType,
      'scopes': scopes,
      if (p != null)
        'patient': {
          'id': p.id,
          'full_name': p.fullName,
          'date_of_birth': p.dateOfBirth?.toIso8601String(),
          'preferred_language': p.preferredLanguage,
          'cancer_type': p.cancerType,
          'cancer_stage': p.cancerStage,
          'diagnosis_date': p.diagnosisDate?.toIso8601String(),
          'care_plan_summary': p.carePlanSummary,
        },
    };
    await LocalOfflineStore.instance.saveActivatedSession(snapshot);
  }

  /// Restores the last activated session from SQLite on cold start before network calls.
  static Future<bool> restoreFromLocalCache() async {
    if (!TokenStorage.hasRefresh) return false;
    final snapshot = await LocalOfflineStore.instance.getActivatedSession();
    if (snapshot == null) return false;

    try {
      final userMap = snapshot['user'];
      if (userMap is! Map) return false;
      final authResult = AuthResult.fromUser(Map<String, dynamic>.from(userMap));
      userId = authResult.userId;
      email = authResult.email;
      roles = authResult.roles;
      accountName = authResult.fullName;
      accountDob = authResult.dateOfBirth;
      phone = authResult.phoneNumber;
      avatarUrl = authResult.avatarUrl;
      caregiverType = authResult.caregiverType;
      ngoRecognized = authResult.ngoRecognized;
      profileCompleted = authResult.isProfileCompleted;
      if (authResult.isProfileCompleted) {
        Lang.isHindi.value = authResult.preferredLanguage == 'hi';
      }

      role = (snapshot['role'] as String?) ?? 'patient';
      relationshipType = (snapshot['relationship_type'] as String?) ?? 'SELF';
      scopes = List<String>.unmodifiable(
        ((snapshot['scopes'] as List?) ?? const ['ALL']).map((e) => e.toString()),
      );

      final rawPatient = snapshot['patient'];
      if (rawPatient is Map) {
        patient = Patient.fromJson(Map<String, dynamic>.from(rawPatient));
      }
      return userId.isNotEmpty;
    } catch (_) {
      return false;
    }
  }

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

  /// "ab***@example.com" (or empty string when no email is attached yet)
  static String get maskedEmail {
    if (email.trim().isEmpty) return '';
    final at = email.indexOf('@');
    if (at < 1) return email;
    final name = email.substring(0, at);
    final shown = name.length <= 2 ? name.substring(0, 1) : name.substring(0, 2);
    return '$shown***${email.substring(at)}';
  }

  /// Forget everything held in memory and local cache (does not touch the server).
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
    ClaimCodeStorage.clear();
    LocalOfflineStore.instance.clearAll();
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