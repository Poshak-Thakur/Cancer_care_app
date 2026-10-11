import 'package:flutter/material.dart';
import '../../../core/authorization/access_guard.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/async_states.dart';
import '../../auth/services/auth_state.dart';
import '../../patient/dashboard/models/dashboard_overview.dart';
import '../../patient/dashboard/services/dashboard_service.dart';
import 'alert_service.dart';
import 'alert_widgets.dart';

/// Opens one alert, usually from a tapped notification. A notification is not
/// proof the alert is still open, so the alert is ALWAYS re-read from the
/// backend (the patient's active alerts) before any action is offered.
class AlertDetailScreen extends StatefulWidget {
  final String alertId;
  final String? patientId; // from the push; falls back to the selected patient
  const AlertDetailScreen({super.key, required this.alertId, this.patientId});

  @override
  State<AlertDetailScreen> createState() => _AlertDetailScreenState();
}

class _AlertDetailScreenState extends State<AlertDetailScreen> {
  DashboardAlert? _alert;
  bool _loading = true;
  bool _failed = false;

  String? get _pid => widget.patientId ?? AuthState.patientId;

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
    if (!silent) {
      setState(() {
        _loading = true;
        _failed = false;
      });
    }
    try {
      // Same data the dashboard shows (open / acknowledged / in-progress alerts).
      final overview = await DashboardService().overview(pid);
      DashboardAlert? found;
      for (final a in overview.alerts) {
        if (a.id == widget.alertId) found = a;
      }
      if (!mounted) return;
      setState(() {
        _alert = found; // null: it is no longer active
        _loading = false;
        _failed = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  void _changed() {
    AlertEvents.notifyChanged(); // dashboards behind this screen reload too
    _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final alert = _alert;
        return Scaffold(
          backgroundColor: AppColors.bg,
          appBar: AppBar(title: Text(S.t('alertDetailTitle'))),
          body: SafeArea(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => _load(silent: true),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 12, 18, 24),
                children: [
                  if (_loading)
                    const LoadingView()
                  else if (_failed)
                    ErrorView(message: S.t('alertLoadFailed'), onRetry: _load)
                  else if (alert == null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 40),
                      child: Text(S.t('alertNoLongerOpen'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
                    )
                  else
                    AlertCard(alert: alert, onChanged: _changed),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

/// Opens alerts from outside the widget tree (notification taps).
class AlertNavigator {
  AlertNavigator._();

  /// Opens the alert now when the app is signed in and has a navigator;
  /// otherwise remembers it for [openPendingIfAny]. Returns true if opened.
  static bool open(String alertId, {String? patientId}) {
    final nav = AppRoutes.navigatorKey.currentState;
    if (nav == null || AuthState.userId.isEmpty) {
      AlertEvents.pendingOpen = PendingAlertOpen(alertId, patientId);
      return false;
    }
    nav.push(MaterialPageRoute(builder: (_) => AlertDetailScreen(alertId: alertId, patientId: patientId)));
    return true;
  }

  /// Called by the signed-in shells once they are on screen (covers a cold
  /// start from a notification tap).
  static void openPendingIfAny() {
    final p = AlertEvents.pendingOpen;
    if (p == null || AuthState.userId.isEmpty) return;
    AlertEvents.pendingOpen = null;
    open(p.alertId, patientId: p.patientId);
  }
}
