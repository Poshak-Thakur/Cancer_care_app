import 'package:flutter/material.dart';
import '../../../core/constants/app_brand.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/storage/claim_code_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/app_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dragonfly_mark.dart';
import '../../../core/widgets/lang_toggle.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../widgets/role_card.dart';
import 'claim_code_screen.dart';
import 'otp_screen.dart';

class LoginScreen extends StatefulWidget {
  final bool claimMode;
  const LoginScreen({super.key, this.claimMode = false});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  String _role = 'patient';
  String? _claimCode;
  bool _showError = false;
  String? _serverError;
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    if (widget.claimMode) {
      ClaimCodeStorage.read().then((c) {
        if (mounted) setState(() => _claimCode = c);
      });
    }
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  bool get _valid => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(_email.text.trim());

  String? get _message => _showError ? S.t('emailInvalid') : _serverError;

  Future<void> _sendOtp() async {
    if (_sending) return;
    FocusScope.of(context).unfocus();
    if (!_valid) {
      setState(() => _showError = true);
      return;
    }
    final email = _email.text.trim().toLowerCase();
    if (!widget.claimMode) await ClaimCodeStorage.clear();
    setState(() {
      _showError = false;
      _serverError = null;
      _sending = true;
    });
    try {
      await AuthApiService().requestOtp(email);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _serverError = e.message;
      });
      return;
    }
    if (!mounted) return;
    AuthState.email = email;
    AuthState.role = widget.claimMode ? 'patient' : _role;
    setState(() => _sending = false);
    AppRoutes.push(context, const OtpScreen());
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final message = _message;
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 14, 22, 28),
              children: [
                Row(
                  children: [
                    const DragonflyMark(size: 28, color: AppColors.rose),
                    const SizedBox(width: 8),
                    const Text(
                      AppBrand.name,
                      style: TextStyle(
                        fontFamily: AppFonts.heading,
                        fontWeight: FontWeight.bold,
                        fontSize: 18,
                        color: AppColors.primaryDeep,
                      ),
                    ),
                    const Spacer(),
                    const LangToggle(),
                  ],
                ),
                const SizedBox(height: 34),
                Text(
                  S.t('welcomeTitle'),
                  style: const TextStyle(
                    fontFamily: AppFonts.heading,
                    fontSize: 26,
                    fontWeight: FontWeight.bold,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 6),
                Text(
                  S.t('welcomeSub'),
                  style: const TextStyle(
                    fontSize: 15.5,
                    color: AppColors.textSecondary,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 26),
                if (widget.claimMode) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.roseLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.vpn_key_outlined, size: 18, color: AppColors.roseText),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            S.t('claimUsing'),
                            style: const TextStyle(
                              fontSize: 13.5,
                              color: AppColors.roseText,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        if (_claimCode != null)
                          Text(
                            '••••${_claimCode!.substring(_claimCode!.length - 2)}',
                            style: const TextStyle(
                              fontSize: 13.5,
                              color: AppColors.roseText,
                              letterSpacing: 1,
                            ),
                          ),
                        TextButton(
                          onPressed: () => Navigator.of(context).pop(),
                          child: Text(
                            S.t('claimChange'),
                            style: const TextStyle(
                              color: AppColors.roseText,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 22),
                ] else ...[
                  Text(S.t('iAmA').toUpperCase(), style: AppText.eyebrow),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: RoleCard(
                          icon: Icons.favorite_border,
                          title: S.t('rolePatient'),
                          subtitle: S.t('rolePatientSub'),
                          selected: _role == 'patient',
                          onTap: () => setState(() => _role = 'patient'),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: RoleCard(
                          icon: Icons.volunteer_activism_outlined,
                          title: S.t('roleCaregiver'),
                          subtitle: S.t('roleCaregiverSub'),
                          selected: _role == 'caregiver',
                          onTap: () => setState(() => _role = 'caregiver'),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 22),
                ],
                Text(S.t('emailLabel').toUpperCase(), style: AppText.eyebrow),
                const SizedBox(height: 8),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.done,
                  autocorrect: false,
                  enableSuggestions: false,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  onChanged: (_) => setState(() {
                    if (_showError && _valid) _showError = false;
                    _serverError = null;
                  }),
                  onSubmitted: (_) => _sendOtp(),
                  decoration: InputDecoration(
                    hintText: S.t('emailHint'),
                    hintStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.normal),
                    filled: true,
                    fillColor: AppColors.surface,
                    prefixIcon: const Icon(Icons.mail_outline, color: AppColors.textSecondary),
                    contentPadding: const EdgeInsets.symmetric(vertical: 16),
                    enabledBorder: _border(
                      message != null ? AppColors.error : AppColors.ink.withOpacity(0.12),
                    ),
                    focusedBorder: _border(
                      message != null ? AppColors.error : AppColors.primary,
                      width: 1.8,
                    ),
                  ),
                ),
                if (message != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.error),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            message,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.error,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 20),
                _sending
                    ? const SizedBox(
                        height: 52,
                        child: Center(
                          child: SizedBox(
                            width: 26,
                            height: 26,
                            child: CircularProgressIndicator(
                              strokeWidth: 3,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      )
                    : PrimaryButton(
                        label: widget.claimMode ? S.t('sendOtp') : S.t('getStarted'),
                        onPressed: _sendOtp,
                      ),
                if (!widget.claimMode) ...[
                  const SizedBox(height: 10),
                  SecondaryButton(
                    label: S.t('haveCode'),
                    onPressed: _sending
                        ? () {}
                        : () => AppRoutes.push(context, const ClaimCodeScreen()),
                  ),
                ],
                const SizedBox(height: 12),
                Text(
                  S.t('otpNote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textFaint,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: 22),
                Text(
                  S.t('termsNote'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textFaint,
                    height: 1.4,
                  ),
                ),
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