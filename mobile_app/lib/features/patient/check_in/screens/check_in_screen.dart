import 'package:flutter/material.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../auth/services/auth_state.dart';
import '../services/check_in_service.dart';

/// Today's symptom check-in. Questions come from [checkInQuestions]. A second
/// check-in on the same (IST) day is saved as an UPDATE. Answering "severe"
/// makes the backend raise an alert for the care team, and the screen says so.
class CheckInScreen extends StatefulWidget {
  /// Defaults to the signed-in patient; caregivers pass the patient they view.
  final String? patientId;
  const CheckInScreen({super.key, this.patientId});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  final _service = CheckInService();
  final _note = TextEditingController();
  final String _clientEventId = CheckInService.newClientEventId();
  final Map<String, int?> _selected = {for (final q in checkInQuestions) if (q.kind == CheckInKind.levels) q.key: null};
  final Map<String, TextEditingController> _numbers = {for (final q in checkInQuestions) if (q.kind == CheckInKind.number) q.key: TextEditingController()};

  bool _alreadyDone = false;
  bool _saving = false;
  bool _saved = false;
  bool _severe = false;
  String? _error;

  String? get _pid => widget.patientId ?? AuthState.patientId;

  @override
  void initState() {
    super.initState();
    _checkStatus();
  }

  @override
  void dispose() {
    for (final c in _numbers.values) {
      c.dispose();
    }
    _note.dispose();
    super.dispose();
  }

  Future<void> _checkStatus() async {
    final pid = _pid;
    if (pid == null) return;
    try {
      final done = await _service.completedToday(pid);
      if (mounted) setState(() => _alreadyDone = done);
    } on ApiException {
      // not critical: the first save of the day is simply sent as ROUTINE
    }
  }

  Future<void> _save() async {
    if (_saving || _saved) return;
    final numbers = <String, double?>{
      for (final e in _numbers.entries) e.key: double.tryParse(e.value.text.trim().replaceAll(',', '.')),
    };
    if (_numbers.entries.any((e) => e.value.text.trim().isNotEmpty && numbers[e.key] == null)) {
      setState(() => _error = S.t('enterNumber'));
      return;
    }
    final observations = CheckInService.buildObservations(levels: _selected, numbers: numbers, note: _note.text);
    if (observations.isEmpty) {
      setState(() => _error = S.t('pickOne'));
      return;
    }
    final pid = _pid;
    if (pid == null) {
      setState(() => _error = S.t('couldNotSave'));
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await _service.submit(
        patientId: pid,
        observations: observations,
        source: _alreadyDone ? 'UPDATE' : 'ROUTINE',
        clientEventId: _clientEventId,
      );
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saved = true;
        _severe = CheckInService.hasSevere(observations);
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() {
        _saving = false;
        _error = e.statusCode == 403 ? S.t('limitedAccessSub') : S.t('couldNotSave');
      });
    }
  }

  IconData _icon(IconCodes c) {
    switch (c) {
      case IconCodes.pain:
        return Icons.favorite_border;
      case IconCodes.fatigue:
        return Icons.battery_2_bar;
      case IconCodes.appetite:
        return Icons.restaurant;
      case IconCodes.mood:
        return Icons.sentiment_satisfied_alt;
      case IconCodes.nausea:
        return Icons.sick_outlined;
      case IconCodes.breathing:
        return Icons.air;
      case IconCodes.dizzy:
        return Icons.rotate_right;
      case IconCodes.water:
        return Icons.water_drop_outlined;
      case IconCodes.sleep:
        return Icons.bedtime_outlined;
    }
  }

  Widget _numberBlock(CheckInQuestion q) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_icon(q.icon), color: AppColors.primary, size: 22),
              const SizedBox(width: 10),
              Text(S.t(q.key), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _numbers[q.key],
            enabled: !_saved,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _error = null),
            decoration: InputDecoration(
              suffixText: S.t(q.unitLabelKey ?? ''),
              filled: true,
              fillColor: AppColors.surface,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _symptomBlock(CheckInQuestion q) {
    if (q.kind == CheckInKind.number) return _numberBlock(q);
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_icon(q.icon), color: AppColors.primary, size: 22),
              const SizedBox(width: 10),
              Text(S.t(q.key), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: List.generate(4, (i) {
              final active = _selected[q.key] == i;
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(right: i == 3 ? 0 : 8),
                  child: InkWell(
                    onTap: _saved
                        ? null
                        : () => setState(() {
                              _selected[q.key] = active ? null : i;
                              _error = null;
                            }),
                    borderRadius: BorderRadius.circular(12),
                    child: Container(
                      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 4),
                      decoration: BoxDecoration(
                        color: active ? AppColors.primaryLight : AppColors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: active ? AppColors.primary : AppColors.ink.withOpacity(0.08), width: 1.5),
                      ),
                      child: Column(
                        children: [
                          Container(width: 26, height: 26, decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.primaryLight)),
                          const SizedBox(height: 6),
                          Text(
                            S.t(q.levelKeys[i]),
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: active ? FontWeight.bold : FontWeight.w500,
                              color: active ? AppColors.primaryDeep : AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final core = checkInQuestions.where((q) => !q.extra);
        final extra = checkInQuestions.where((q) => q.extra);
        return Scaffold(
          backgroundColor: AppColors.bg,
          appBar: AppBar(title: Text(S.t('todaysCheckin'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
              children: [
                Text(S.t('checkinSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
                if (_alreadyDone && !_saved)
                  Container(
                    margin: const EdgeInsets.only(top: 12),
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
                    child: Text(S.t('checkinAlreadyDone'), style: const TextStyle(fontSize: 13.5, color: AppColors.primaryDeep, height: 1.4)),
                  ),
                const SizedBox(height: 20),
                for (final q in core) _symptomBlock(q),
                Theme(
                  data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
                  child: ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: EdgeInsets.zero,
                    title: Text(S.t('moreSymptoms'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                    children: [for (final q in extra) _symptomBlock(q)],
                  ),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: _note,
                  enabled: !_saved,
                  minLines: 2,
                  maxLines: 4,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: InputDecoration(
                    hintText: S.t('checkinNoteHint'),
                    filled: true,
                    fillColor: AppColors.surface,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
                const SizedBox(height: 20),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13.5, color: AppColors.warning))),
                      ],
                    ),
                  ),
                if (_saved) ...[
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: _severe ? AppColors.roseLight : AppColors.primaryLight, borderRadius: BorderRadius.circular(14)),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 5),
                          child: Container(width: 8, height: 8, decoration: BoxDecoration(shape: BoxShape.circle, color: _severe ? AppColors.warning : AppColors.positive)),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _severe ? S.t('severeNotice') : S.t('syncedMsg'),
                            style: TextStyle(fontSize: 14, height: 1.4, color: _severe ? AppColors.roseText : AppColors.primaryDeep, fontWeight: FontWeight.w500),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SecondaryButton(label: S.t('doneBtn'), onPressed: () => Navigator.of(context).pop(true)),
                ] else if (_saving)
                  const SizedBox(height: 52, child: Center(child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary))))
                else
                  PrimaryButton(label: S.t('saveCheckin'), onPressed: _save),
              ],
            ),
          ),
        );
      },
    );
  }
}
