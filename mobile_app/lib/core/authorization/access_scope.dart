/// The ONE place the app checks backend access-scope strings.
///
/// The backend (constants/accessScopes.js) is the real security boundary; this
/// only keeps the UI from offering actions the current relationship cannot do.
/// Never write `scopes.contains('SYMPTOM_WRITE')` in a screen: call
/// [AccessScope.hasScope] or `AuthState.can(...)`.
class AccessScope {
  AccessScope._();

  // ---- v1 vocabulary (exactly as the backend defines it) ----
  static const all = 'ALL';
  static const accountOperate = 'ACCOUNT_OPERATE';
  static const accountDelegateManage = 'ACCOUNT_DELEGATE_MANAGE';
  static const careCircleManage = 'CARE_CIRCLE_MANAGE';
  static const dashboardView = 'DASHBOARD_VIEW';
  static const symptomView = 'SYMPTOM_VIEW';
  static const symptomWrite = 'SYMPTOM_WRITE';
  static const medicationView = 'MEDICATION_VIEW';
  static const medicationEdit = 'MEDICATION_EDIT';
  static const documentView = 'DOCUMENT_VIEW';
  static const documentUpload = 'DOCUMENT_UPLOAD';
  static const careEventView = 'CARE_EVENT_VIEW';
  static const careEventEdit = 'CARE_EVENT_EDIT';

  /// Does [scopes] allow [required]?
  ///
  /// `ALL` is the full-access wildcard of a patient's own account (SELF /
  /// DELEGATE links). It is never a caregiver scope, so pass
  /// [caregiver] = true for caregiver links and `ALL` is ignored, mirroring
  /// the backend.
  static bool hasScope(List<String>? scopes, String required, {bool caregiver = false}) {
    final s = scopes ?? const <String>[];
    if (s.contains(required)) return true;
    if (!caregiver && s.contains(all)) return true;
    return false;
  }

  static bool hasAnyScope(List<String>? scopes, List<String> required, {bool caregiver = false}) =>
      required.any((r) => hasScope(scopes, r, caregiver: caregiver));

  static bool hasAllScopes(List<String>? scopes, List<String> required, {bool caregiver = false}) =>
      required.every((r) => hasScope(scopes, r, caregiver: caregiver));
}
