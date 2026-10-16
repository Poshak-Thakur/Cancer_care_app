import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/push/push_service.dart';
import '../../../core/realtime/socket_service.dart';
import '../../patient/profile/models/patient.dart';
import '../services/auth_api_service.dart';
import '../../patient/profile/services/patient_service.dart';
import '../services/auth_state.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/lang_toggle.dart';
import '../../patient/patient_shell.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/app_text.dart';

/// Step 1 of onboarding per UI/UX Spec 4.4: name, date of birth, language.
/// That is the entire gate; no medical fields are requested here.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen> {
  final _name = TextEditingController();
  DateTime? _dob;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  bool get _ready => _name.text.trim().length >= 2 && _dob != null;

  String _fmt(DateTime d) {
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return '${d.day} ${m[d.month - 1]} ${d.year}';
  }

  Future<void> _pickDate() async {
    FocusScope.of(context).unfocus();
    final now = DateTime.now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(1970, 1, 1),
      firstDate: DateTime(1900),
      lastDate: now,
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) setState(() => _dob = picked);
  }

  Future<void> _finish() async {
    if (!_ready || _saving) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    final lang = Lang.isHindi.value ? 'hi' : 'en';
    try {
      Patient patient;
      try {
        patient = await PatientService().createProfile(
          fullName: _name.text.trim(),
          dateOfBirth: _dob!,
          preferredLanguage: lang,
        );
      } on ApiException catch (e) {
        // 409: this account already has its own patient profile. Use it.
        final existing = e.statusCode == 409 && e.data is Map ? (e.data as Map)['patient'] : null;
        if (existing is! Map) rethrow;
        patient = Patient.fromJson(Map<String, dynamic>.from(existing));
      }
      if (!mounted) return;
      AuthState.setPatient(patient);
      AuthState.roles = const ['PATIENT'];
      AuthState.role = 'patient';

      // Also store the name on the account so the backend reports
      // is_profile_completed = true on the next sign-in.
      try {
        final account = await AuthApiService().updateProfile(
          fullName: _name.text.trim(),
          dateOfBirth: _dob!,
          preferredLanguage: lang,
        );
        AuthState.applyAccount(account);
      } on ApiException {
        // The patient exists; the router completes the account at next sign-in.
      }
      if (!mounted) return;
      SocketService.instance.start(AuthState.userId);
      PushService.registerForUser();
      AppRoutes.pushAndClear(context, const PatientShell());
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.message.isEmpty ? S.t('couldNotCreateProfile') : e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, isHindi, _) {
        return Scaffold(
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 14, 22, 28),
              children: [
                const Row(children: [Spacer(), LangToggle()]),
                const SizedBox(height: 18),
                Text(S.t('onbTitle'),
                    style: const TextStyle(fontFamily: AppFonts.heading, fontSize: 26, fontWeight: FontWeight.bold, color: AppColors.ink)),
                const SizedBox(height: 6),
                Text(S.t('onbSub'),
                    style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 26),

                _label(S.t('fullName')),
                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.done,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: S.t('nameHint'),
                    hintStyle: const TextStyle(fontSize: 15.5, fontWeight: FontWeight.normal),
                    filled: true,
                    fillColor: AppColors.surface,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                    enabledBorder: _border(AppColors.ink.withOpacity(0.12)),
                    focusedBorder: _border(AppColors.primary, width: 1.8),
                  ),
                ),
                const SizedBox(height: 20),

                _label(S.t('dob')),
                InkWell(
                  onTap: _pickDate,
                  borderRadius: BorderRadius.circular(14),
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius: BorderRadius.circular(14),
                      border: Border.all(color: AppColors.ink.withOpacity(0.12), width: 1.2),
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            _dob == null ? S.t('pickDate') : _fmt(_dob!),
                            style: TextStyle(
                              fontSize: _dob == null ? 15.5 : 17,
                              fontWeight: _dob == null ? FontWeight.normal : FontWeight.w600,
                              color: _dob == null ? AppColors.textFaint : AppColors.ink,
                            ),
                          ),
                        ),
                        const Icon(Icons.calendar_today_outlined, size: 20, color: AppColors.primary),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: 20),

                _label(S.t('prefLang')),
                Row(
                  children: [
                    Expanded(child: _langChip('English', !isHindi, () => Lang.isHindi.value = false)),
                    const SizedBox(width: 12),
                    Expanded(child: _langChip('हिन्दी', isHindi, () => Lang.isHindi.value = true)),
                  ],
                ),
                const SizedBox(height: 24),

                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(12)),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Icon(Icons.lock_outline, size: 18, color: AppColors.primaryDeep),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(S.t('onbPrivacy'),
                            style: const TextStyle(fontSize: 13, color: AppColors.primaryDeep, height: 1.45)),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 24),

                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.error),
                        const SizedBox(width: 6),
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.error))),
                      ],
                    ),
                  ),
                _saving
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
                        opacity: _ready ? 1 : 0.5,
                        child: PrimaryButton(label: S.t('getStarted'), onPressed: _finish),
                      ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t.toUpperCase(), style: AppText.eyebrow),
      );

  OutlineInputBorder _border(Color c, {double width = 1.2}) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: c, width: width),
      );

  Widget _langChip(String label, bool selected, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: selected ? AppColors.primaryLight : AppColors.surface,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.ink.withOpacity(0.12),
            width: selected ? 1.8 : 1.2,
          ),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (selected) const Icon(Icons.check, size: 18, color: AppColors.primary),
            if (selected) const SizedBox(width: 6),
            Text(label,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: selected ? AppColors.primaryDeep : AppColors.textSecondary,
                )),
          ],
        ),
      ),
    );
  }
}
