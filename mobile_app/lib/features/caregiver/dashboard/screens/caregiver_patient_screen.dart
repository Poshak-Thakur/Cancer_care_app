import 'package:flutter/material.dart';
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
import '../../../patient/dashboard/models/dashboard_overview.dart';
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
    AuthState.setPatient(widget.link.patient); // the patient this caregiver is viewing
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final d = await DashboardService().overview(widget.link.patient.id);
      if (!mounted) return;
      setState(() { _data = d; _loading = false; _failed = false; });
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; _failed = _data == null; });
    }
  }

  Future<void> _setAvailability(String value) async {
    final before = _availability;
    setState(() => _availability = value);
    try {
      await CaregiverService().updateAvailability(widget.link.patient.id, value);
    } on ApiException {
      if (!mounted) return;
      setState(() => _availability = before);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('couldNotUpdate'))));
    }
  }

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
                  if (_loading && data == null)
                    const LoadingView()
                  else if (_failed || data == null)
                    ErrorView(message: S.t('loadFailed'), onRetry: _load)
                  else ...[
                    SectionLabel(S.t('todaysCheckin')),
                    SaathiCard(
                      child: InfoRow(
                        icon: data.checkInCompleted ? Icons.check_circle_outline : Icons.pending_outlined,
                        title: data.checkInCompleted ? S.t('checkinDoneToday') : S.t('checkinNotDone'),
                      ),
                    ),
                    SectionLabel(S.t('today')),
                    TodayChecklistCard(events: data.events),
                    if (data.documents.isNotEmpty) ...[
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
                  const SizedBox(height: 18),
                  PrimaryButton(
                    label: S.t('careTeam'),
                    onPressed: () => AppRoutes.push(context, CareTeamScreen(patientId: widget.link.patient.id, embedded: false)),
                  ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}
