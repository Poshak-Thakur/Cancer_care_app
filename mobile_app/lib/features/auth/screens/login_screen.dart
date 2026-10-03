import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/dragonfly_mark.dart';
import '../../../core/widgets/lang_toggle.dart';
import '../widgets/role_card.dart';
import 'otp_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController(text: AuthState.email);
  bool _showError = false;
  bool _sending = false;
  String? _serverError;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  String get _value => _email.text.trim().toLowerCase();
  bool get _valid => RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$').hasMatch(_value);

  Future<void> _sendOtp() async {
    if (_sending) return;
    FocusScope.of(context).unfocus();
    if (!_valid) {
      setState(() {
        _showError = true;
        _serverError = null;
      });
      return;
    }
    setState(() {
      _showError = false;
      _serverError = null;
      _sending = true;
    });
    try {
      await AuthApiService().requestOtp(_value);
      if (!mounted) return;
      AuthState.email = _value;
      setState(() => _sending = false);
      AppRoutes.push(context, const OtpScreen());
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _sending = false;
        _serverError = AuthState.describe(e, S.t('genericError'));
      });
    }
  }

  void _caregiverSoon() {
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(content: Text(S.t('caregiverSoonMsg'))));
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 14, 22, 28),
              children: [
                Row(
                  children: [
                    const DragonflyMark(size: 28, color: AppColors.rose),
                    const SizedBox(width: 8),
                    const Text('Saathi',
                        style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: AppColors.primaryDeep)),
                    const Spacer(),
                    const LangToggle(),
                  ],
                ),
                const SizedBox(height: 34),
                Text(S.t('welcomeTitle'),
                    style: const TextStyle(fontSize: 26, fontWeight: FontWeight.bold, color: AppColors.ink)),
                const SizedBox(height: 6),
                Text(S.t('welcomeSub'),
                    style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 26),

                Text(S.t('iAmA'),
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textFaint)),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: RoleCard(
                        icon: Icons.favorite_border,
                        title: S.t('rolePatient'),
                        subtitle: S.t('rolePatientSub'),
                        selected: true,
                        onTap: () {},
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: RoleCard(
                        icon: Icons.volunteer_activism_outlined,
                        title: S.t('roleCaregiver'),
                        subtitle: S.t('roleCaregiverSub'),
                        selected: false,
                        enabled: false,
                        badge: S.t('comingSoon'),
                        onTap: _caregiverSoon,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 22),

                Text(S.t('emailLabel'),
                    style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textFaint)),
                const SizedBox(height: 8),
                TextField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.done,
                  autocorrect: false,
                  enableSuggestions: false,
                  autofillHints: const [AutofillHints.email],
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  onChanged: (_) => setState(() {
                    _serverError = null;
                    if (_showError && _valid) _showError = false;
                  }),
                  onSubmitted: (_) => _sendOtp(),
                  decoration: InputDecoration(
                    hintText: S.t('emailHint'),
                    hintStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.normal),
                    filled: true,
                    fillColor: AppColors.surface,
                    prefixIcon: const Icon(Icons.mail_outline, color: AppColors.textSecondary),
                    contentPadding: const EdgeInsets.symmetric(vertical: 16),
                    enabledBorder: _border(_showError ? AppColors.warning : AppColors.ink.withOpacity(0.12)),
                    focusedBorder: _border(_showError ? AppColors.warning : AppColors.primary, width: 1.8),
                  ),
                ),
                if (_showError)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(S.t('emailInvalid'),
                              style: const TextStyle(fontSize: 13, color: AppColors.warning, height: 1.35)),
                        ),
                      ],
                    ),
                  ),
                if (_serverError != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(_serverError!,
                              style: const TextStyle(fontSize: 13, color: AppColors.warning, height: 1.35)),
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
                            child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary),
                          ),
                        ),
                      )
                    : PrimaryButton(label: S.t('sendOtp'), onPressed: _sendOtp),
                const SizedBox(height: 12),
                Text(S.t('otpNote'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint, height: 1.4)),
                const SizedBox(height: 22),

                if (AuthState.showDevBanner) ...[
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: AppColors.roseLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
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
                  const SizedBox(height: 22),
                ],
                Text(S.t('termsNote'),
                    textAlign: TextAlign.center,
                    style: const TextStyle(fontSize: 12, color: AppColors.textFaint, height: 1.4)),
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
