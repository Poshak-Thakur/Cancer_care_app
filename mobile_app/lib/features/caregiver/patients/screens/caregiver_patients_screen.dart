import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../dashboard/screens/caregiver_patient_screen.dart';
import '../models/linked_patient.dart';
import '../services/caregiver_service.dart';
import 'accept_invite_screen.dart';

/// Caregiver home: the patients this caregiver supports.
class CaregiverPatientsScreen extends StatefulWidget {
  const CaregiverPatientsScreen({super.key});

  @override
  State<CaregiverPatientsScreen> createState() => _CaregiverPatientsScreenState();
}

class _CaregiverPatientsScreenState extends State<CaregiverPatientsScreen> {
  List<LinkedPatient>? _patients;
  bool _loading = true;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final list = await CaregiverService().myPatients();
      if (!mounted) return;
      setState(() { _patients = list; _loading = false; _failed = false; });
    } on ApiException {
      if (!mounted) return;
      setState(() { _loading = false; _failed = _patients == null; });
    }
  }

  Future<void> _add() async {
    final linked = await AppRoutes.push<bool>(context, const AcceptInviteScreen());
    if (linked == true && mounted) _load();
  }

  Future<void> _open(LinkedPatient p) async {
    await AppRoutes.push(context, CaregiverPatientScreen(link: p));
    if (mounted) _load(silent: true);
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final list = _patients;
        return RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () => _load(silent: true),
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(18, 20, 18, 24),
            children: [
              Text(S.t('yourPatients'), style: const TextStyle(fontSize: 21, fontWeight: FontWeight.bold)),
              const SizedBox(height: 2),
              Text(S.t('yourPatientsSub'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
              const SizedBox(height: 16),
              if (_loading && list == null)
                const LoadingView()
              else if (_failed || list == null)
                ErrorView(message: S.t('loadFailed'), onRetry: _load)
              else ...[
                if (list.isEmpty)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 24),
                    child: Text(S.t('noPatientsYet'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.4)),
                  ),
                for (final p in list)
                  SaathiCard(
                    onTap: () => _open(p),
                    child: InfoRow(
                      icon: Icons.person_outline,
                      title: p.patient.fullName,
                      subtitle: '${p.relationshipLabel} · ${availabilityLabel(p.availability)}',
                      trailing: const Icon(Icons.chevron_right, color: AppColors.primary),
                    ),
                  ),
                const SizedBox(height: 12),
                SecondaryButton(label: S.t('addPatient'), onPressed: _add),
              ],
            ],
          ),
        );
      },
    );
  }
}

String availabilityLabel(String value) {
  switch (value) {
    case 'UNAVAILABLE':
      return S.t('availUnavailable');
    case 'DO_NOT_DISTURB':
      return S.t('availDnd');
    default:
      return S.t('availAvailable');
  }
}
