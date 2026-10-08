import 'package:flutter/material.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../models/care_event.dart';
import '../services/care_event_service.dart';
import 'care_event_labels.dart';

/// A day's care events as a checklist. Tap a row to tick it (COMPLETED, or
/// back to SCHEDULED); long-press for Missed / Snoozed / Cancelled. Changes go
/// to the backend and roll back if the request fails.
class TodayChecklistCard extends StatefulWidget {
  final List<CareEvent> events;

  /// Show the list without letting the user change items.
  final bool readOnly;

  /// Called after a status change was saved (so a parent can refresh counts).
  final VoidCallback? onChanged;
  const TodayChecklistCard({super.key, required this.events, this.readOnly = false, this.onChanged});

  @override
  State<TodayChecklistCard> createState() => _TodayChecklistCardState();
}

class _TodayChecklistCardState extends State<TodayChecklistCard> {
  late List<CareEvent> _events = List<CareEvent>.of(widget.events);

  @override
  void didUpdateWidget(covariant TodayChecklistCard old) {
    super.didUpdateWidget(old);
    if (!identical(old.events, widget.events)) _events = List<CareEvent>.of(widget.events);
  }

  Future<void> _set(int i, String status) async {
    final before = _events[i];
    if (before.completionStatus == status) return;
    setState(() => _events[i] = before.copyWith(completionStatus: status));
    try {
      await CareEventService().updateStatus(before.id, status);
      widget.onChanged?.call();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _events[i] = before);
      if (AccessGuard.handle(context, e)) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('couldNotUpdate'))));
    }
  }

  void _toggle(int i) => _set(i, _events[i].isCompleted ? 'SCHEDULED' : 'COMPLETED');

  Future<void> _more(int i) async {
    final e = _events[i];
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 6),
              child: Align(alignment: Alignment.centerLeft, child: Text(careEventTitle(e), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
            ),
            for (final o in const [
              ['COMPLETED', 'statusCompleted', Icons.check_circle_outline],
              ['MISSED', 'statusMissed', Icons.highlight_off],
              ['SNOOZED', 'statusSnoozed', Icons.snooze],
              ['CANCELLED', 'statusCancelled', Icons.cancel_outlined],
              ['SCHEDULED', 'statusScheduled', Icons.restart_alt],
            ])
              ListTile(
                leading: Icon(o[2] as IconData, color: AppColors.primary),
                title: Text(S.t(o[1] as String)),
                trailing: e.completionStatus == o[0] ? const Icon(Icons.check, color: AppColors.primary) : null,
                onTap: () => Navigator.pop(ctx, o[0] as String),
              ),
          ],
        ),
      ),
    );
    if (choice != null) _set(i, choice);
  }

  @override
  Widget build(BuildContext context) {
    if (_events.isEmpty) {
      return SaathiCard(
        child: Text(S.t('noTasksToday'), style: const TextStyle(fontSize: 14.5, color: AppColors.textSecondary)),
      );
    }
    return SaathiCard(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
      child: Column(
        children: List.generate(_events.length, (i) => _row(i)),
      ),
    );
  }

  Widget _row(int i) {
    final e = _events[i];
    final done = e.isCompleted;
    final dim = done || e.isCancelled;
    final detail = [
      careEventTime(e),
      if (e.location != null) e.location!,
      if (e.isMissed) S.t('statusMissed') else if (e.completionStatus == 'SNOOZED') S.t('statusSnoozed') else if (e.isCancelled) S.t('statusCancelled'),
    ].join(' · ');
    return InkWell(
      onTap: widget.readOnly ? null : () => _toggle(i),
      onLongPress: widget.readOnly ? null : () => _more(i),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 10),
        child: Row(
          children: [
            Container(
              width: 22,
              height: 22,
              decoration: BoxDecoration(
                color: done ? AppColors.positive : Colors.transparent,
                border: Border.all(color: done ? AppColors.positive : AppColors.textFaint, width: 2),
                borderRadius: BorderRadius.circular(7),
              ),
              child: done ? const Icon(Icons.check, size: 14, color: Colors.white) : null,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    careEventTitle(e),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w500,
                      color: dim ? AppColors.textFaint : AppColors.ink,
                      decoration: dim ? TextDecoration.lineThrough : TextDecoration.none,
                    ),
                  ),
                  Text(detail, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                ],
              ),
            ),
            if (!widget.readOnly)
              IconButton(
                visualDensity: VisualDensity.compact,
                icon: const Icon(Icons.more_horiz, size: 20, color: AppColors.textFaint),
                onPressed: () => _more(i),
              ),
          ],
        ),
      ),
    );
  }
}
