import 'package:flutter/material.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../auth/services/auth_state.dart';
import '../models/patient.dart';
import '../services/patient_service.dart';

/// Edit the patient record itself (PATCH /api/patients/:patient_id): name,
/// date of birth, cancer type and stage, diagnosis date. Useful after the NGO
/// created the record and the patient claimed it with a Saathi code. The
/// backend allows it for the patient's own account (or a delegate with
/// ACCOUNT_OPERATE); the care plan is never editable here.
/// Pops with `true` when something was saved.
class EditPatientRecordScreen extends StatefulWidget {
  const EditPatientRecordScreen({super.key});

  @override
  State<EditPatientRecordScreen> createState() => _EditPatientRecordScreenState();
}

class _EditPatientRecordScreenState extends State<EditPatientRecordScreen> {
  final Patient? _p = AuthState.patient;
  late final TextEditingController _name = TextEditingController(text: _p?.fullName ?? '');
  late final TextEditingController _type = TextEditingController(text: _p?.cancerType ?? '');
  late final TextEditingController _stage = TextEditingController(text: _p?.cancerStage ?? '');
  late DateTime? _dob = _p?.dateOfBirth;
  late DateTime? _diagnosis = _p?.diagnosisDate;
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _type.dispose();
    _stage.dispose();
    super.dispose();
  }

  Future<DateTime?> _pick(DateTime? initial, {DateTime? first}) {
    FocusScope.of(context).unfocus();
    return showDatePicker(
      context: context,
      initialDate: initial ?? DateTime.now(),
      firstDate: first ?? DateTime(1900),
      lastDate: DateTime.now(),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
  }

  Future<void> _save() async {
    final p = _p;
    if (_saving || p == null) return;
    final name = _name.text.trim();
    if (name.length < 2) {
      setState(() => _error = S.t('nameRequired'));
      return;
    }
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final type = _type.text.trim();
      final stage = _stage.text.trim();
      final updated = await PatientService().updatePatient(
        p.id,
        fullName: name,
        dateOfBirth: _dob,
        cancerType: type.isEmpty ? null : type,
        cancerStage: stage.isEmpty ? null : stage,
        diagnosisDate: _diagnosis,
      );
      // Keep the same relationship and scopes; only the record changed.
      AuthState.setPatient(updated, relationship: AuthState.relationshipType, accessScopes: AuthState.scopes);
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.message.isEmpty ? S.t('loadFailed') : e.message;
      });
    }
  }

  Widget _dateField(String label, DateTime? value, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: InputDecorator(
        decoration: InputDecoration(
          labelText: label,
          filled: true,
          fillColor: AppColors.surface,
          suffixIcon: const Icon(Icons.calendar_today_outlined, size: 18),
          border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
        ),
        child: Text(value == null ? '' : Ist.dateLabel(value), style: const TextStyle(fontSize: 16)),
      ),
    );
  }

  InputDecoration _dec(String label) => InputDecoration(
        labelText: label,
        filled: true,
        fillColor: AppColors.surface,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14)),
      );

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('editPatientRecord'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
              children: [
                Text(S.t('editPatientRecordSub'), style: const TextStyle(fontSize: 14.5, color: AppColors.textSecondary, height: 1.4)),
                const SizedBox(height: 18),
                TextField(controller: _name, textCapitalization: TextCapitalization.words, decoration: _dec(S.t('fullName'))),
                const SizedBox(height: 14),
                _dateField(S.t('dob'), _dob, () async {
                  final d = await _pick(_dob);
                  if (d != null) setState(() => _dob = d);
                }),
                const SizedBox(height: 14),
                TextField(controller: _type, textCapitalization: TextCapitalization.sentences, decoration: _dec(S.t('cancerTypeOnly'))),
                const SizedBox(height: 14),
                TextField(controller: _stage, decoration: _dec(S.t('cancerStage'))),
                const SizedBox(height: 14),
                _dateField(S.t('diagnosisDate'), _diagnosis, () async {
                  final d = await _pick(_diagnosis);
                  if (d != null) setState(() => _diagnosis = d);
                }),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                        const SizedBox(width: 6),
                        Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning, height: 1.35))),
                      ],
                    ),
                  ),
                const SizedBox(height: 22),
                _saving
                    ? const SizedBox(
                        height: 52,
                        child: Center(child: SizedBox(width: 26, height: 26, child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary))),
                      )
                    : PrimaryButton(label: S.t('saveChanges'), onPressed: _save),
              ],
            ),
          ),
        );
      },
    );
  }
}
