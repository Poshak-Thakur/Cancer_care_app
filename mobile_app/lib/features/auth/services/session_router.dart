import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../caregiver/caregiver_shell.dart';
import '../../patient/patient_shell.dart';
import '../../patient/profile/services/patient_service.dart';
import '../screens/caregiver_onboarding_screen.dart';
import '../screens/onboarding_screen.dart';
import '../screens/staff_notice_screen.dart';
import 'auth_state.dart';

/// Decides which home screen a signed-in user lands on, from the roles the
/// backend returned (PATIENT / CAREGIVER / STAFF / NEW_USER).
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

    // NEW_USER: show the onboarding for the side they picked. A patient flow
    // still looks up /patients/me first, because the backend does not list
    // DELEGATE-only accounts as PATIENT.
    if (AuthState.role == 'caregiver') return const CaregiverOnboardingScreen();
    return _patient();
  }

  static Future<Widget> _patient() async {
    AuthState.role = 'patient';
    final links = await PatientService().myPatients();
    if (links.isEmpty) return const OnboardingScreen();
    final p = links.first.patient;
    AuthState.setPatient(p);
    Lang.isHindi.value = p.preferredLanguage == 'hi';
    return const PatientShell();
  }

  static Widget _caregiver() {
    AuthState.role = 'caregiver';
    return const CaregiverShell();
  }

  /// Resolve the destination, open the realtime connection, and replace the
  /// whole navigation stack with it.
  static Future<void> go(BuildContext context) async {
    final next = await destination();
    if (!context.mounted) return;
    SocketService.instance.start(AuthState.userId);
    AppRoutes.pushAndClear(context, next);
  }
}
