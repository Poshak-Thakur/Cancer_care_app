import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/section_label.dart';
import '../../../auth/services/auth_state.dart';
import '../../appointments/widgets/appointment_card.dart';
import '../../medicines/widgets/medicine_list_card.dart';
import '../../nutrition/widgets/learn_card.dart';
import '../models/care_event.dart';
import '../services/care_event_service.dart';
import '../widgets/today_checklist_card.dart';

class CareScreen extends StatefulWidget {
  const CareScreen({super.key});

  @override
  State<CareScreen> createState() => _CareScreenState();
}

class _CareScreenState extends State<CareScreen> {
  List<CareEvent>? _events;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    final pid = AuthState.patientId;
    if (pid == null) {
      setState(() {
        _loading = false;
        _failed = true;
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
      final events = await CareEventService().today(pid);
      if (!mounted) return;
      setState(() {
        _events = events;
        _loading = false;
        _failed = false;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = _events == null;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final events = _events;
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
              if (_loading && events == null)
                const LoadingView()
              else if (_failed || events == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else ...[
                SectionLabel(S.t('today')),
                TodayChecklistCard(events: events),

                SectionLabel(S.t('medicines')),
                MedicineListCard(events: events),

                SectionLabel(S.t('appointments')),
                AppointmentCard(events: events),

                SectionLabel(S.t('learn')),
                const LearnCard(),
              ],
            ],
          ),
        );
      },
    );
  }
}
