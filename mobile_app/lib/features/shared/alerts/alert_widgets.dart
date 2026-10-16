import 'package:flutter/material.dart';
import '../../../core/authorization/access_guard.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/ist.dart';
import '../../../core/widgets/info_row.dart';
import '../../../core/widgets/saathi_card.dart';
import '../../auth/services/auth_state.dart';
import '../../patient/dashboard/models/dashboard_overview.dart';
import '../helpline/helpline_screen.dart';
import 'alert_service.dart';

/// True when the signed-in user sent this Help Now.
bool _isMine(DashboardAlert a) =>
    a.requestedByUserId != null && a.requestedByUserId == AuthState.userId;

String alertTitleFor(DashboardAlert a) {
  switch (a.type) {
    case AlertType.helpRequest:
      return S.t(_isMine(a) ? 'alertHelpMineTitle' : 'alertHelpOtherTitle');
    case AlertType.deterioration:
      return S.t('alertTitle');
    case AlertType.missedMedication:
      return S.t('alertMissedMedTitle');
    case AlertType.missedFollowup:
      return S.t('alertMissedFollowTitle');
    default:
      return S.t('alertGenericTitle');
  }
}

String alertDescriptionFor(DashboardAlert a) {
  switch (a.type) {
    case AlertType.helpRequest:
      return S.t(_isMine(a) ? 'alertHelpMineSub' : 'alertHelpOtherSub');
    case AlertType.deterioration:
      return S.t('alertSub');
    case AlertType.missedMedication:
      return S.t('alertMissedMedSub');
    case AlertType.missedFollowup:
      return S.t('alertMissedFollowSub');
    default:
      return S.t('alertGenericSub');
  }
}

String alertStatusText(String status) {
  switch (status) {
    case AlertStatus.open:
      return S.t('alertStatusOpen');
    case AlertStatus.acknowledged:
      return S.t('alertStatusAcknowledged');
    case AlertStatus.inProgress:
      return S.t('alertStatusInProgress');
    case AlertStatus.resolved:
      return S.t('alertStatusResolved');
    case AlertStatus.cancelled:
      return S.t('alertStatusCancelled');
    case AlertStatus.escalationExhausted:
      return S.t('alertStatusEscalated');
    default:
      return status;
  }
}

IconData alertIconFor(DashboardAlert a) {
  switch (a.type) {
    case AlertType.helpRequest:
      return Icons.front_hand_outlined;
    case AlertType.missedMedication:
      return Icons.medication_outlined;
    case AlertType.missedFollowup:
      return Icons.event_busy_outlined;
    default:
      return Icons.notification_important_outlined;
  }
}

List<DashboardAlert> visibleAlerts(List<DashboardAlert> alerts, {int max = 3}) {
  final help = alerts.where((a) => a.isHelpRequest);
  final others = alerts.where((a) => !a.isHelpRequest);
  return [...help, ...others].take(max).toList();
}

String _when(DateTime t) => '${Ist.shortDay(Ist.dayOf(t))} · ${Ist.clock(t)}';

class AlertCard extends StatefulWidget {
  final DashboardAlert alert;
  final VoidCallback? onChanged;

  const AlertCard({super.key, required this.alert, this.onChanged});

  @override
  State<AlertCard> createState() => _AlertCardState();
}

class _AlertCardState extends State<AlertCard> {
  bool _busy = false;

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(S.t('cancelHelpTitle')),
        content: Text(S.t('cancelHelpBody')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(S.t('keepRequest'))),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(S.t('cancelHelpRequest'), style: const TextStyle(color: AppColors.error)),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await AlertService().cancelHelpNow(widget.alert.id);
      if (!mounted) return;
      setState(() => _busy = false);
      messenger.showSnackBar(SnackBar(content: Text(S.t('helpCancelled'))));
      widget.onChanged?.call();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (AccessGuard.handle(context, e)) return;
      String msg;
      switch (e.code) {
        case 'NOT_CANCELLABLE':
          msg = S.t('helpCancelNotAllowed');
          break;
        case 'REQUESTER_ONLY':
          msg = S.t('helpCancelRequesterOnly');
          break;
        default:
          msg = S.t('helpCancelFailed');
      }
      messenger.showSnackBar(SnackBar(content: Text(msg)));
      if (e.statusCode != null) widget.onChanged?.call();
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = widget.alert;
    final canCancel = a.canBeCancelledBy(AuthState.userId);
    return SaathiCard(
      rose: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          InfoRow(
            icon: alertIconFor(a),
            rose: true,
            title: alertTitleFor(a),
            subtitle:
                '${alertDescriptionFor(a)}\n${S.t('alertStatusLabel')}: ${alertStatusText(a.status)} · ${_when(a.createdAt)}',
          ),
          if (canCancel)
            Align(
              alignment: Alignment.centerRight,
              child: _busy
                  ? const Padding(
                      padding: EdgeInsets.only(top: 10, right: 12),
                      child: SizedBox(
                        width: 20,
                        height: 20,
                        child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.roseText),
                      ),
                    )
                  : TextButton(
                      onPressed: _cancel,
                      child: Text(
                        S.t('cancelHelpRequest'),
                        style: const TextStyle(
                          color: AppColors.roseText,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
            ),
        ],
      ),
    );
  }
}

/// The obvious "Help now" action: asks for confirmation (and an optional note),
/// then POST /api/alerts/help-now.
///
/// Offline-first safety guarantee:
/// If the phone is offline, this NEVER queues silently or claims that help was
/// requested. Instead, it displays an explicit modal dialog warning that the
/// alert was NOT sent because there is no internet connection, with options to
/// retry immediately or open the Helpline.
class HelpNowCard extends StatefulWidget {
  final String patientId;
  final bool forPatient;
  final VoidCallback? onChanged;

  const HelpNowCard({
    super.key,
    required this.patientId,
    this.forPatient = false,
    this.onChanged,
  });

  @override
  State<HelpNowCard> createState() => _HelpNowCardState();
}

class _HelpNowCardState extends State<HelpNowCard> {
  bool _busy = false;
  String? _pendingEventId; // kept across retries of the same press

  Future<void> _press() async {
    if (_busy) return;
    final note = await showDialog<String>(
      context: context,
      builder: (_) => const _HelpNowDialog(),
    );
    if (note == null || !mounted) return;
    await _send(note);
  }

  Future<void> _send(String note) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);
    _pendingEventId ??= AlertService.newClientEventId();
    try {
      final r = await AlertService().helpNow(
        patientId: widget.patientId,
        clientEventId: _pendingEventId!,
        note: note,
      );
      _pendingEventId = null;
      if (!mounted) return;
      setState(() => _busy = false);
      final key = r.replay ? 'helpNowReplay' : (r.created ? 'helpNowSent' : 'helpNowMerged');
      messenger.showSnackBar(SnackBar(content: Text(S.t(key))));
      widget.onChanged?.call();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (e.statusCode != null && e.statusCode! < 500) {
        _pendingEventId = null;
        if (AccessGuard.handle(context, e)) return;
        messenger.showSnackBar(SnackBar(content: Text(S.t('helpNowFailed'))));
        return;
      }

      // Network / offline failure: explicitly warn the patient that the urgent
      // alert has NOT reached the care team.
      await showDialog<void>(
        context: context,
        barrierDismissible: false,
        builder: (ctx) => AlertDialog(
          title: Row(
            children: [
              const Icon(Icons.wifi_off, color: AppColors.error),
              const SizedBox(width: 8),
              Expanded(child: Text(S.t('helpNowOfflineTitle'))),
            ],
          ),
          content: Text(S.t('helpNowOfflineBody')),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text(S.t('close')),
            ),
            TextButton(
              onPressed: () {
                Navigator.pop(ctx);
                AppRoutes.push(context, const HelplineScreen());
              },
              child: Text(S.t('ngoHelpline')),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.roseText,
                foregroundColor: Colors.white,
              ),
              onPressed: () {
                Navigator.pop(ctx);
                _send(note);
              },
              child: Text(S.t('retry')),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Material(
        color: AppColors.roseText,
        borderRadius: BorderRadius.circular(14),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: _busy ? null : _press,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                const Icon(Icons.front_hand, color: Colors.white, size: 28),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        S.t('helpNow'),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.bold,
                          fontSize: 17,
                        ),
                      ),
                      const SizedBox(height: 1),
                      Text(
                        S.t(widget.forPatient ? 'helpNowSubFor' : 'helpNowSub'),
                        style: const TextStyle(color: Colors.white, fontSize: 13, height: 1.3),
                      ),
                    ],
                  ),
                ),
                if (_busy)
                  const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white),
                  )
                else
                  const Icon(Icons.chevron_right, color: Colors.white),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _HelpNowDialog extends StatefulWidget {
  const _HelpNowDialog();

  @override
  State<_HelpNowDialog> createState() => _HelpNowDialogState();
}

class _HelpNowDialogState extends State<_HelpNowDialog> {
  final _note = TextEditingController();

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(S.t('helpNowConfirmTitle')),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(S.t('helpNowConfirmBody')),
          const SizedBox(height: 12),
          TextField(
            controller: _note,
            minLines: 2,
            maxLines: 4,
            maxLength: 1000,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: S.t('helpNowNoteHint'),
              border: const OutlineInputBorder(),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: Text(S.t('cancel'))),
        TextButton(
          onPressed: () => Navigator.pop(context, _note.text.trim()),
          child: Text(
            S.t('helpNowSend'),
            style: const TextStyle(color: AppColors.roseText, fontWeight: FontWeight.bold),
          ),
        ),
      ],
    );
  }
}