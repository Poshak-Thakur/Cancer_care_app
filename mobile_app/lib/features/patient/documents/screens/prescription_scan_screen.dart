import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/buttons.dart';
import '../models/medical_document.dart';
import '../services/document_service.dart';
import '../../../../core/theme/app_fonts.dart';

/// Photograph a prescription -> the server reads it (Gemini Vision) -> the
/// person reviews and edits the medicines in a bottom sheet -> confirm saves
/// them as VERIFIED medications. Pops `true` after a confirmed save.
class PrescriptionScanScreen extends StatefulWidget {
  final String patientId;
  const PrescriptionScanScreen({super.key, required this.patientId});

  @override
  State<PrescriptionScanScreen> createState() => _PrescriptionScanScreenState();
}

class _PrescriptionScanScreenState extends State<PrescriptionScanScreen> {
  final _service = DocumentService();
  bool _scanning = false;
  bool _saved = false;
  String? _error;
  int _savedCount = 0;

  Future<void> _pick(ImageSource source) async {
    if (_scanning) return;
    try {
      final file = await ImagePicker().pickImage(source: source, maxWidth: 2400, maxHeight: 2400, imageQuality: 90);
      if (file == null) return;
      setState(() {
        _scanning = true;
        _error = null;
      });
      final scan = await _service.scanPrescription(
        patientId: widget.patientId,
        bytes: await file.readAsBytes(),
        filename: file.name,
      );
      if (!mounted) return;
      setState(() => _scanning = false);
      if (scan.medications.isEmpty) {
        setState(() => _error = S.t('noMedicinesFound'));
        return;
      }
      await _review(scan);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _scanning = false;
        _error = e.statusCode == 500 ? S.t('scanFailed') : e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _scanning = false;
        _error = S.t('scanFailed');
      });
    }
  }

  Future<void> _review(PrescriptionScan scan) async {
    final count = await showModalBottomSheet<int>(
      context: context,
      isScrollControlled: true,
      isDismissible: false,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => _ReviewSheet(scan: scan, patientId: widget.patientId, service: _service),
    );
    if (count != null && mounted) {
      setState(() {
        _saved = true;
        _savedCount = count;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: AppBar(title: Text(S.t('scanPrescription'))),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
              children: [
                Text(S.t('scanHelp'), style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.45)),
                const SizedBox(height: 22),
                if (_saved) ...[
                  Container(
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(14)),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle, color: AppColors.positive),
                        const SizedBox(width: 10),
                        Expanded(child: Text(S.medsSaved(_savedCount), style: const TextStyle(fontSize: 14.5, color: AppColors.primaryDeep, fontWeight: FontWeight.w500))),
                      ],
                    ),
                  ),
                  const SizedBox(height: 14),
                  PrimaryButton(label: S.t('doneBtn'), onPressed: () => Navigator.of(context).pop(true)),
                  const SizedBox(height: 10),
                  SecondaryButton(label: S.t('scanAnother'), onPressed: () => setState(() => _saved = false)),
                ] else if (_scanning) ...[
                  const SizedBox(height: 30),
                  const Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)),
                  const SizedBox(height: 16),
                  Text(S.t('reading'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary)),
                ] else ...[
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline, size: 16, color: AppColors.error),
                          const SizedBox(width: 6),
                          Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13.5, color: AppColors.error))),
                        ],
                      ),
                    ),
                  PrimaryButton(label: S.t('takePhoto'), onPressed: () => _pick(ImageSource.camera)),
                  const SizedBox(height: 10),
                  SecondaryButton(label: S.t('chooseFromGallery'), onPressed: () => _pick(ImageSource.gallery)),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _ReviewSheet extends StatefulWidget {
  final PrescriptionScan scan;
  final String patientId;
  final DocumentService service;
  const _ReviewSheet({required this.scan, required this.patientId, required this.service});

  @override
  State<_ReviewSheet> createState() => _ReviewSheetState();
}

class _ReviewSheetState extends State<_ReviewSheet> {
  late final List<ScannedMedication> _meds = List.of(widget.scan.medications);
  late final List<List<TextEditingController>> _ctrls = [
    for (final m in _meds) [TextEditingController(text: m.name), TextEditingController(text: m.strength), TextEditingController(text: m.form), TextEditingController(text: m.instructions)],
  ];
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    for (final row in _ctrls) {
      for (final c in row) {
        c.dispose();
      }
    }
    super.dispose();
  }

  void _remove(int i) {
    setState(() {
      _meds.removeAt(i);
      for (final c in _ctrls.removeAt(i)) {
        c.dispose();
      }
    });
  }

  void _addRow() {
    setState(() {
      _meds.add(ScannedMedication());
      _ctrls.add([TextEditingController(), TextEditingController(), TextEditingController(), TextEditingController()]);
    });
  }

  Future<void> _confirm() async {
    final out = <ScannedMedication>[];
    for (var i = 0; i < _meds.length; i++) {
      final c = _ctrls[i];
      if (c[0].text.trim().isEmpty) continue; // a medicine needs a name
      out.add(ScannedMedication(name: c[0].text, strength: c[1].text, form: c[2].text, instructions: c[3].text));
    }
    if (out.isEmpty) {
      setState(() => _error = S.t('needOneMedicine'));
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final n = await widget.service.confirmMedications(patientId: widget.patientId, prescriptionId: widget.scan.prescriptionId, medications: out);
      if (mounted) Navigator.of(context).pop(n);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.message;
      });
    }
  }

  InputDecoration _dec(String label) => InputDecoration(
        labelText: label,
        isDense: true,
        filled: true,
        fillColor: AppColors.bg,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide.none),
      );

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.9,
      maxChildSize: 0.95,
      builder: (context, scroll) {
        return Padding(
          padding: EdgeInsets.only(left: 18, right: 18, top: 18, bottom: 12 + MediaQuery.of(context).viewInsets.bottom),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(child: Text(S.t('reviewMedicines'), style: const TextStyle(fontFamily: AppFonts.heading, fontWeight: FontWeight.bold, fontSize: 18))),
                  IconButton(onPressed: _saving ? null : () => Navigator.of(context).pop(), icon: const Icon(Icons.close)),
                ],
              ),
              Align(alignment: Alignment.centerLeft, child: Text(S.t('reviewHelp'), style: const TextStyle(fontSize: 13.5, color: AppColors.textSecondary, height: 1.4))),
              const SizedBox(height: 10),
              Expanded(
                child: ListView(
                  controller: scroll,
                  children: [
                    for (var i = 0; i < _meds.length; i++)
                      Container(
                        margin: const EdgeInsets.only(bottom: 12),
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(border: Border.all(color: AppColors.ink.withOpacity(0.1)), borderRadius: BorderRadius.circular(14)),
                        child: Column(
                          children: [
                            Row(children: [
                              Expanded(child: TextField(controller: _ctrls[i][0], decoration: _dec(S.t('medName')))),
                              IconButton(onPressed: () => _remove(i), icon: const Icon(Icons.delete_outline, color: AppColors.error)),
                            ]),
                            const SizedBox(height: 8),
                            Row(children: [
                              Expanded(child: TextField(controller: _ctrls[i][1], decoration: _dec(S.t('medStrength')))),
                              const SizedBox(width: 8),
                              Expanded(child: TextField(controller: _ctrls[i][2], decoration: _dec(S.t('medForm')))),
                            ]),
                            const SizedBox(height: 8),
                            TextField(controller: _ctrls[i][3], minLines: 1, maxLines: 3, decoration: _dec(S.t('medInstructions'))),
                          ],
                        ),
                      ),
                    TextButton.icon(onPressed: _addRow, icon: const Icon(Icons.add), label: Text(S.t('addMedicine'))),
                  ],
                ),
              ),
              if (_error != null)
                Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.error))),
              _saving
                  ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                  : PrimaryButton(label: S.t('confirmSave'), onPressed: _confirm),
            ],
          ),
        );
      },
    );
  }
}
