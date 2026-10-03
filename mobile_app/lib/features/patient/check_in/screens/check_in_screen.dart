import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';

class CheckInScreen extends StatefulWidget {
  const CheckInScreen({super.key});

  @override
  State<CheckInScreen> createState() => _CheckInScreenState();
}

class _CheckInScreenState extends State<CheckInScreen> {
  final Map<String, int?> _selected = {'pain': null, 'fatigue': null, 'appetite': null, 'mood': null};
  bool _saved = false;
  bool _synced = false;

  void _save() {
    setState(() {
      _saved = true;
      _synced = false;
    });
    Future.delayed(const Duration(milliseconds: 1500), () {
      if (mounted) setState(() => _synced = true);
    });
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
                    onTap: () => setState(() => _selected[key] = i),
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
                PrimaryButton(label: S.t('saveCheckin'), onPressed: _save),
                if (_saved) ...[
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(14)),
                    child: Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(shape: BoxShape.circle, color: _synced ? AppColors.positive : AppColors.warning),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _synced ? S.t('syncedMsg') : S.t('savedWaiting'),
                            style: const TextStyle(fontSize: 14, color: AppColors.primaryDeep, fontWeight: FontWeight.w500),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}
