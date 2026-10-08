import 'package:flutter/material.dart';
import '../localization/strings.dart';
import '../network/api_exception.dart';
import '../../features/auth/services/auth_state.dart';
import '../../features/auth/services/session_router.dart';

/// Reacts to access that was withdrawn while a screen was open (the backend
/// treats revoked links as inactive on the very next request and answers 403).
///
/// Use in a screen's `on ApiException catch (e)`:
/// ```dart
/// if (AccessGuard.handle(context, e)) return;
/// ```
class AccessGuard {
  AccessGuard._();

  /// Bumped whenever access was found to be revoked, so lists of patients
  /// reload themselves from the backend.
  static final ValueNotifier<int> revision = ValueNotifier<int>(0);

  /// True for the 403s that mean "your relationship with this patient (or
  /// conversation/call) is gone". A 403 for a missing *scope* ("Requires
  /// scope X") is a permission limit, not a revocation, and returns false.
  static bool isRevoked(ApiException e) {
    if (e.statusCode != 403) return false;
    final m = e.message.toLowerCase();
    if (m.contains('requires scope')) return false;
    return m.contains('patient record') ||
        m.contains('no longer') ||
        m.contains('unauthorized access');
  }

  /// If [e] is a revocation: tell the user, drop the selected patient and
  /// return to the right place. Returns true when it handled the error.
  static bool handle(BuildContext context, ApiException e) {
    if (!isRevoked(e)) return false;
    if (!context.mounted) return true;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('accessRevoked'))));
    final wasCaregiver = AuthState.isCaregiver;
    AuthState.patient = null;
    AuthState.scopes = const [];
    revision.value++;
    if (wasCaregiver) {
      // Back to the caregiver home; the patient list reloads from the backend.
      Navigator.of(context).popUntil((r) => r.isFirst);
    } else {
      // Patient/delegate: re-resolve which patients this account may still use.
      SessionRouter.go(context);
    }
    return true;
  }

  /// Friendly text for the 403 an unrecognised caregiver gets when linking.
  static bool isNotRecognized(ApiException e) =>
      e.code == 'CAREGIVER_NOT_RECOGNIZED' ||
      (e.statusCode == 403 && e.message.toLowerCase().contains('recogni'));
}
