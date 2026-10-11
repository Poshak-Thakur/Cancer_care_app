import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/storage/claim_code_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../services/session_router.dart';
import 'login_screen.dart';

/// "I have a code from Saathi": the NGO has already created the patient's
/// record, and gives the patient a one-time code to claim it.
///
/// Before sign-in ([signedIn] false) the code is only stored (secure storage)
/// and the normal email + OTP screens follow; nothing is sent to the backend
/// yet. After sign-in the router sends it to POST /api/patients/claim.
///
/// [signedIn] true: shown again by the router when the backend refused the
/// code (400). Saving a new code then re-runs the sign-in routing.
class ClaimCodeScreen extends StatefulWidget {
  final bool signedIn;
  final String? message;
  const ClaimCodeScreen({super.key, this.signedIn = false, this.message});

  @override
  State<ClaimCodeScreen> createState() => _ClaimCodeScreenState();
}

class _ClaimCodeScreenState extends State<ClaimCodeScreen> {
  final _code = TextEditingController();
  late String? _error = widget.message;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    final code = ClaimCodeStorage.normalize(_code.text);
    if (!ClaimCodeStorage.isValid(code)) {
      setState(() => _error = S.t('claimCodeInvalid'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    await ClaimCodeStorage.save(code);
    if (!mounted) return;
    if (!widget.signedIn) {
      setState(() => _busy = false);
      AppRoutes.push(context, const LoginScreen(claimMode: true));
      return;
    }
    await _rerunSignIn();
  }

  /// Already signed in: run the routing again (it will use the new code).
  Future<void> _rerunSignIn() async {
    try {
      await SessionRouter.go(context);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message.isEmpty ? S.t('claimRetryFailed') : e.message;
      });
    }
  }

  Future<void> _skip() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    await ClaimCodeStorage.clear();
    if (!mounted) return;
    await _rerunSignIn();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: widget.signedIn ? null : AppBar(),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 18, 22, 28),
              children: [
                Text(S.t('claimTitle'), style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.ink)),
                const SizedBox(height: 8),
                Text(S.t('claimSub'), style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 26),
                Text(S.t('claimCodeLabel'), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textFaint)),
                const SizedBox(height: 8),
                TextField(
                  controller: _code,
                  autofocus: !widget.signedIn,
                  textCapitalization: TextCapitalization.characters,
                  autocorrect: false,
                  enableSuggestions: false,
                  maxLength: 12, // room for spaces or a dash while typing
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _continue(),
                  onChanged: (_) {
                    if (_error != null) setState(() => _error = null);
                  },
                  style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold, letterSpacing: 3),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: S.t('claimCodeHint'),
                    hintStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.normal, letterSpacing: 0),
                    filled: true,
                    fillColor: AppColors.surface,
                    prefixIcon: const Icon(Icons.vpn_key_outlined, color: AppColors.textSecondary),
                    contentPadding: const EdgeInsets.symmetric(vertical: 16),
                    enabledBorder: _border(_error != null ? AppColors.warning : AppColors.ink.withOpacity(0.12)),
                    focusedBorder: _border(_error != null ? AppColors.warning : AppColors.primary, width: 1.8),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning, height: 1.35))),
                      ],
                    ),
                  ),
                const SizedBox(height: 20),
                _busy
                    ? const SizedBox(
                        height: 52,
                        child: Center(child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary))),
                      )
                    : PrimaryButton(label: S.t('claimContinue'), onPressed: _continue),
                if (widget.signedIn) ...[
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: _busy ? null : _skip,
                    child: Text(S.t('claimNoCode'), style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  OutlineInputBorder _border(Color c, {double width = 1.2}) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: c, width: width),
      );
}
