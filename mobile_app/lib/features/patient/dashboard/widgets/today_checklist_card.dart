import 'package:flutter/material.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/check_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../models/care_event.dart';
import '../services/care_event_service.dart';
import 'care_event_labels.dart';

/// Today's care events as a checklist. Ticking a row updates the backend
/// (COMPLETED, or back to SCHEDULED) and rolls back if the request fails.
class TodayChecklistCard extends StatefulWidget {
  final List<CareEvent> events;

  /// Show the list without letting the user tick items.
  final bool readOnly;
  const TodayChecklistCard({super.key, required this.events, this.readOnly = false});

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

  Future<void> _toggle(int i) async {
    final before = _events[i];
    final next = before.isCompleted ? 'SCHEDULED' : 'COMPLETED';
    setState(() => _events[i] = before.copyWith(completionStatus: next));
    try {
      await CareEventService().updateStatus(before.id, next);
    } on ApiException {
      if (!mounted) return;
      setState(() => _events[i] = before);
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('couldNotUpdate'))));
    }
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
        children: List.generate(_events.length, (i) {
          final e = _events[i];
          return CheckRow(
            label: '${careEventTitle(e)} · ${careEventTime(e)}',
            done: e.isCompleted,
            onTap: widget.readOnly ? () {} : () => _toggle(i),
          );
        }),
      ),
    );
  }
}
