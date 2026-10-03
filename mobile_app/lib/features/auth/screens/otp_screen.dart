import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/lang_toggle.dart';
import 'session_gate_screen.dart';

class OtpScreen extends StatefulWidget {
  const OtpScreen({super.key});

  @override
  State<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends State<OtpScreen> {
  static const _length = 6;
  static const _resendSeconds = 30;

  final _controller = TextEditingController();
  final _focus = FocusNode();
  Timer? _timer;
  int _secondsLeft = _resendSeconds;
  bool _verifying = false;
  bool _resending = false;
  String? _error; // localized message shown under the code boxes

  @override
  void initState() {
    super.initState();
    _startTimer();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _controller.dispose();
    _focus.dispose();
    super.dispose();
  }

  void _startTimer() {
    _timer?.cancel();
    _secondsLeft = _resendSeconds;
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() {
        if (_secondsLeft > 0) {
          _secondsLeft--;
        } else {
          t.cancel();
        }
      });
    });
  }

  Future<void> _resend() async {
    if (_resending) return;
    setState(() {
      _resending = true;
      _error = null;
    });
    try {
      await AuthApiService().requestOtp(AuthState.email);
      if (!mounted) return;
      _controller.clear();
      _startTimer();
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('codeSent'))));
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = AuthState.describe(e, S.t('genericError')));
    } finally {
      if (mounted) setState(() => _resending = false);
    }
  }

  Future<void> _verify() async {
    if (_controller.text.length != _length || _verifying) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _verifying = true;
      _error = null;
    });
    try {
      final user = await AuthApiService().verifyOtp(email: AuthState.email, otp: _controller.text);
      if (!mounted) return;
      AuthState.userId = user['id']?.toString();
      // Find this user's patient (or send them to onboarding) on the next screen,
      // which also offers "Try again" if the server can't be reached.
      AppRoutes.pushAndClear(context, const SessionGateScreen());
    } catch (e) {
      if (!mounted) return;
      final api = e is ApiException ? e : null;
      final wrongCode = api?.isUnauthorized ?? false;
      final expired = wrongCode && api!.message.toLowerCase().contains('expired');
      setState(() {
        _verifying = false;
        _error = expired
            ? S.t('otpExpired')
            : wrongCode
                ? S.t('otpWrong')
                : AuthState.describe(e, S.t('genericError'));
      });
      _controller.clear();
      _focus.requestFocus();
    }
  }

  String get _timerLabel {
    final s = _secondsLeft.toString().padLeft(2, '0');
    return '${S.t('resendIn')} 0:$s';
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final code = _controller.text;
        return Scaffold(
          appBar: AppBar(
            actions: const [LangToggle(), SizedBox(width: 16)],
          ),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 10, 22, 28),
              children: [
                Text(S.t('verifyTitle'),
                    style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: AppColors.ink)),
                const SizedBox(height: 6),
                Text(S.t('verifySub'),
                    style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary)),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Flexible(
                      child: Text(AuthState.email,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(fontSize: 16.5, fontWeight: FontWeight.bold, color: AppColors.ink)),
                    ),
                    const SizedBox(width: 4),
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: Text(S.t('changeEmail'),
                          style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600)),
                    ),
                  ],
                ),
                const SizedBox(height: 22),

                // Six visible boxes, driven by one invisible text field on top.
                Stack(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: List.generate(_length, (i) {
                        final filled = i < code.length;
                        final active = i == code.length && !_verifying;
                        final wrong = _error != null;
                        return Container(
                          width: 46,
                          height: 58,
                          alignment: Alignment.center,
                          decoration: BoxDecoration(
                            color: AppColors.surface,
                            borderRadius: BorderRadius.circular(12),
                            border: Border.all(
                              color: wrong
                                  ? AppColors.warning
                                  : (active ? AppColors.primary : AppColors.ink.withOpacity(0.12)),
                              width: active || wrong ? 1.8 : 1.2,
                            ),
                          ),
                          child: Text(filled ? code[i] : '',
                              style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: AppColors.ink)),
                        );
                      }),
                    ),
                    Positioned.fill(
                      child: Opacity(
                        opacity: 0,
                        child: TextField(
                          controller: _controller,
                          focusNode: _focus,
                          autofocus: true,
                          enableInteractiveSelection: false,
                          keyboardType: TextInputType.number,
                          inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(_length)],
                          onChanged: (_) {
                            if (_error != null) setState(() => _error = null);
                          },
                          onSubmitted: (_) => _verify(),
                        ),
                      ),
                    ),
                  ],
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Row(
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning)),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 24),

                _verifying
                    ? const SizedBox(
                        height: 52,
                        child: Center(
                          child: SizedBox(
                            width: 26,
                            height: 26,
                            child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary),
                          ),
                        ),
                      )
                    : Opacity(
                        opacity: code.length == _length ? 1 : 0.5,
                        child: PrimaryButton(label: S.t('verify'), onPressed: _verify),
                      ),
                const SizedBox(height: 14),
                Center(
                  child: _secondsLeft > 0
                      ? Text(_timerLabel, style: const TextStyle(fontSize: 14, color: AppColors.textFaint))
                      : TextButton(
                          onPressed: _resending ? null : _resend,
                          child: Text(S.t('resendNow'),
                              style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600, fontSize: 15)),
                        ),
                ),
                const SizedBox(height: 18),
                if (AuthState.showDevBanner)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: AppColors.roseLight, borderRadius: BorderRadius.circular(12)),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.science_outlined, size: 18, color: AppColors.roseText),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(S.t('demoBanner'),
                            style: const TextStyle(fontSize: 12.5, color: AppColors.roseText, height: 1.4)),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
