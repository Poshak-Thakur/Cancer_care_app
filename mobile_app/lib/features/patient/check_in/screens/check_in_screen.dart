import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../auth/services/auth_state.dart';
import '../services/check_in_service.dart';

class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  final Map<String, int?> _selected = {'pain': null, 'fatigue': null, 'appetite': null, 'mood': null};
  bool _saving = false;
  bool _saved = false;
  String? _error;

  Future<void> _save() async {
    if (_saving || _saved) return;
    final observations = CheckInService.observationsFromSelections(_selected);
    if (observations.isEmpty) {
      setState(() => _error = S.t('pickOne'));
      return;
    }
    final pid = AuthState.patientId;
    if (pid == null) {
      setState(() => _error = S.t('couldNotSave'));
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await CheckInService().submit(patientId: pid, observations: observations);
      if (!mounted) return;
      setState(() {
        _saving = false;
        _saved = true;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = S.t('couldNotSave');
      });
    }
  }

  Widget _symptomBlock(String key, IconData icon, List<String> levelKeys) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 22),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.primary, size: 22),
              const SizedBox(width: 10),
              Text(S.t(key), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
            ],
          ),
          const SizedBox(height: 10),
          Row(
            children: List.generate(4, (i) {
              final active = _selected[key] == i;
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(right: i == 3 ? 0 : 8),
                  child: InkWell(
                    onTap: _saved ? null : () => setState(() {
                      _selected[key] = i;
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
                            S.t(levelKeys[i]),
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
        return Scaffold(
          backgroundColor: AppColors.bg,
          appBar: AppBar(title: Text(S.t('todaysCheckin'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
              children: [
                Text(S.t('checkinSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
                const SizedBox(height: 20),
                _symptomBlock('pain', Icons.favorite_border, ['none', 'mild', 'moderate', 'severe']),
                _symptomBlock('fatigue', Icons.battery_2_bar, ['none', 'aLittle', 'aLot', 'exhausted']),
                _symptomBlock('appetite', Icons.restaurant, ['good', 'okay', 'low', 'none']),
                _symptomBlock('mood', Icons.sentiment_satisfied_alt, ['good', 'okay', 'low', 'veryLow']),
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
                    decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(14)),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.positive),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            S.t('syncedMsg'),
                            style: const TextStyle(fontSize: 14, color: AppColors.primaryDeep, fontWeight: FontWeight.w500),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  SecondaryButton(label: S.t('doneBtn'), onPressed: () => Navigator.of(context).pop()),
                ] else if (_saving)
                  const SizedBox(
                    height: 52,
                    child: Center(
                      child: SizedBox(
                        width: 26,
                        height: 26,
                        child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary),
                      ),
                    ),
                  )
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
