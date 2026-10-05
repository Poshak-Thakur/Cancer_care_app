import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/card_icon_box.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/lang_toggle.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/saathi_logo.dart';
import '../../../../core/widgets/section_label.dart';
import '../../../auth/services/auth_state.dart';
import '../../check_in/screens/check_in_screen.dart';
import '../models/dashboard_overview.dart';
import '../services/dashboard_service.dart';
import '../widgets/care_event_labels.dart';
import '../widgets/today_checklist_card.dart';

class HomeScreen extends StatefulWidget {
  final void Function(int index) onNavigate;
  const HomeScreen({super.key, required this.onNavigate});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  DashboardOverview? _data;
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
      final data = await DashboardService().overview(pid);
      if (!mounted) return;
      setState(() {
        _data = data;
        _loading = false;
        _failed = false;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _failed = _data == null; // keep showing old data on a failed refresh
      });
    }
  }

  Future<void> _openCheckIn() async {
    await AppRoutes.push(context, const CheckInScreen());
    if (mounted) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final data = _data;
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(silent: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
            children: [
              Row(
                children: [
                  saathiLogo(),
                  const SizedBox(width: 8),
                  const Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('Saathi', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 17, color: AppColors.primaryDeep)),
                      Text('Itti Foundation', style: TextStyle(fontSize: 11, color: AppColors.textFaint)),
                    ],
                  ),
                  const Spacer(),
                  const LangToggle(),
                ],
              ),
              const SizedBox(height: 20),
              Text(S.greeting(AuthState.firstName), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold, color: AppColors.ink)),
              const SizedBox(height: 2),
              Text(S.t('howFeeling'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
              const SizedBox(height: 18),
              if (_loading && data == null)
                const LoadingView()
              else if (_failed || data == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else
                ..._content(data),
            ],
          ),
        );
      },
    );
  }

  List<Widget> _content(DashboardOverview data) {
    final medCount = data.events.where((e) => e.isMedication).length;
    final appts = data.events.where((e) => e.isAppointment).toList();

    return [
      SaathiCard(
        onTap: _openCheckIn,
        child: InfoRow(
          icon: Icons.sentiment_satisfied_alt,
          title: S.t('imOkay'),
          subtitle: data.checkInCompleted ? S.t('checkinDoneToday') : S.t('letsCheckin'),
          trailing: Icon(
            data.checkInCompleted ? Icons.check_circle : Icons.chevron_right,
            color: data.checkInCompleted ? AppColors.positive : AppColors.primary,
          ),
        ),
      ),
      const SizedBox(height: 14),

      Row(
        children: [
          Expanded(
            child: SaathiCard(
              onTap: () => widget.onNavigate(1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const CardIconBox(Icons.medication_outlined),
                  const SizedBox(height: 10),
                  Text(S.t('medicines'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
                  Text(medCount == 0 ? S.t('noneToday') : S.countToday(medCount),
                      style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                ],
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: SaathiCard(
              onTap: () => widget.onNavigate(1),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const CardIconBox(Icons.calendar_today_outlined),
                  const SizedBox(height: 10),
                  Text(S.t('appointment'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
                  Text(appts.isEmpty ? S.t('noneToday') : careEventTime(appts.first),
                      style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                ],
              ),
            ),
          ),
        ],
      ),
      const SizedBox(height: 14),

      // Chat and community are still demo content (no backend yet).
      SaathiCard(
        rose: true,
        onTap: () => widget.onNavigate(3),
        child: InfoRow(
          icon: Icons.chat_bubble_outline,
          rose: true,
          title: S.t('yourCounsellor'),
          subtitle: S.t('oneNewMessage'),
          trailing: Text(S.t('view'), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.roseText)),
        ),
      ),
      const SizedBox(height: 14),

      SaathiCard(
        rose: true,
        onTap: () => widget.onNavigate(2),
        child: InfoRow(
          icon: Icons.groups_outlined,
          rose: true,
          title: S.t('yourCommunity'),
          subtitle: S.t('threeNewStories'),
          trailing: Text(S.t('view'), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, color: AppColors.roseText)),
        ),
      ),

      SectionLabel(S.t('today')),
      TodayChecklistCard(events: data.events),
    ];
  }
}
