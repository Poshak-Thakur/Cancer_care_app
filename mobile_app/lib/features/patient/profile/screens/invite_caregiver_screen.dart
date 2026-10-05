import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:qr_flutter/qr_flutter.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../auth/services/auth_state.dart';
import '../../../caregiver/patients/services/caregiver_service.dart';

/// Patient creates a 7-day invite code for a family member (POST
/// /api/caregivers/invite) and shows it as a QR code and copyable text.
class InviteCaregiverScreen extends StatefulWidget {
  const InviteCaregiverScreen({super.key});

  @override
  State<InviteCaregiverScreen> createState() => _InviteCaregiverScreenState();
}

class _InviteCaregiverScreenState extends State<InviteCaregiverScreen> {
  String? _token;
  bool _loading = false;
  String? _error;

  Future<void> _generate() async {
    final pid = AuthState.patientId;
    if (pid == null || _loading) return;
    setState(() { _loading = true; _error = null; });
    try {
      final token = await CaregiverService().generateInvite(pid);
      if (!mounted) return;
      setState(() { _token = token; _loading = false; });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() { _loading = false; _error = e.message; });
    }
  }

  Future<void> _copy() async {
    await Clipboard.setData(ClipboardData(text: _token!));
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.t('codeCopied'))));
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('inviteCaregiver'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: [
                Text(S.t('inviteExplain'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 20),
                if (_token == null) ...[
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning)),
                    ),
                  _loading
                      ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                      : PrimaryButton(label: S.t('generateInvite'), onPressed: _generate),
                ] else ...[
                  Center(
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16)),
                      child: QrImageView(data: _token!, size: 230, backgroundColor: Colors.white),
                    ),
                  ),
                  const SizedBox(height: 14),
                  Text(S.t('inviteValid'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary)),
                  const SizedBox(height: 14),
                  Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(color: AppColors.surface, borderRadius: BorderRadius.circular(12)),
                    child: Text(_token!, maxLines: 4, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 11.5, color: AppColors.textSecondary)),
                  ),
                  const SizedBox(height: 12),
                  PrimaryButton(label: S.t('copyCode'), onPressed: _copy),
                  const SizedBox(height: 10),
                  SecondaryButton(label: S.t('newInvite'), onPressed: _generate),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}
