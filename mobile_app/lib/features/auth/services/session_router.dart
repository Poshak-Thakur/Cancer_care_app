import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/push/push_service.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/storage/claim_code_storage.dart';
import '../../caregiver/caregiver_shell.dart';
import '../../shared/calls/call_coordinator.dart';
import '../../patient/patient_shell.dart';
import '../../patient/profile/services/patient_service.dart';
import '../screens/caregiver_onboarding_screen.dart';
import '../screens/claim_blocked_screen.dart';
import '../screens/claim_code_screen.dart';
import '../screens/onboarding_screen.dart';
import '../screens/patient_picker_screen.dart';
import '../screens/profile_completion_screen.dart';
import '../screens/staff_notice_screen.dart';
import 'auth_api_service.dart';
import 'auth_state.dart';

/// Decides which home screen a signed-in user lands on, and caches the
/// activated workspace locally so subsequent app launches work offline.
class SessionRouter {
  /// Returns the cached home widget immediately for an already-activated
  /// offline user without making any network calls.
  static Widget? offlineDestinationIfReady() {
    if (!AuthState.hasLocalActivatedWorkspace) return null;
    final roles = AuthState.roles;
    if (roles.contains('STAFF')) return const StaffNoticeScreen();
    if (AuthState.isCaregiver || (roles.contains('CAREGIVER') && !roles.contains('PATIENT'))) {
      return AuthState.profileCompleted ? const CaregiverShell() : null;
    }
    if (AuthState.patient != null) {
      return const PatientShell();
    }
    return null;
  }

  static Future<Widget> destination() async {
    // A signed-in user with a pending code claims the NGO-created record first.
    final claimScreen = await _claimIfPending();
    if (claimScreen != null) return claimScreen;

    final roles = AuthState.roles;
    final isPatient = roles.contains('PATIENT');
    final isCaregiver = roles.contains('CAREGIVER');

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

  static Future<Widget?> _claimIfPending() async {
    final code = await ClaimCodeStorage.read();
    if (code == null) return null;

    final links = await PatientService().myPatients();
    if (links.any((l) => l.relationshipType == 'SELF')) {
      await ClaimCodeStorage.clear();
      return null;
    }

    try {
      await PatientService().claimPatient(code);
    } on ApiException catch (e) {
      switch (e.statusCode) {
        case 400:
          await ClaimCodeStorage.clear();
          return ClaimCodeScreen(
            signedIn: true,
            message: e.message.isEmpty ? S.t('claimInvalid') : e.message,
          );
        case 409:
          await ClaimCodeStorage.clear();
          if (e.code == 'SELF_PROFILE_EXISTS') return null;
          return ClaimBlockedScreen(message: S.t('claimAlreadySetUp'));
        case 429:
          await ClaimCodeStorage.clear();
          return ClaimBlockedScreen(message: S.t('claimTooMany'));
        default:
          rethrow;
      }
    }
    await ClaimCodeStorage.clear();
    AuthState.roles = [
      ...AuthState.roles.where((r) => r != 'NEW_USER' && r != 'PATIENT'),
      'PATIENT',
    ];
    AuthState.role = 'patient';
    return null;
  }

  static Future<Widget> _patient() async {
    AuthState.role = 'patient';
    try {
      final links = await PatientService().myPatients();
      AuthState.patientLinks = links;
      if (links.isEmpty) return const OnboardingScreen();

      if (links.length > 1) return PatientPickerScreen(links: links);

      final link = links.first;
      AuthState.selectLink(link);

      if (link.relationshipType == 'SELF') {
        await _completeOwnAccountProfile();
        await AuthState.persistSession();
        return const PatientShell();
      }

      if (!AuthState.profileCompleted) {
        return const ProfileCompletionScreen(next: PatientShell());
      }
      await AuthState.persistSession();
      return const PatientShell();
    } on ApiException {
      // Offline fallback: if we already have a cached patient workspace, open it!
      if (AuthState.patient != null) {
        return const PatientShell();
      }
      rethrow;
    }
  }

  static Widget _caregiver() {
    AuthState.role = 'caregiver';
    if (!AuthState.profileCompleted) return const CaregiverOnboardingScreen();
    unawaited(AuthState.persistSession());
    return const CaregiverShell();
  }

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
      // retried at the next online sync
    }
  }

  /// Resolve the destination, open the realtime connection, and replace the
  /// whole navigation stack with it.
  static Future<void> go(BuildContext context) async {
    final next = await destination();
    if (!context.mounted) return;
    await AuthState.persistSession();
    SocketService.instance.start(AuthState.userId);
    PushService.registerForUser();
    AppRoutes.pushAndClear(context, next);
    CallCoordinator.onSessionReady();
  }
}