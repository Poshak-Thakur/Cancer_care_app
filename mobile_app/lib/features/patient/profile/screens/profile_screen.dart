import 'package:flutter/material.dart';
import '../../../../core/authorization/access_scope.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/storage/local_offline_storage.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/section_label.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/screens/login_screen.dart';
import '../../../auth/screens/patient_picker_screen.dart';
import '../../../auth/services/auth_api_service.dart';
import '../../../auth/services/auth_state.dart';
import '../../../caregiver/patients/services/caregiver_service.dart';
import '../../../shared/helpline/helpline_screen.dart';
import '../../../shared/profile/edit_profile_screen.dart';
import '../../check_in/screens/symptom_history_screen.dart';
import '../../documents/screens/documents_screen.dart';
import '../../messages/models/care_contact.dart';
import '../../messages/services/chat_service.dart';
import 'edit_patient_record_screen.dart';
import 'invite_caregiver_screen.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  List<CareContact> _caregivers = const [];

  @override
  void initState() {
    super.initState();
    _loadCaregivers();
  }

  /// Linked caregivers come from the care-team contact list (cached for offline view).
  Future<void> _loadCaregivers() async {
    final pid = AuthState.patientId;
    if (pid == null) return;
    final cacheKey = 'caregivers_list_$pid';
    try {
      final all = await ChatService().contacts(pid);
      ContactDirectory.remember(all);
      final cg = all.where((c) => c.category == 'CAREGIVER').toList();
      await LocalOfflineStore.instance.putCache(
        cacheKey: cacheKey,
        patientId: pid,
        data: cg
            .map((c) => {
                  'user_id': c.userId,
                  'name': c.name,
                  'role': c.role,
                  'category': c.category,
                })
            .toList(),
      );
      if (mounted) setState(() => _caregivers = cg);
    } catch (_) {
      final cached = await LocalOfflineStore.instance.getCache(cacheKey);
      if (cached != null && cached.data is List && mounted) {
        setState(() {
          _caregivers = (cached.data as List)
              .map((m) => CareContact.fromJson(Map<String, dynamic>.from(m as Map)))
              .toList();
        });
      }
    }
  }

  Future<void> _edit() async {
    await AppRoutes.push(context, const EditProfileScreen());
    if (mounted) setState(() {});
  }

  Future<void> _editRecord() async {
    await AppRoutes.push(context, const EditPatientRecordScreen());
    if (mounted) setState(() {});
  }

  Future<void> _invite() async {
    await AppRoutes.push(context, const InviteCaregiverScreen());
    _loadCaregivers();
  }

  Future<void> _revoke(CareContact c) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        title: Text(
          S.t('revokeTitle'),
          style: const TextStyle(
            fontFamily: AppFonts.heading,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
        content: Text(
          S.revokeBody(c.displayName),
          style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(S.t('cancel'))),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              S.t('revokeAccess'),
              style: const TextStyle(color: AppColors.error, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await CaregiverService().revoke(patientId: AuthState.patientId!, caregiverUserId: c.userId);
      if (mounted) {
        setState(() => _caregivers = _caregivers.where((x) => x.userId != c.userId).toList());
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final p = AuthState.patient;
        final pid = AuthState.patientId;
        return ListView(
          padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
          children: [
            Text(
              S.t('yourProfile'),
              style: const TextStyle(
                fontFamily: AppFonts.heading,
                fontSize: 21,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 2),
            Text(
              S.t('profileSub'),
              style: const TextStyle(fontSize: 15, color: AppColors.textSecondary),
            ),
            const SizedBox(height: 18),
            SaathiCard(
              onTap: _edit,
              child: Row(
                children: [
                  UserAvatar(url: AuthState.avatarUrl, initial: AuthState.initial, radius: 28),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          AuthState.fullName,
                          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17),
                        ),
                        if (AuthState.isManagingOther)
                          Text(
                            '${S.t('managingFor')} ${p?.fullName ?? ''}',
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.primaryDeep,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        Text(
                          _bornMeta(),
                          style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                        ),
                        Text(
                          AuthState.hasEmail ? AuthState.maskedEmail : S.t('emailNotLinkedYet'),
                          style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint),
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.edit_outlined, color: AppColors.primary, size: 20),
                ],
              ),
            ),

            // Shown when the patient opened Dost with an NGO invitation code and
            // has not attached an email address yet.
            if (!AuthState.hasEmail)
              _LinkEmailInlineCard(
                onLinked: () {
                  if (mounted) setState(() {});
                },
              ),

            if (AuthState.patientLinks.length > 1)
              SaathiCard(
                onTap: () => AppRoutes.push(
                  context,
                  PatientPickerScreen(links: AuthState.patientLinks),
                ),
                child: InfoRow(
                  icon: Icons.swap_horiz,
                  title: S.t('switchPatient'),
                  subtitle: p?.fullName,
                  trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                ),
              ),
            if (p != null && AuthState.can(AccessScope.accountOperate))
              SaathiCard(
                onTap: _editRecord,
                child: InfoRow(
                  icon: Icons.assignment_ind_outlined,
                  title: S.t('editPatientRecord'),
                  subtitle: p.fullName,
                  trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                ),
              ),
            if (p != null &&
                (p.cancerType != null || p.cancerStage != null || p.diagnosisDate != null)) ...[
              SectionLabel(S.t('moreAboutYou')),
              SaathiCard(
                child: Column(
                  children: [
                    if (p.cancerType != null) _fact(S.t('cancerType'), p.cancerType!),
                    if (p.cancerStage != null) _fact(S.t('cancerStage'), p.cancerStage!),
                    if (p.diagnosisDate != null)
                      _fact(S.t('diagnosisDate'), Ist.dateLabel(p.diagnosisDate!)),
                  ],
                ),
              ),
            ],
            SectionLabel(S.t('records')),
            if (pid != null) ...[
              if (AuthState.can(AccessScope.documentView))
                SaathiCard(
                  onTap: () => AppRoutes.push(context, DocumentsScreen(patientId: pid)),
                  child: InfoRow(
                    icon: Icons.description_outlined,
                    title: S.t('documents'),
                    subtitle: S.t('documentsSub'),
                    trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                  ),
                ),
              if (AuthState.can(AccessScope.symptomView))
                SaathiCard(
                  onTap: () => AppRoutes.push(context, SymptomHistoryScreen(patientId: pid)),
                  child: InfoRow(
                    icon: Icons.monitor_heart_outlined,
                    title: S.t('checkinHistory'),
                    subtitle: S.t('checkinHistorySub'),
                    trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                  ),
                ),
            ],
            if (AuthState.can(AccessScope.careCircleManage)) SectionLabel(S.t('linkedCaregiver')),
            if (AuthState.can(AccessScope.careCircleManage))
              for (final c in _caregivers)
                SaathiCard(
                  child: Row(
                    children: [
                      UserAvatar(initial: c.initial, radius: 20),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              c.displayName,
                              style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15),
                            ),
                            if (c.role.isNotEmpty)
                              Text(
                                c.role,
                                style: const TextStyle(
                                  fontSize: 12.5,
                                  color: AppColors.textSecondary,
                                ),
                              ),
                          ],
                        ),
                      ),
                      TextButton(
                        onPressed: () => _revoke(c),
                        child: Text(
                          S.t('revokeAccess'),
                          style: const TextStyle(color: AppColors.error, fontSize: 13),
                        ),
                      ),
                    ],
                  ),
                ),
            if (AuthState.can(AccessScope.careCircleManage))
              SaathiCard(
                onTap: _invite,
                child: InfoRow(
                  icon: Icons.person_add_alt_1_outlined,
                  title: S.t('inviteCaregiver'),
                  subtitle: S.t('inviteCaregiverSub'),
                  trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                ),
              ),
            SaathiCard(
              rose: true,
              onTap: () => AppRoutes.push(context, const HelplineScreen()),
              child: InfoRow(
                icon: Icons.support_agent,
                rose: true,
                title: S.t('ngoHelpline'),
                subtitle: S.t('helplineSub'),
                trailing: const Icon(Icons.chevron_right, color: AppColors.roseText),
              ),
            ),
            const SizedBox(height: 6),
            SecondaryButton(label: S.t('signOut'), onPressed: () => _confirmSignOut(context)),
          ],
        );
      },
    );
  }

  Widget _fact(String label, String value) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Expanded(
              child: Text(
                label,
                style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
            ),
            Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14.5)),
          ],
        ),
      );

  String _bornMeta() {
    final hi = Lang.isHindi.value;
    final born = AuthState.bornDisplay;
    final lang = hi ? 'हिन्दी' : 'English';
    if (born.isEmpty) return lang;
    return '${hi ? 'जन्म' : 'Born'} $born · $lang';
  }

  Future<void> _confirmSignOut(BuildContext context) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text(
          S.t('signOutTitle'),
          style: const TextStyle(
            fontFamily: AppFonts.heading,
            fontWeight: FontWeight.bold,
            fontSize: 18,
          ),
        ),
        content: Text(
          S.t('signOutBody'),
          style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(
              S.t('cancel'),
              style: const TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              S.t('signOut'),
              style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
    if (ok == true && context.mounted) {
      await AuthState.signOut();
      ContactDirectory.clear();
      if (!context.mounted) return;
      AppRoutes.pushAndClear(context, const LoginScreen());
    }
  }
}

/// Inline card on ProfileScreen allowing a code-invited patient to attach and
/// verify their email later without creating a duplicate account.
class _LinkEmailInlineCard extends StatefulWidget {
  final VoidCallback onLinked;
  const _LinkEmailInlineCard({required this.onLinked});

  @override
  State<_LinkEmailInlineCard> createState() => _LinkEmailInlineCardState();
}

class _LinkEmailInlineCardState extends State<_LinkEmailInlineCard> {
  final _email = TextEditingController();
  final _otp = TextEditingController();
  bool _otpSent = false;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _otp.dispose();
    super.dispose();
  }

  bool get _validEmail => RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(_email.text.trim());

  Future<void> _sendOtp() async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    if (!_validEmail) {
      setState(() => _error = S.t('emailInvalid'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await AuthApiService().requestLinkEmailOtp(_email.text.trim());
      if (!mounted) return;
      setState(() {
        _busy = false;
        _otpSent = true;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(S.t('linkEmailCodeSent'))),
      );
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  Future<void> _verifyOtp() async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    final code = _otp.text.trim();
    if (code.length < 4) {
      setState(() => _error = S.t('otpWrong'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final updated = await AuthApiService().verifyLinkEmailOtp(
        email: _email.text.trim(),
        otp: code,
      );
      AuthState.applyAccount(updated);
      if (!mounted) return;
      setState(() => _busy = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(S.t('linkEmailSuccess'))),
      );
      widget.onLinked();
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return SaathiCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.mail_outline, color: AppColors.primary, size: 22),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  S.t('linkEmailTitle'),
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            S.t('linkEmailSub'),
            style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary, height: 1.4),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _email,
            enabled: !_otpSent && !_busy,
            keyboardType: TextInputType.emailAddress,
            autocorrect: false,
            decoration: InputDecoration(
              hintText: S.t('emailHint'),
              filled: true,
              fillColor: AppColors.bg,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
            ),
          ),
          if (_otpSent) ...[
            const SizedBox(height: 10),
            TextField(
              controller: _otp,
              enabled: !_busy,
              keyboardType: TextInputType.number,
              maxLength: 6,
              decoration: InputDecoration(
                counterText: '',
                hintText: S.t('linkEmailOtpHint'),
                filled: true,
                fillColor: AppColors.bg,
                contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.error)),
          ],
          const SizedBox(height: 12),
          if (_busy)
            const Center(
              child: Padding(
                padding: EdgeInsets.symmetric(vertical: 8),
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2.5, color: AppColors.primary),
                ),
              ),
            )
          else
            Row(
              children: [
                Expanded(
                  child: PrimaryButton(
                    label: _otpSent ? S.t('linkEmailVerifyBtn') : S.t('linkEmailSendOtp'),
                    onPressed: _otpSent ? _verifyOtp : _sendOtp,
                  ),
                ),
                if (_otpSent) ...[
                  const SizedBox(width: 8),
                  TextButton(
                    onPressed: () => setState(() {
                      _otpSent = false;
                      _otp.clear();
                      _error = null;
                    }),
                    child: Text(S.t('changeEmail')),
                  ),
                ],
              ],
            ),
        ],
      ),
    );
  }
}