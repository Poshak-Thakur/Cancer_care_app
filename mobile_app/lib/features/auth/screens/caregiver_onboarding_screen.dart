import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/push/push_service.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/ist.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/lang_toggle.dart';
import '../../caregiver/caregiver_shell.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../widgets/role_card.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/app_text.dart';

/// Caregiver profile completion: full name + date of birth + FAMILY or
/// VOLUNTEER, saved with PATCH /api/auth/profile (this is what marks the
/// profile as completed). The caregiver then enters the caregiver home right
/// away; linking a patient happens later from Profile > Link patient record.
class CaregiverOnboardingScreen extends StatefulWidget {
  const CaregiverOnboardingScreen({super.key});

  @override
  State<CaregiverOnboardingScreen> createState() => _CaregiverOnboardingScreenState();
}

class _CaregiverOnboardingScreenState extends State<CaregiverOnboardingScreen> {
  late final TextEditingController _name = TextEditingController(text: AuthState.accountName ?? '');
  DateTime? _dob = AuthState.accountDob;
  String _type = AuthState.caregiverType ?? 'FAMILY';
  bool _saving = false;
  String? _error;

  bool get _ready => _name.text.trim().length >= 2 && _dob != null;

  Future<void> _pickDob() async {
    FocusScope.of(context).unfocus();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(1985, 1, 1),
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) setState(() { _dob = picked; _error = null; });
  }

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    if (_saving) return;
    if (!_ready) {
      setState(() => _error = _name.text.trim().length < 2 ? S.t('nameRequired') : S.t('dobRequired'));
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final updated = await AuthApiService().updateProfile(
        fullName: _name.text.trim(),
        dateOfBirth: _dob,
        caregiverType: _type,
        preferredLanguage: Lang.isHindi.value ? 'hi' : 'en',
      );
      AuthState.applyAccount(updated);
      AuthState.caregiverType = _type;
      AuthState.role = 'caregiver';
      if (!mounted) return;
      setState(() => _saving = false);
      if (!AuthState.roles.contains('CAREGIVER')) AuthState.roles = [...AuthState.roles.where((r) => r != 'NEW_USER'), 'CAREGIVER'];
      SocketService.instance.start(AuthState.userId);
      PushService.registerForUser();
      AppRoutes.pushAndClear(context, const CaregiverShell());
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.message;
      });
    }
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
                const Row(children: [Spacer(), LangToggle()]),
                const SizedBox(height: 14),
                Text(S.t('cgWelcome'), style: const TextStyle(fontFamily: AppFonts.heading, fontSize: 24, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Text(S.t('cgWelcomeSub'), style: const TextStyle(fontSize: 15.5, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 22),
                Text(S.t('fullName').toUpperCase(), style: AppText.eyebrow),
                const SizedBox(height: 8),
                TextField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
                  onChanged: (_) => setState(() => _error = null),
                  decoration: InputDecoration(
                    hintText: S.t('nameHint'),
                    filled: true,
                    fillColor: AppColors.surface,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                  ),
                ),
                const SizedBox(height: 18),
                Text(S.t('dob').toUpperCase(), style: AppText.eyebrow),
                const SizedBox(height: 8),
                InkWell(
                  onTap: _pickDob,
                  borderRadius: BorderRadius.circular(14),
                  child: InputDecorator(
                    decoration: InputDecoration(
                      filled: true,
                      fillColor: AppColors.surface,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
                      suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20, color: AppColors.primary),
                    ),
                    child: Text(_dob == null ? S.t('pickDate') : Ist.dateLabel(_dob!), style: TextStyle(fontSize: 16.5, color: _dob == null ? AppColors.textFaint : AppColors.ink)),
                  ),
                ),
                const SizedBox(height: 20),
                Row(
                  children: [
                    Expanded(
                      child: RoleCard(
                        icon: Icons.family_restroom,
                        title: S.t('cgFamily'),
                        subtitle: S.t('cgFamilySub'),
                        selected: _type == 'FAMILY',
                        onTap: () => setState(() => _type = 'FAMILY'),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: RoleCard(
                        icon: Icons.volunteer_activism_outlined,
                        title: S.t('cgVolunteer'),
                        subtitle: S.t('cgVolunteerSub'),
                        selected: _type == 'VOLUNTEER',
                        onTap: () => setState(() => _type = 'VOLUNTEER'),
                      ),
                    ),
                  ],
                ),
                if (_type == 'VOLUNTEER')
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(S.t('cgVolunteerNote'), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.4)),
                  ),
                const SizedBox(height: 22),
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
                    ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                    : Opacity(opacity: _ready ? 1 : 0.5, child: PrimaryButton(label: S.t('continueBtn'), onPressed: _continue)),
              ],
            ),
          ),
        );
      },
    );
  }
}
