import 'package:flutter/material.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/push/push_service.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../caregiver/caregiver_shell.dart';
import '../../shared/calls/call_coordinator.dart';
import '../../patient/patient_shell.dart';
import '../../patient/profile/services/patient_service.dart';
import '../screens/caregiver_onboarding_screen.dart';
import '../screens/onboarding_screen.dart';
import '../screens/patient_picker_screen.dart';
import '../screens/profile_completion_screen.dart';
import '../screens/staff_notice_screen.dart';
import 'auth_api_service.dart';
import 'auth_state.dart';

/// Decides which home screen a signed-in user lands on, from the roles the
/// backend returned (PATIENT / CAREGIVER / STAFF / NEW_USER) and
/// `is_profile_completed`.
///
///   PATIENT (SELF)      -> patient shell (account name synced if missing)
///   PATIENT (DELEGATE)  -> the patient they manage (picker when several)
///   CAREGIVER           -> caregiver shell, even with NO linked patient;
///                          a caregiver without a name completes the profile first
///   STAFF               -> NGO web notice (the NGO head works in ngo_web)
///   NEW_USER            -> onboarding for the side picked on the login screen
///
/// May throw ApiException (network or server problems); callers show an error
/// with a retry.
class SessionRouter {
  static Future<Widget> destination() async {
    final roles = AuthState.roles;
    final isPatient = roles.contains('PATIENT');
    final isCaregiver = roles.contains('CAREGIVER');

    // Both: use the side picked on the login screen (patient by default).
    if (isPatient && isCaregiver) {
      return AuthState.role == 'caregiver' ? _caregiver() : _patient();
    }
    if (isPatient) return _patient();
    if (isCaregiver) return _caregiver();
    if (roles.contains('STAFF')) return const StaffNoticeScreen();

    // NEW_USER
    if (AuthState.role == 'caregiver') return const CaregiverOnboardingScreen();
    return _patient();
  }

  static Future<Widget> _patient() async {
    AuthState.role = 'patient';
    final links = await PatientService().myPatients();
    AuthState.patientLinks = links;
    if (links.isEmpty) return const OnboardingScreen();

    // One account may operate several patients: let the person choose.
    if (links.length > 1) return PatientPickerScreen(links: links);

    final link = links.first;
    AuthState.selectLink(link);

    if (link.relationshipType == 'SELF') {
      // Own account: the account takes the patient's name when it has none.
      await _completeOwnAccountProfile();
      return const PatientShell();
    }

    // A family member operating the patient's account keeps their OWN identity.
    if (!AuthState.profileCompleted) {
      return const ProfileCompletionScreen(next: PatientShell());
    }
    return const PatientShell();
  }

  static Widget _caregiver() {
    AuthState.role = 'caregiver';
    // No linked patient is needed to enter the app, but a caregiver without a
    // name finishes their profile first.
    if (!AuthState.profileCompleted) return const CaregiverOnboardingScreen();
    return const CaregiverShell();
  }

  /// Patients created before accounts had a name: copy the name onto the
  /// account (PATCH /api/auth/profile) so `is_profile_completed` is true.
  /// Best effort, never blocks sign-in.
  static Future<void> _completeOwnAccountProfile() async {
    if (AuthState.profileCompleted) return;
    final p = AuthState.patient;
    if (p == null) return;
    try {
      final updated = await AuthApiService().updateProfile(
        fullName: p.fullName,
        dateOfBirth: p.dateOfBirth,
        preferredLanguage: p.preferredLanguage,
      );
      AuthState.applyAccount(updated);
    } on ApiException {
      // retried at the next sign-in
    }
  }

  /// Resolve the destination, open the realtime connection, and replace the
  /// whole navigation stack with it.
  static Future<void> go(BuildContext context) async {
    final next = await destination();
    if (!context.mounted) return;
    SocketService.instance.start(AuthState.userId);
    PushService.registerForUser(); // lets the backend ring this phone when the app is closed
    AppRoutes.pushAndClear(context, next);
    CallCoordinator.onSessionReady(); // finishes a call answered from the lock screen
  }
}
