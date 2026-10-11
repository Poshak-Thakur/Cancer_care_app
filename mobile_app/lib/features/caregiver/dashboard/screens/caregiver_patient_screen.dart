import 'package:flutter/material.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/authorization/access_scope.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/section_label.dart';
import '../../../auth/services/auth_state.dart';
import '../../../shared/alerts/alert_service.dart';
import '../../../shared/alerts/alert_widgets.dart';
import '../../../patient/check_in/screens/check_in_screen.dart';
import '../../../patient/check_in/screens/symptom_history_screen.dart';
import '../../../patient/dashboard/models/dashboard_overview.dart';
import '../../../patient/dashboard/screens/care_screen.dart';
import '../../../patient/documents/screens/documents_screen.dart';
import '../../../patient/dashboard/services/dashboard_service.dart';
import '../../../patient/dashboard/widgets/today_checklist_card.dart';
import '../../../patient/messages/screens/care_team_screen.dart';
import '../../patients/models/linked_patient.dart';
import '../../patients/screens/caregiver_patients_screen.dart' show availabilityLabel;
import '../../patients/services/caregiver_service.dart';

/// Read-only overview of one patient for a caregiver, plus the caregiver's own
/// availability for that patient and a shortcut to the care team.
class CaregiverPatientScreen extends StatefulWidget {
  final LinkedPatient link;
  const CaregiverPatientScreen({super.key, required this.link});

  @override
  State<CaregiverPatientScreen> createState() => _CaregiverPatientScreenState();
}

class _CaregiverPatientScreenState extends State<CaregiverPatientScreen> {
  DashboardOverview? _data;
  late String _availability = widget.link.availability;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    // The patient this caregiver is viewing, with THIS link's scopes.
    AuthState.setPatient(widget.link.patient, relationship: 'CAREGIVER', accessScopes: widget.link.accessScopes);
    AlertEvents.changed.addListener(_onAlertsChanged);
    _load();
  }

  @override
  void dispose() {
    AlertEvents.changed.removeListener(_onAlertsChanged);
    super.dispose();
  }

  /// A critical-alert push arrived (or an alert changed elsewhere): reload from the backend.
  void _onAlertsChanged() {
    if (mounted) _load(silent: true);
  }

  Future<void> _load({bool silent = false}) async {
    final pid = widget.link.patient.id;
    if (!AuthState.can(AccessScope.dashboardView)) {
      // The cached scopes may be out of date: ask the backend before limiting the screen.
      try {
        await AuthState.syncScopes();
      } on ApiException catch (e) {
        if (!mounted) return;
        if (AccessGuard.handle(context, e)) return;
      }
      if (!mounted || AuthState.patientId != pid) return;
    }
    if (!AuthState.can(AccessScope.dashboardView)) {
      setState(() { _data = null; _loading = false; _failed = false; }); // no DASHBOARD_VIEW: show only what the scopes allow
      return;
    }
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final d = await DashboardService().overview(pid);
      AuthState.refreshScopes(pid, d.accessScopes); // the backend's current scopes for this link (ignored if another patient is selected now)
      if (!mounted) return;
      setState(() { _data = d; _loading = false; _failed = false; });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() { _loading = false; _failed = _data == null; });
    }
  }

  Future<void> _setAvailability(String value) async {
    final before = _availability;
    setState(() => _availability = value);
    try {
      await CaregiverService().updateAvailability(widget.link.patient.id, value);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _availability = before);
      if (AccessGuard.handle(context, e)) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('couldNotUpdate'))));
    }
  }

  Future<void> _leave() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(S.t('leavePatient')),
        content: Text(S.t('leavePatientBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(S.t('cancel'))),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: Text(S.t('leavePatient'), style: const TextStyle(color: AppColors.warning))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      // A caregiver may remove their own link (POST /api/caregivers/revoke).
      await CaregiverService().revoke(patientId: widget.link.patient.id, caregiverUserId: AuthState.userId);
      if (mounted) Navigator.of(context).pop();
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  Widget _link(IconData icon, String title, String sub, VoidCallback onTap) => SaathiCard(
        onTap: onTap,
        child: InfoRow(icon: icon, title: title, subtitle: sub, trailing: const Icon(Icons.chevron_right, color: AppColors.primary)),
      );

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final data = _data;
        return Scaffold(
          appBar: AppBar(title: Text(widget.link.patient.fullName)),
          body: SafeArea(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => _load(silent: true),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                children: [
                  Text(widget.link.relationshipLabel, style: const TextStyle(fontSize: 14, color: AppColors.textSecondary)),
                  const SizedBox(height: 12),
                  // Asking for help needs no access scope, so it is always shown.
                  HelpNowCard(patientId: widget.link.patient.id, forPatient: true, onChanged: () => _load(silent: true)),
                  SectionLabel(S.t('myAvailability')),
                  Wrap(
                    spacing: 8,
                    children: [
                      for (final v in const ['AVAILABLE', 'UNAVAILABLE', 'DO_NOT_DISTURB'])
                        ChoiceChip(
                          label: Text(availabilityLabel(v)),
                          selected: _availability == v,
                          selectedColor: AppColors.primaryLight,
                          onSelected: (_) => _setAvailability(v),
                        ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(S.t('availabilityNote'), style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint, height: 1.4)),
                  if (!AuthState.can(AccessScope.dashboardView))
                    SaathiCard(child: InfoRow(icon: Icons.lock_outline, title: S.t('limitedAccess'), subtitle: S.t('limitedAccessSub')))
                  else if (_loading && data == null)
                    const LoadingView()
                  else if (_failed || data == null)
                    ErrorView(message: S.t('loadFailed'), onRetry: _load)
                  else ...[
                    for (final a in visibleAlerts(data.alerts)) AlertCard(alert: a, onChanged: () => _load(silent: true)),
                    if (AuthState.can(AccessScope.symptomView)) ...[
                      SectionLabel(S.t('todaysCheckin')),
                      SaathiCard(
                        child: InfoRow(
                          icon: data.checkInCompleted ? Icons.check_circle_outline : Icons.pending_outlined,
                          title: data.checkInCompleted ? S.t('checkinDoneToday') : S.t('checkinNotDone'),
                        ),
                      ),
                    ],
                    if (AuthState.can(AccessScope.careEventView)) ...[
                      SectionLabel(S.t('today')),
                      TodayChecklistCard(
                        events: data.events,
                        readOnly: !AuthState.can(AccessScope.careEventEdit),
                        onChanged: () => _load(silent: true),
                      ),
                    ],
                    if (AuthState.can(AccessScope.documentView) && data.documents.isNotEmpty) ...[
                      SectionLabel(S.t('recentDocuments')),
                      SaathiCard(
                        child: Column(
                          children: [
                            for (var i = 0; i < data.documents.length; i++) ...[
                              if (i > 0) const SizedBox(height: 14),
                              InfoRow(icon: Icons.description_outlined, title: data.documents[i].title, subtitle: data.documents[i].documentType),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ],
                  SectionLabel(S.t('records')),
                  if (AuthState.can(AccessScope.careEventView))
                  _link(Icons.event_note_outlined, S.t('carePlan'), S.t('carePlanSub'), () => AppRoutes.push(context, _CarePage(patientId: widget.link.patient.id))),
                  if (AuthState.can(AccessScope.symptomWrite))
                  _link(Icons.sentiment_satisfied_alt, S.t('checkInForPatient'), S.t('checkInForPatientSub'), () async {
                    await AppRoutes.push(context, CheckInScreen(patientId: widget.link.patient.id));
                    if (mounted) _load(silent: true);
                  }),
                  if (AuthState.can(AccessScope.symptomView))
                  _link(Icons.monitor_heart_outlined, S.t('checkinHistory'), S.t('checkinHistorySub'), () => AppRoutes.push(context, SymptomHistoryScreen(patientId: widget.link.patient.id))),
                  if (AuthState.can(AccessScope.documentView))
                  _link(Icons.description_outlined, S.t('documents'), S.t('documentsSub'), () => AppRoutes.push(context, DocumentsScreen(patientId: widget.link.patient.id))),
                  const SizedBox(height: 10),
                  PrimaryButton(
                    label: S.t('careTeam'),
                    onPressed: () => AppRoutes.push(context, CareTeamScreen(patientId: widget.link.patient.id, embedded: false)),
                  ),
                  Center(child: TextButton(onPressed: _leave, child: Text(S.t('leavePatient'), style: const TextStyle(color: AppColors.warning)))),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// The care plan of one patient, opened from a caregiver's patient screen.
class _CarePage extends StatelessWidget {
  final String patientId;
  const _CarePage({required this.patientId});

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(S.t('carePlan'))),
        body: SafeArea(child: CareScreen(patientId: patientId)),
      );
}
