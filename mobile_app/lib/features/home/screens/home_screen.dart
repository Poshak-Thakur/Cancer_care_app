import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/state/auth_state.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/card_icon_box.dart';
import '../../../core/widgets/check_row.dart';
import '../../../core/widgets/info_row.dart';
import '../../../core/widgets/lang_toggle.dart';
import '../../../core/widgets/saathi_card.dart';
import '../../../core/widgets/saathi_logo.dart';
import '../../../core/widgets/section_label.dart';
import '../../checkin/screens/checkin_screen.dart';

class HomeScreen extends StatefulWidget {
  final void Function(int index) onNavigate;
  const HomeScreen({super.key, required this.onNavigate});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  final List<bool> _done = [true, true, false, false];
  final List<String> _labelKeys = ['medication', 'checkin', 'appointment', 'counsellorFollowup'];

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return ListView(
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

            SaathiCard(
              onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const CheckInScreen())),
              child: InfoRow(
                icon: Icons.sentiment_satisfied_alt,
                title: S.t('imOkay'),
                subtitle: S.t('letsCheckin'),
                trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
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
                        Text(S.t('twoToday'), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
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
                        Text(S.t('tomorrow'), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),

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
            SaathiCard(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
              child: Column(
                children: List.generate(_done.length, (i) {
                  return CheckRow(
                    label: S.t(_labelKeys[i]),
                    done: _done[i],
                    onTap: () => setState(() => _done[i] = !_done[i]),
                  );
                }),
              ),
            ),
          ],
        );
      },
    );
  }
}
