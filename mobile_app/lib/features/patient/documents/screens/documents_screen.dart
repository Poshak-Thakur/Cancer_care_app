import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../core/authorization/access_guard.dart';
import '../../../../core/authorization/access_scope.dart';
import '../../../../core/localization/lang.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/network/api_exception.dart';
import '../../../../core/routing/app_routes.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/utils/ist.dart';
import '../../../../core/widgets/async_states.dart';
import '../../../../core/widgets/buttons.dart';
import '../../../../core/widgets/info_row.dart';
import '../../../../core/widgets/saathi_card.dart';
import '../../../auth/services/auth_state.dart';
import '../models/medical_document.dart';
import '../services/document_service.dart';
import 'prescription_scan_screen.dart';

/// Medical documents for one patient, each with a verification badge
/// (PENDING / VERIFIED / REJECTED), plus upload and prescription scanning.
class DocumentsScreen extends StatefulWidget {
  final String patientId;
  const DocumentsScreen({super.key, required this.patientId});

  @override
  State<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends State<DocumentsScreen> {
  final _service = DocumentService();
  List<MedicalDocument>? _docs;
  bool _loading = true;
  bool _failed = false;
  bool _uploading = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load({bool silent = false}) async {
    if (!silent) setState(() { _loading = true; _failed = false; });
    try {
      final list = await _service.list(widget.patientId);
      if (!mounted) return;
      setState(() { _docs = list; _loading = false; _failed = false; });
    } on ApiException catch (e) {
      if (!mounted) return;
      if (AccessGuard.handle(context, e)) return;
      setState(() { _loading = false; _failed = _docs == null; });
    }
  }

  void _toast(String m) {
    if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));
  }

  Future<void> _scan() async {
    final done = await AppRoutes.push<bool>(context, PrescriptionScanScreen(patientId: widget.patientId));
    if (done == true && mounted) _load(silent: true);
  }

  Future<void> _upload() async {
    if (_uploading) return;
    final details = await showModalBottomSheet<_UploadDetails>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(22))),
      builder: (_) => const _UploadSheet(),
    );
    if (details == null) return;
    try {
      final file = await ImagePicker().pickImage(source: details.source, maxWidth: 2200, maxHeight: 2200, imageQuality: 88);
      if (file == null) return;
      setState(() => _uploading = true);
      await _service.upload(
        patientId: widget.patientId,
        bytes: await file.readAsBytes(),
        filename: file.name,
        documentType: details.type,
        title: details.title.isEmpty ? null : details.title,
        isPrivate: details.isPrivate,
      );
      if (!mounted) return;
      setState(() => _uploading = false);
      _toast(S.t('documentUploaded'));
      _load(silent: true);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _uploading = false);
      if (AccessGuard.handle(context, e)) return;
      _toast(e.message);
    } catch (_) {
      if (!mounted) return;
      setState(() => _uploading = false);
      _toast(S.t('couldNotUpdate'));
    }
  }

  String _typeLabel(String t) {
    switch (t) {
      case 'PRESCRIPTION':
        return S.t('docPrescription');
      case 'LAB_REPORT':
        return S.t('docLabReport');
      case 'SCAN':
        return S.t('docScan');
      case 'DISCHARGE_SUMMARY':
        return S.t('docDischarge');
      default:
        return S.t('docOther');
    }
  }

  Widget _badge(String? status) {
    final String label;
    final Color fg;
    final Color bg;
    final IconData icon;
    switch (status) {
      case 'VERIFIED':
        label = S.t('verifiedBadge');
        fg = AppColors.positive;
        bg = AppColors.sageLight;
        icon = Icons.verified_outlined;
        break;
      case 'REJECTED':
        label = S.t('rejectedBadge');
        fg = AppColors.error;
        bg = AppColors.roseLight;
        icon = Icons.info_outline;
        break;
      default:
        label = S.t('pendingBadge');
        fg = AppColors.primaryDeep;
        bg = AppColors.primaryLight;
        icon = Icons.access_time;
    }
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 4),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(999)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 13, color: fg),
          const SizedBox(width: 5),
          Text(label, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w600, color: fg)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        final docs = _docs;
        return Scaffold(
          appBar: AppBar(title: Text(S.t('documents'))),
          body: SafeArea(
            child: RefreshIndicator(
              color: AppColors.primary,
              onRefresh: () => _load(silent: true),
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.fromLTRB(18, 8, 18, 24),
                children: [
                  // Scanning saves medications (MEDICATION_EDIT); uploading needs DOCUMENT_UPLOAD.
                  if (AuthState.can(AccessScope.medicationEdit)) ...[
                    PrimaryButton(label: S.t('scanPrescription'), onPressed: _scan),
                    const SizedBox(height: 10),
                  ],
                  if (AuthState.can(AccessScope.documentUpload))
                    _uploading
                        ? const SizedBox(height: 48, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                        : SecondaryButton(label: S.t('uploadDocument'), onPressed: _upload),
                  const SizedBox(height: 16),
                  if (_loading && docs == null)
                    const LoadingView()
                  else if (_failed || docs == null)
                    ErrorView(message: S.t('loadFailed'), onRetry: _load)
                  else if (docs.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 30),
                      child: Text(S.t('noDocuments'), textAlign: TextAlign.center, style: const TextStyle(fontSize: 15, color: AppColors.textSecondary, height: 1.4)),
                    )
                  else
                    for (final d in docs)
                      SaathiCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            InfoRow(
                              icon: d.documentType == 'PRESCRIPTION' ? Icons.medication_outlined : Icons.description_outlined,
                              title: d.title,
                              subtitle: '${_typeLabel(d.documentType)} · ${Ist.dateLabel(Ist.dayOf(d.uploadedAt))}',
                            ),
                            const SizedBox(height: 10),
                            Row(
                              children: [
                                _badge(d.verificationStatus),
                                const SizedBox(width: 8),
                                if (d.isPrivate == true)
                                  Row(
                                    mainAxisSize: MainAxisSize.min,
                                    children: [
                                      const Icon(Icons.lock_outline, size: 14, color: AppColors.textFaint),
                                      const SizedBox(width: 4),
                                      Text(S.t('private'), style: const TextStyle(fontSize: 12, color: AppColors.textFaint)),
                                    ],
                                  ),
                              ],
                            ),
                          ],
                        ),
                      ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }
}

class _UploadDetails {
  final String type;
  final String title;
  final bool isPrivate;
  final ImageSource source;
  const _UploadDetails(this.type, this.title, this.isPrivate, this.source);
}

class _UploadSheet extends StatefulWidget {
  const _UploadSheet();

  @override
  State<_UploadSheet> createState() => _UploadSheetState();
}

class _UploadSheetState extends State<_UploadSheet> {
  final _title = TextEditingController();
  String _type = 'LAB_REPORT';
  bool _private = true;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  String _label(String t) {
    switch (t) {
      case 'PRESCRIPTION':
        return S.t('docPrescription');
      case 'LAB_REPORT':
        return S.t('docLabReport');
      case 'SCAN':
        return S.t('docScan');
      case 'DISCHARGE_SUMMARY':
        return S.t('docDischarge');
      default:
        return S.t('docOther');
    }
  }

  void _go(ImageSource s) => Navigator.of(context).pop(_UploadDetails(_type, _title.text.trim(), _private, s));

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(left: 20, right: 20, top: 22, bottom: 22 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(S.t('uploadDocument'), style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 17)),
            const SizedBox(height: 14),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final t in documentTypes)
                  ChoiceChip(label: Text(_label(t)), selected: _type == t, selectedColor: AppColors.primaryLight, onSelected: (_) => setState(() => _type = t)),
              ],
            ),
            const SizedBox(height: 14),
            TextField(
              controller: _title,
              decoration: InputDecoration(
                hintText: S.t('documentTitleHint'),
                filled: true,
                fillColor: AppColors.bg,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide.none),
              ),
            ),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              value: _private,
              activeColor: AppColors.primary,
              onChanged: (v) => setState(() => _private = v),
              title: Text(S.t('keepPrivate'), style: const TextStyle(fontSize: 14.5)),
              subtitle: Text(S.t('keepPrivateSub'), style: const TextStyle(fontSize: 12.5)),
            ),
            const SizedBox(height: 6),
            Row(
              children: [
                Expanded(child: SecondaryButton(label: S.t('takePhoto'), onPressed: () => _go(ImageSource.camera))),
                const SizedBox(width: 10),
                Expanded(child: PrimaryButton(label: S.t('chooseFromGallery'), onPressed: () => _go(ImageSource.gallery))),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
