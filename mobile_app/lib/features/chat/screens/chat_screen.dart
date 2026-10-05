import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/theme/app_colors.dart';
import '../models/chat_message.dart';

class ChatScreen extends StatefulWidget {
  const ChatScreen({super.key});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  final _controller = TextEditingController();
  final List<ChatMessage> _messages = [
    ChatMessage("Hi Asha, I saw you completed your check-in today. How's the nausea compared to yesterday?", false, '9:14 AM'),
    ChatMessage('A little better today, thank you for checking', true, '9:20 AM'),
    ChatMessage("That's good to hear. Keep logging as you have been — I'll see you at tomorrow's appointment.", false, '9:21 AM'),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _send() {
    final text = _controller.text.trim();
    if (text.isEmpty) return;
    final now = TimeOfDay.now();
    final time = now.format(context);
    setState(() {
      _messages.add(ChatMessage(text, true, time));
      _controller.clear();
    });
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(18, 20, 18, 10),
              child: Row(
                children: [
                  const CircleAvatar(
                    radius: 22,
                    backgroundColor: AppColors.primaryLight,
                    child: Text('P', style: TextStyle(fontWeight: FontWeight.bold, color: AppColors.primaryDeep)),
                  ),
                  const SizedBox(width: 12),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Priya Nair', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15.5)),
                      Text(S.t('yourNgoCounsellor'), style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                    ],
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 18),
                itemCount: _messages.length,
                itemBuilder: (context, i) {
                  final m = _messages[i];
                  return Align(
                    alignment: m.me ? Alignment.centerRight : Alignment.centerLeft,
                    child: Container(
                      constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.72),
                      margin: const EdgeInsets.only(bottom: 12),
                      child: Column(
                        crossAxisAlignment: m.me ? CrossAxisAlignment.end : CrossAxisAlignment.start,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                            decoration: BoxDecoration(
                              color: m.me ? AppColors.primary : AppColors.surface,
                              border: m.me ? null : Border.all(color: AppColors.ink.withOpacity(0.06)),
                              borderRadius: BorderRadius.only(
                                topLeft: const Radius.circular(16),
                                topRight: const Radius.circular(16),
                                bottomLeft: Radius.circular(m.me ? 16 : 4),
                                bottomRight: Radius.circular(m.me ? 4 : 16),
                              ),
                            ),
                            child: Text(
                              m.text,
                              style: TextStyle(
                                fontSize: 14.5,
                                height: 1.45,
                                color: m.me ? Colors.white : AppColors.ink,
                              ),
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(m.time, style: const TextStyle(fontSize: 10.5, color: AppColors.textFaint)),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.ink.withOpacity(0.08))),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _controller,
                      decoration: InputDecoration(
                        hintText: S.t('typeMessage'),
                        filled: true,
                        fillColor: AppColors.bg,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 11),
                        border: OutlineInputBorder(borderRadius: BorderRadius.circular(999), borderSide: BorderSide.none),
                      ),
                      onSubmitted: (_) => _send(),
                    ),
                  ),
                  const SizedBox(width: 8),
                  CircleAvatar(
                    radius: 22,
                    backgroundColor: AppColors.primary,
                    child: IconButton(icon: const Icon(Icons.send, color: Colors.white, size: 19), onPressed: _send),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }
}
