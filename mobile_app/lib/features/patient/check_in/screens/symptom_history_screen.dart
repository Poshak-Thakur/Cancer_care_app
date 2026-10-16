import 'package:flutter/material.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../models/symptom_event.dart';
import '../services/check_in_service.dart';

/// The last 30 check-ins (GET /api/symptoms/history): each symptom's severity
/// from `symptomobservation`, plus the configurable answers from `checkinanswer`
/// with the label of the form version they were answered under.
class SymptomHistoryScreen extends StatefulWidget {
  final String patientId;
  const SymptomHistoryScreen({super.key, required this.patientId});

  @override
  State<SymptomHistoryScreen> createState() => _SymptomHistoryScreenState();
}

class _SymptomHistoryScreenState extends State<SymptomHistoryScreen> {
  List<SymptomEvent>? _items;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final list = await CheckInService().history(widget.patientId);
      if (!mounted) return;
      setState(() { _items = list; _loading = false; _failed = false; });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() { _loading = false; _failed = _items == null; });
    }
  }

  Color _color(int sev) => sev >= 8 ? AppColors.error : (sev >= 5 ? AppColors.rose : AppColors.positive);

  /// Backend codes (PAIN_LEVEL, WATER_INTAKE...) -> translated label.
  String _label(String type) {
    const byCode = {
      'PAIN': 'pain',
      'PAIN_LEVEL': 'pain',
      'FATIGUE': 'fatigue',
      'APPETITE': 'appetite',
      'MOOD': 'mood',
      'NAUSEA': 'nausea',
      'BREATHLESSNESS': 'breathlessness',
      'DIZZINESS': 'dizziness',
      'WATER_INTAKE': 'waterIntake',
      'SLEEP_HOURS': 'sleepHours',
    };
    final key = byCode[type.toUpperCase()];
    if (key != null) return S.t(key);
    final words = type.toLowerCase().split('_').where((w) => w.isNotEmpty).toList();
    if (words.isEmpty) return type;
    words[0] = words[0][0].toUpperCase() + words[0].substring(1);
    return words.join(' ');
  }

  String _numberText(double v) => v == v.roundToDouble() ? v.toStringAsFixed(0) : v.toStringAsFixed(1);

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final items = _items;
        return Scaffold(
          appBar: AppBar(title: Text(S.t('checkinHistory'))),
          body: SafeArea(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => _load(silent: true),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                children: [
                  if (_loading && items == null)
                    const LoadingView()
                  else if (_failed || items == null)
                    ErrorView(message: S.t('loadFailed'), onRetry: _load)
                  else if (items.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 40),
                      child: Text(S.t('noCheckinsYet'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
                    )
                  else
                    for (final e in items) _card(e),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _card(SymptomEvent e) {
    return SaathiCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text('${Ist.shortDay(Ist.dayOf(e.recordedAt))} · ${Ist.clock(e.recordedAt)}', style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5))),
              if (e.source == 'UPDATE')
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(999)),
                  child: Text(S.t('updateTag'), style: const TextStyle(fontSize: 11.5, color: AppColors.primaryDeep, fontWeight: FontWeight.w600)),
                ),
            ],
          ),
          const SizedBox(height: 10),
          for (final o in e.observations)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (o.severity == null && o.numericValue != null)
                    Row(
                      children: [
                        SizedBox(width: 108, child: Text(_label(o.type), style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary))),
                        Text('${_numberText(o.numericValue!)} ${o.unit ?? ''}'.trim(), style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600)),
                      ],
                    )
                  else
                  Row(
                    children: [
                      SizedBox(width: 108, child: Text(_label(o.type), style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary))),
                      Expanded(
                        child: ClipRRect(
                          borderRadius: BorderRadius.circular(999),
                          child: LinearProgressIndicator(
                            value: ((o.severity ?? 0) / 10).clamp(0.0, 1.0),
                            minHeight: 8,
                            color: _color(o.severity ?? 0),
                            backgroundColor: AppColors.ink.withOpacity(0.07),
                          ),
                        ),
                      ),
                      SizedBox(width: 30, child: Text('${o.severity ?? '-'}', textAlign: TextAlign.right, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600))),
                    ],
                  ),
                  if (o.note != null && o.note!.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(o.note!, style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint)),
                    ),
                ],
              ),
            ),
          for (final a in e.answers) _answerRow(a),
        ],
      ),
    );
  }

  /// A configurable answer, shown under the label it had when it was answered.
  Widget _answerRow(CheckInAnswerRecord a) {
    final value = a.displayValue(yes: S.t('yesLabel'), no: S.t('noLabel')).trim();
    if (value.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: a.isLongText && value.length > 24
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(a.label, style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary)),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600, height: 1.35)),
              ],
            )
          : Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(flex: 5, child: Text(a.label, style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary))),
                const SizedBox(width: 10),
                Expanded(flex: 4, child: Text(value, textAlign: TextAlign.right, style: const TextStyle(fontSize: 13.5, fontWeight: FontWeight.w600))),
              ],
            ),
    );
  }
}
