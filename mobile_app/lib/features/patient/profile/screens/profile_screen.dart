import 'package:flutter/material.dart';
import '../../../../core/authorization/access_scope.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../../core/widgets/section_label.dart';
import '../../../../core/widgets/user_avatar.dart';
import '../../../auth/screens/login_screen.dart';
import '../../../auth/screens/patient_picker_screen.dart';
import '../../../auth/services/auth_state.dart';
import '../../../caregiver/patients/services/caregiver_service.dart';
import '../../../shared/helpline/helpline_screen.dart';
import '../../../shared/profile/edit_profile_screen.dart';
import '../../check_in/screens/symptom_history_screen.dart';
import '../../documents/screens/documents_screen.dart';
import '../../messages/models/care_contact.dart';
import '../../messages/services/chat_service.dart';
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

  /// Linked caregivers come from the care-team contact list.
  Future<void> _loadCaregivers() async {
    final pid = AuthState.patientId;
    if (pid == null) return;
    try {
      final all = await ChatService().contacts(pid);
      ContactDirectory.remember(all);
      if (mounted) setState(() => _caregivers = all.where((c) => c.category == 'CAREGIVER').toList());
    } catch (_) {}
  }

  Future<void> _edit() async {
    await AppRoutes.push(context, const EditProfileScreen());
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
        title: Text(S.t('revokeTitle'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        content: Text(S.revokeBody(c.displayName), style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(S.t('cancel'))),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(S.t('revokeAccess'), style: const TextStyle(color: AppColors.warning, fontWeight: FontWeight.w600))),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await CaregiverService().revoke(patientId: AuthState.patientId!, caregiverUserId: c.userId);
      if (mounted) setState(() => _caregivers = _caregivers.where((x) => x.userId != c.userId).toList());
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
            Text(S.t('yourProfile'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
            const SizedBox(height: 2),
            Text(S.t('profileSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
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
                        Text(AuthState.fullName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
                        if (AuthState.isManagingOther) Text('${S.t('managingFor')} ${p?.fullName ?? ''}', style: const TextStyle(fontSize: 13, color: AppColors.primaryDeep, fontWeight: FontWeight.w600)),
                        Text(_bornMeta(), style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                        Text(AuthState.maskedEmail, style: const TextStyle(fontSize: 12.5, color: AppColors.textFaint)),
                      ],
                    ),
                  ),
                  const Icon(Icons.edit_outlined, color: AppColors.primary, size: 20),
                ],
              ),
            ),
            if (AuthState.patientLinks.length > 1)
              SaathiCard(
                onTap: () => AppRoutes.push(context, PatientPickerScreen(links: AuthState.patientLinks)),
                child: InfoRow(
                  icon: Icons.swap_horiz,
                  title: S.t('switchPatient'),
                  subtitle: p?.fullName,
                  trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                ),
              ),
            if (p != null && (p.cancerType != null || p.cancerStage != null || p.diagnosisDate != null)) ...[
              SectionLabel(S.t('moreAboutYou')),
              SaathiCard(
                child: Column(
                  children: [
                    if (p.cancerType != null) _fact(S.t('cancerType'), p.cancerType!),
                    if (p.cancerStage != null) _fact(S.t('cancerStage'), p.cancerStage!),
                    if (p.diagnosisDate != null) _fact(S.t('diagnosisDate'), Ist.dateLabel(p.diagnosisDate!)),
                  ],
                ),
              ),
            ],
            SectionLabel(S.t('records')),
            if (pid != null) ...[
              if (AuthState.can(AccessScope.documentView))
              SaathiCard(
                onTap: () => AppRoutes.push(context, DocumentsScreen(patientId: pid)),
                child: InfoRow(icon: Icons.description_outlined, title: S.t('documents'), subtitle: S.t('documentsSub'), trailing: const Icon(Icons.chevron_right, color: AppColors.primary)),
              ),
              if (AuthState.can(AccessScope.symptomView))
              SaathiCard(
                onTap: () => AppRoutes.push(context, SymptomHistoryScreen(patientId: pid)),
                child: InfoRow(icon: Icons.monitor_heart_outlined, title: S.t('checkinHistory'), subtitle: S.t('checkinHistorySub'), trailing: const Icon(Icons.chevron_right, color: AppColors.primary)),
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
                          Text(c.displayName, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 15)),
                          if (c.role.isNotEmpty) Text(c.role, style: const TextStyle(fontSize: 12.5, color: AppColors.textSecondary)),
                        ],
                      ),
                    ),
                    TextButton(onPressed: () => _revoke(c), child: Text(S.t('revokeAccess'), style: const TextStyle(color: AppColors.warning, fontSize: 13))),
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
              child: InfoRow(icon: Icons.support_agent, rose: true, title: S.t('ngoHelpline'), subtitle: S.t('helplineSub'), trailing: const Icon(Icons.chevron_right, color: AppColors.roseText)),
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
            Expanded(child: Text(label, style: const TextStyle(fontSize: 14, color: AppColors.textSecondary))),
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
        title: Text(S.t('signOutTitle'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        content: Text(S.t('signOutBody'), style: const TextStyle(fontSize: 14.5, height: 1.45, color: AppColors.textSecondary)),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(false), child: Text(S.t('cancel'), style: const TextStyle(color: AppColors.textSecondary, fontWeight: FontWeight.w600))),
          TextButton(onPressed: () => Navigator.of(ctx).pop(true), child: Text(S.t('signOut'), style: const TextStyle(color: AppColors.primary, fontWeight: FontWeight.w600))),
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
