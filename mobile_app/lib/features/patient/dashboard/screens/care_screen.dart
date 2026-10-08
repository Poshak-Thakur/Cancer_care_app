import 'package:flutter/material.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/authorization/access_scope.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/section_label.dart';
import '../../../auth/services/auth_state.dart';
import '../../appointments/widgets/appointment_card.dart';
import '../../check_in/screens/symptom_history_screen.dart';
import '../../documents/screens/documents_screen.dart';
import '../../medicines/widgets/medicine_list_card.dart';
import '../models/care_event.dart';
import '../services/care_event_service.dart';
import '../widgets/today_checklist_card.dart';
import 'add_care_event_screen.dart';

/// Care plan for one day (India Standard Time): medicines, appointments and
/// tasks, with a day picker, an AI-assisted "add" flow and shortcuts to
/// documents and symptom history.
///
/// Used as the patient's Care tab ([patientId] omitted) and, with an explicit
/// [patientId], for a caregiver viewing one of their patients.
class CareScreen extends StatefulWidget {
  final String? patientId;
  const CareScreen({super.key, this.patientId});

  @override
  State<CareScreen> createState() => _CareScreenState();
}

class _CareScreenState extends State<CareScreen> {
  List<CareEvent>? _events;
  DateTime _day = Ist.today();
  bool _loading = true;
  bool _failed = false;

  String? get _pid => widget.patientId ?? AuthState.patientId;
  bool get _isToday => Ist.sameDay(_day, Ist.today());

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    final pid = _pid;
    if (pid == null) {
      setState(() {
        _loading = false;
        _failed = true;
      });
      return;
    }
    if (!AuthState.can(AccessScope.careEventView)) {
      setState(() {
        _events = const [];
        _loading = false;
        _failed = false;
      });
      return;
    }
    if (!silent) {
      setState(() {
        _loading = true;
        _failed = false;
      });
    }
    try {
      final events = await CareEventService().daily(pid, day: _isToday ? null : _day);
      if (!mounted) return;
      setState(() {
        _events = events;
        _loading = false;
        _failed = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() {
        _loading = false;
        _failed = _events == null;
      });
    }
  }

  void _shift(int days) {
    setState(() {
      _day = _day.add(Duration(days: days));
      _events = null;
    });
    _load();
  }

  Future<void> _pickDay() async {
    final today = Ist.today();
    final picked = await showDatePicker(
      context: context,
      initialDate: _day,
      firstDate: today.subtract(const Duration(days: 365)),
      lastDate: today.add(const Duration(days: 365)),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) {
      setState(() {
        _day = picked;
        _events = null;
      });
      _load();
    }
  }

  Future<void> _add() async {
    final pid = _pid;
    if (pid == null) return;
    final saved = await AppRoutes.push<bool>(context, AddCareEventScreen(patientId: pid));
    if (saved == true && mounted) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final events = _events;
        final pid = _pid;
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(silent: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
            children: [
              Text(S.t('yourCare'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
              const SizedBox(height: 2),
              Text(S.t('careSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
              const SizedBox(height: 14),
              Row(
                children: [
                  IconButton(onPressed: () => _shift(-1), icon: const Icon(Icons.chevron_left), color: AppColors.primary, tooltip: S.t('previousDay')),
                  Expanded(
                    child: InkWell(
                      onTap: _pickDay,
                      borderRadius: BorderRadius.circular(12),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 8),
                        child: Column(
                          children: [
                            Text(_isToday ? S.t('today') : Ist.shortDay(_day), style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.bold)),
                            if (!_isToday) TextButton(onPressed: () { setState(() { _day = Ist.today(); _events = null; }); _load(); }, style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: const Size(0, 20)), child: Text(S.t('backToToday'), style: const TextStyle(fontSize: 12.5))),
                          ],
                        ),
                      ),
                    ),
                  ),
                  IconButton(onPressed: () => _shift(1), icon: const Icon(Icons.chevron_right), color: AppColors.primary, tooltip: S.t('nextDay')),
                ],
              ),
              const SizedBox(height: 6),
              if (AuthState.can(AccessScope.careEventEdit))
                PrimaryButton(label: S.t('addToCare'), onPressed: _add),
              const SizedBox(height: 8),
              if (!AuthState.can(AccessScope.careEventView))
                SaathiCard(child: InfoRow(icon: Icons.lock_outline, title: S.t('limitedAccess'), subtitle: S.t('limitedAccessSub')))
              else if (_loading && events == null)
                const LoadingView()
              else if (_failed || events == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else ...[
                SectionLabel(S.t('tasks')),
                TodayChecklistCard(events: events, readOnly: !AuthState.can(AccessScope.careEventEdit), onChanged: () {}),
                if (AuthState.can(AccessScope.medicationView)) ...[
                  SectionLabel(S.t('medicines')),
                  MedicineListCard(events: events),
                ],
                SectionLabel(S.t('appointments')),
                AppointmentCard(events: events),
              ],
              if (pid != null) ...[
                SectionLabel(S.t('records')),
                if (AuthState.can(AccessScope.documentView))
                SaathiCard(
                  onTap: () => AppRoutes.push(context, DocumentsScreen(patientId: pid)),
                  child: InfoRow(
                    icon: Icons.description_outlined,
                    title: S.t('documents'),
                    subtitle: S.t('documentsSub'),
                    trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                  ),
                ),
                if (AuthState.can(AccessScope.symptomView))
                SaathiCard(
                  onTap: () => AppRoutes.push(context, SymptomHistoryScreen(patientId: pid)),
                  child: InfoRow(
                    icon: Icons.monitor_heart_outlined,
                    title: S.t('checkinHistory'),
                    subtitle: S.t('checkinHistorySub'),
                    trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                  ),
                ),
              ],
            ],
          ),
        );
      },
    );
  }
}
