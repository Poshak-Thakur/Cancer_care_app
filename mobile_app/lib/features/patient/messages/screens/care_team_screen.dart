import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/services/auth_state.dart';
import '../../../shared/calls/call_launcher.dart';
import '../models/care_contact.dart';
import '../services/chat_service.dart';
import '../../../shared/helpline/helpline_screen.dart';
import 'chat_screen.dart';
import 'conversations_screen.dart';
import '../../../../core/theme/app_fonts.dart';

/// "My Care Team": NGO staff and linked family caregivers for one patient.
/// Tap a person to chat; use the icons to call. [embedded] is true when shown
/// as a tab (no app bar).
class CareTeamScreen extends StatefulWidget {
  final String? patientId;
  final bool embedded;
  const CareTeamScreen({super.key, this.patientId, this.embedded = true});

  @override
  State<CareTeamScreen> createState() => _CareTeamScreenState();
}

class _CareTeamScreenState extends State<CareTeamScreen> {
  List<CareContact>? _contacts;
  bool _loading = true;
  bool _failed = false;
  String? _opening; // user id of the chat being opened

  String? get _patientId => widget.patientId ?? AuthState.patientId;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    final pid = _patientId;
    if (pid == null) {
      setState(() { _loading = false; _failed = true; });
      return;
    }
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final all = await ChatService().contacts(pid);
      if (!mounted) return;
      setState(() {
        _contacts = all.where((c) => c.userId != AuthState.userId).toList();
        _loading = false;
        _failed = false;
      });
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; _failed = _contacts == null; });
    }
  }

  Future<void> _openChat(CareContact c) async {
    final pid = _patientId;
    if (pid == null || _opening != null) return;
    setState(() => _opening = c.userId);
    try {
      final thread = await ChatService().openThread(patientId: pid, participantId: c.userId);
      if (!mounted) return;
      await AppRoutes.push(context, ChatScreen(thread: thread, peer: c));
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _opening = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final contacts = _contacts;
        final body = RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(silent: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
            children: [
              if (widget.embedded) ...[
                Text(S.t('careTeam'), style: const TextStyle(fontFamily: AppFonts.heading, fontSize: 21, fontWeight: FontWeight.bold)),
                const SizedBox(height: 2),
                Text(S.t('careTeamSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
                const SizedBox(height: 16),
              ],
              SaathiCard(
                rose: true,
                onTap: () => AppRoutes.push(context, const HelplineScreen()),
                child: Row(
                  children: [
                    const Icon(Icons.support_agent, color: AppColors.roseText),
                    const SizedBox(width: 12),
                    Expanded(child: Text(S.t('ngoHelpline'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5))),
                    const Icon(Icons.chevron_right, color: AppColors.roseText),
                  ],
                ),
              ),
              if (widget.embedded)
                SaathiCard(
                  onTap: () => AppRoutes.push(context, const ConversationsScreen(embedded: false)),
                  child: Row(
                    children: [
                      const Icon(Icons.forum_outlined, color: AppColors.primary),
                      const SizedBox(width: 12),
                      Expanded(child: Text(S.t('allConversations'), style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5))),
                      const Icon(Icons.chevron_right, color: AppColors.primary),
                    ],
                  ),
                ),
              if (_loading && contacts == null)
                const LoadingView()
              else if (_failed || contacts == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else if (contacts.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 30),
                  child: Text(S.t('noCareTeam'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.4)),
                )
              else
                for (final c in contacts) _tile(c),
            ],
          ),
        );
        if (widget.embedded) return body;
        return Scaffold(
          appBar: AppBar(
            title: Text(S.t('careTeam')),
            actions: [
              IconButton(
                tooltip: S.t('messages'),
                icon: const Icon(Icons.forum_outlined),
                onPressed: () => AppRoutes.push(context, const ConversationsScreen(embedded: false)),
              ),
            ],
          ),
          body: SafeArea(child: body),
        );
      },
    );
  }

  Widget _tile(CareContact c) {
    final pid = _patientId;
    return SaathiCard(
      onTap: () => _openChat(c),
      child: Row(
        children: [
          UserAvatar(initial: c.initial, radius: 22, teal: c.isStaff || c.isPatient),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.displayName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15.5)),
                const SizedBox(height: 2),
                Text(c.role, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
              ],
            ),
          ),
          if (_opening == c.userId)
            const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primary))
          else ...[
            IconButton(
              tooltip: S.t('audioCall'),
              icon: const Icon(Icons.call_outlined),
              color: AppColors.primary,
              onPressed: pid == null
                  ? null
                  : () => CallLauncher.start(context, receiverId: c.userId, patientId: pid, video: false, peerName: c.displayName),
            ),
            IconButton(
              tooltip: S.t('videoCall'),
              icon: const Icon(Icons.videocam_outlined),
              color: AppColors.primary,
              onPressed: pid == null
                  ? null
                  : () => CallLauncher.start(context, receiverId: c.userId, patientId: pid, video: true, peerName: c.displayName),
            ),
          ],
        ],
      ),
    );
  }
}
