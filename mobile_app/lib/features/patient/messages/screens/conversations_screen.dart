import 'dart:async';
import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/realtime/socket_service.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/services/auth_state.dart';
import '../../../shared/helpline/helpline_screen.dart';
import '../models/care_contact.dart';
import '../models/chat_message.dart';
import '../services/chat_service.dart';
import 'chat_screen.dart';

/// Inbox: every conversation the user is in (care team, family and the NGO
/// helpline), newest first, with unread markers. Refreshes live when a new
/// message arrives.
class ConversationsScreen extends StatefulWidget {
  /// True when shown as a tab (no app bar).
  final bool embedded;
  const ConversationsScreen({super.key, this.embedded = true});

  @override
  State<ConversationsScreen> createState() => _ConversationsScreenState();
}

class _ConversationsScreenState extends State<ConversationsScreen> {
  final _chat = ChatService();
  List<ConversationSummary>? _items;
  bool _loading = true;
  bool _failed = false;
  StreamSubscription<ChatMessage>? _sub;

  @override
  void initState() {
    super.initState();
    _load();
    _sub = SocketService.instance.newMessages.listen((_) => _load(silent: true));
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final list = await _chat.conversations();
      if (!mounted) return;
      setState(() { _items = list; _loading = false; _failed = false; });
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; _failed = _items == null; });
    }
  }

  String _peerId(ConversationSummary c) => c.thread.peerOf(AuthState.userId);

  String _peerName(ConversationSummary c) {
    final id = _peerId(c);
    return ContactDirectory.nameFor(id) ?? c.accountNameOf(id) ?? S.t('careTeamMember');
  }

  Future<void> _open(ConversationSummary c) async {
    final id = _peerId(c);
    final known = ContactDirectory.contactFor(id);
    final peer = known ?? CareContact(userId: id, name: _peerName(c), role: '', category: 'CAREGIVER');
    await AppRoutes.push(context, ChatScreen(thread: c.thread, peer: peer));
    if (mounted) _load(silent: true);
  }

  String _preview(ConversationSummary c) {
    final m = c.last;
    if (m == null) return S.t('noMessagesYet');
    final mine = m.senderId == AuthState.userId ? '${S.t('you')}: ' : '';
    if (m.type == 'AUDIO') return '$mine🎤 ${S.t('voiceNote')}';
    return '$mine${m.content ?? ''}';
  }

  String _when(DateTime t) {
    final today = Ist.today();
    final d = Ist.dayOf(t);
    if (Ist.sameDay(d, today)) return Ist.clock(t);
    return Ist.shortDay(d);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final items = _items;
        final body = RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(silent: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
            children: [
              if (widget.embedded) ...[
                Text(S.t('messages'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
                const SizedBox(height: 2),
                Text(S.t('messagesSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
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
              if (_loading && items == null)
                const LoadingView()
              else if (_failed || items == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else if (items.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 30),
                  child: Text(S.t('noConversations'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.4)),
                )
              else
                for (final c in items) _tile(c),
            ],
          ),
        );
        if (widget.embedded) return body;
        return Scaffold(appBar: AppBar(title: Text(S.t('messages'))), body: SafeArea(child: body));
      },
    );
  }

  Widget _tile(ConversationSummary c) {
    final unread = c.unreadFor(AuthState.userId);
    final name = _peerName(c);
    return SaathiCard(
      onTap: () => _open(c),
      child: Row(
        children: [
          UserAvatar(initial: name, radius: 22, teal: ContactDirectory.contactFor(_peerId(c))?.isStaff ?? false),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(name, style: TextStyle(fontWeight: unread ? FontWeight.bold : FontWeight.w600, fontSize: 15.5)),
                const SizedBox(height: 2),
                Text(_preview(c),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(fontSize: 13, color: unread ? AppColors.ink : AppColors.textSecondary, fontWeight: unread ? FontWeight.w600 : FontWeight.normal)),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (c.last != null) Text(_when(c.last!.createdAt), style: const TextStyle(fontSize: 11.5, color: AppColors.textFaint)),
              const SizedBox(height: 6),
              if (unread) Container(width: 10, height: 10, decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.primary)),
            ],
          ),
        ],
      ),
    );
  }
}
