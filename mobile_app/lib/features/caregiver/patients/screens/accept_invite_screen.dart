import 'package:flutter/material.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../auth/services/auth_api_service.dart';
import 'package:flutter/services.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../auth/services/auth_state.dart';
import '../services/caregiver_service.dart';
import 'qr_scan_screen.dart';

/// Caregiver links to a patient by pasting or scanning the invite code.
class AcceptInviteScreen extends StatefulWidget {
  const AcceptInviteScreen({super.key});

  @override
  State<AcceptInviteScreen> createState() => _AcceptInviteScreenState();
}

class _AcceptInviteScreenState extends State<AcceptInviteScreen> {
  final _code = TextEditingController();
  final _label = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    _label.dispose();
    super.dispose();
  }

  Future<void> _paste() async {
    final data = await Clipboard.getData(Clipboard.kTextPlain);
    if (data?.text != null) setState(() => _code.text = data!.text!.trim());
  }

  Future<void> _scan() async {
    final value = await AppRoutes.push<String>(context, const QrScanScreen());
    if (value != null && mounted) setState(() => _code.text = value.trim());
  }

  Future<void> _link() async {
    final code = _code.text.replaceAll(RegExp(r'\s+'), '').toUpperCase();
    if (code.isEmpty || _saving) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await CaregiverService().acceptInvite(inviteToken: code, relationshipLabel: _label.text.trim());
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        // 403 CAREGIVER_NOT_RECOGNIZED: say it in plain words, never "403 Forbidden".
        _error = AccessGuard.isNotRecognized(e) ? S.t('notRecognized') : e.message;
      });
      return;
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('linkedOk'))));
    // Refresh the account (roles, caregiver profile) from the backend, then
    // tell the caller to reload its patient list.
    try {
      final me = await AuthApiService().me();
      AuthState.applyAccount(me);
      AuthState.roles = me.roles;
    } on ApiException {
      // not critical: the patient list is reloaded from its own endpoint
    }
    if (mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('addPatient'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: [
                Text(S.t('inviteHowTo'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 18),
                TextField(
                  controller: _code,
                  maxLines: 1,
                  textCapitalization: TextCapitalization.characters,
                  autocorrect: false,
                  enableSuggestions: false,
                  onChanged: (_) => setState(() => _error = null),
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w600, letterSpacing: 4),
                  decoration: InputDecoration(
                    hintText: S.t('inviteCodeHint'),
                    filled: true,
                    fillColor: AppColors.surface,
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(child: SecondaryButton(label: S.t('pasteCode'), onPressed: _paste)),
                    const SizedBox(width: 10),
                    Expanded(child: SecondaryButton(label: S.t('scanQr'), onPressed: _scan)),
                  ],
                ),
                const SizedBox(height: 18),
                TextField(
                  controller: _label,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: S.t('relationshipLabel'),
                    hintText: S.t('relationshipHint'),
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
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning))),
                      ],
                    ),
                  ),
                _saving
                    ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                    : Opacity(
                        opacity: _code.text.trim().isEmpty ? 0.5 : 1,
                        child: PrimaryButton(label: S.t('linkPatient'), onPressed: _link),
                      ),
              ],
            ),
          ),
        );
      },
    );
  }
}
