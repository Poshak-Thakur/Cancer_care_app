import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/card_icon_box.dart';
import '../../../core/widgets/saathi_card.dart';
import '../../patient/messages/models/care_contact.dart';
import '../../patient/messages/screens/chat_screen.dart';
import '../../patient/messages/services/chat_service.dart';
import '../calls/call_launcher.dart';
import 'helpline_service.dart';

/// Direct line to the NGO team. Works for anyone signed in, even before they
/// are linked to a patient, so chat and calls here carry no patient id.
class HelplineScreen extends StatefulWidget {
  const HelplineScreen({super.key});

  @override
  State<HelplineScreen> createState() => _HelplineScreenState();
}

class _HelplineScreenState extends State<HelplineScreen> {
  CareContact? _staff;
  bool _loading = true;
  bool _opening = false;

  @override
  void initState() {
    super.initState();
    _resolve();
  }

  Future<void> _resolve() async {
    setState(() => _loading = true);
    final c = await HelplineService.resolve();
    if (!mounted) return;
    setState(() {
      _staff = c == null
          ? null
          : CareContact(userId: c.userId, name: S.t('ngoHelpline'), role: c.role.isEmpty ? 'NGO Staff' : c.role, category: 'STAFF');
      _loading = false;
    });
  }

  void _toast(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _chat() async {
    final staff = _staff;
    if (staff == null || _opening) return;
    setState(() => _opening = true);
    try {
      final thread = await ChatService().openThread(patientId: null, participantId: staff.userId);
      if (!mounted) return;
      await AppRoutes.push(context, ChatScreen(thread: thread, peer: staff));
    } on ApiException catch (e) {
      _toast(e.message);
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  void _call(bool video) {
    final staff = _staff;
    if (staff == null) return;
    CallLauncher.start(context, receiverId: staff.userId, patientId: null, video: video, peerName: staff.displayName);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('ngoHelpline'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: [
                SaathiCard(
                  rose: true,
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const CardIconBox(Icons.support_agent, rose: true),
                      const SizedBox(width: 14),
                      Expanded(
                        child: Text(S.t('helplineExplain'), style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.ink)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),
                if (_loading)
                  const Padding(padding: EdgeInsets.symmetric(vertical: 40), child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                else if (_staff == null) ...[
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 20),
                    child: Text(S.t('helplineUnavailable'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.4)),
                  ),
                  SecondaryButton(label: S.t('retry'), onPressed: _resolve),
                ] else ...[
                  _opening
                      ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                      : PrimaryButton(label: S.t('chatWithHelpline'), onPressed: _chat),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(child: SecondaryButton(label: S.t('audioCall'), onPressed: () => _call(false))),
                      const SizedBox(width: 10),
                      Expanded(child: SecondaryButton(label: S.t('videoCall'), onPressed: () => _call(true))),
                    ],
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
