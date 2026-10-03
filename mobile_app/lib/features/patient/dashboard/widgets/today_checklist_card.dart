import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/widgets/check_row.dart';
import '../../../../core/widgets/saathi_card.dart';

/// "Today" checklist used on Home and Care. Each instance owns its own
/// tick state, seeded from [initialDone].
class TodayChecklistCard extends StatefulWidget {
  final List<String> labelKeys;
  final List<bool> initialDone;

  const TodayChecklistCard({super.key, required this.labelKeys, required this.initialDone});

  @override
  State<TodayChecklistCard> createState() => _TodayChecklistCardState();
}

class _TodayChecklistCardState extends State<TodayChecklistCard> {
  late final List<bool> _done = List<bool>.of(widget.initialDone);

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return SaathiCard(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
          child: Column(
            children: List.generate(_done.length, (i) {
              return CheckRow(
                label: S.t(widget.labelKeys[i]),
                done: _done[i],
                onTap: () => setState(() => _done[i] = !_done[i]),
              );
            }),
          ),
        );
      },
    );
  }
}
