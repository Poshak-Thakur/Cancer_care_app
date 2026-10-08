import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/utils/ist.dart';
import '../../../core/widgets/buttons.dart';
import '../../../core/widgets/user_avatar.dart';
import '../../auth/services/auth_api_service.dart';
import '../../auth/services/auth_state.dart';

/// Create-or-change profile for any signed-in user (PATCH /api/auth/profile and
/// POST /api/caregivers/avatar): photo, name, date of birth, phone, language.
/// Pops with `true` when something was saved.
class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key});

  @override
  State<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends State<EditProfileScreen> {
  final _api = AuthApiService();
  late final TextEditingController _name = TextEditingController(text: AuthState.accountName ?? AuthState.displayName);
  late final TextEditingController _phone = TextEditingController(text: AuthState.phone ?? '');
  DateTime? _dob = AuthState.accountDob ?? AuthState.patient?.dateOfBirth;
  late bool _hindi = Lang.isHindi.value;
  String? _avatarUrl = AuthState.avatarUrl;
  bool _saving = false;
  bool _uploading = false;
  bool _changed = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    super.dispose();
  }

  Future<void> _pickAvatar() async {
    if (_uploading) return;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      backgroundColor: AppColors.surface,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(S.t('takePhoto')), onTap: () => Navigator.pop(ctx, ImageSource.camera)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(S.t('chooseFromGallery')), onTap: () => Navigator.pop(ctx, ImageSource.gallery)),
          ],
        ),
      ),
    );
    if (source == null) return;
    try {
      final file = await ImagePicker().pickImage(source: source, maxWidth: 1024, maxHeight: 1024, imageQuality: 85);
      if (file == null) return;
      setState(() {
        _uploading = true;
        _error = null;
      });
      final bytes = await file.readAsBytes();
      final lower = file.name.toLowerCase();
      final mime = lower.endsWith('.png') ? 'image/png' : (lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
      final url = await _api.uploadAvatar(bytes: bytes, filename: file.name, mime: mime);
      AuthState.avatarUrl = url;
      if (!mounted) return;
      setState(() {
        _avatarUrl = url;
        _uploading = false;
        _changed = true;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _error = e.message;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _uploading = false;
        _error = S.t('photoFailed');
      });
    }
  }

  Future<void> _pickDob() async {
    FocusScope.of(context).unfocus();
    final picked = await showDatePicker(
      context: context,
      initialDate: _dob ?? DateTime(1970, 1, 1),
      firstDate: DateTime(1900),
      lastDate: DateTime.now(),
      initialEntryMode: DatePickerEntryMode.calendarOnly,
    );
    if (picked != null) setState(() => _dob = picked);
  }

  Future<void> _save() async {
    if (_saving) return;
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
      final updated = await _api.updateProfile(
        fullName: name,
        dateOfBirth: _dob,
        phoneNumber: _phone.text.trim(),
        preferredLanguage: _hindi ? 'hi' : 'en',
      );
      AuthState.applyAccount(updated);
      Lang.isHindi.value = _hindi;
      if (!mounted) return;
      Navigator.of(context).pop(true);
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
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) Navigator.of(context).pop(_changed);
      },
      child: ValueListenableBuilder<bool>(
        valueListenable: Lang.isHindi,
        builder: (context, _, __) {
          return Scaffold(
            appBar: AppBar(title: Text(S.t('editProfile'))),
            body: SafeArea(
              child: ListView(
                padding: const EdgeInsets.fromLTRB(20, 8, 20, 28),
                children: [
                  Center(
                    child: Stack(
                      children: [
                        UserAvatar(url: _avatarUrl, initial: AuthState.initial, radius: 48),
                        if (_uploading)
                          const Positioned.fill(child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary))),
                        Positioned(
                          right: 0,
                          bottom: 0,
                          child: InkWell(
                            onTap: _pickAvatar,
                            borderRadius: BorderRadius.circular(999),
                            child: Container(
                              padding: const EdgeInsets.all(8),
                              decoration: const BoxDecoration(shape: BoxShape.circle, color: AppColors.primary),
                              child: const Icon(Icons.photo_camera_outlined, size: 18, color: Colors.white),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 6),
                  Center(child: TextButton(onPressed: _pickAvatar, child: Text(S.t('changePhoto')))),
                  const SizedBox(height: 10),
                  _label(S.t('fullName')),
                  TextField(
                    controller: _name,
                    textCapitalization: TextCapitalization.words,
                    onChanged: (_) => setState(() => _error = null),
                    decoration: _dec(S.t('nameHint')),
                  ),
                  const SizedBox(height: 18),
                  _label(S.t('dob')),
                  InkWell(
                    onTap: _pickDob,
                    borderRadius: BorderRadius.circular(14),
                    child: InputDecorator(
                      decoration: _dec(null).copyWith(suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20, color: AppColors.primary)),
                      child: Text(
                        _dob == null ? S.t('pickDate') : Ist.dateLabel(_dob!),
                        style: TextStyle(fontSize: 16, color: _dob == null ? AppColors.textFaint : AppColors.ink),
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  _label(S.t('phoneNumber')),
                  TextField(
                    controller: _phone,
                    keyboardType: TextInputType.phone,
                    decoration: _dec(S.t('phoneHint')),
                  ),
                  const SizedBox(height: 18),
                  _label(S.t('emailLabel')),
                  InputDecorator(
                    decoration: _dec(null).copyWith(fillColor: AppColors.bg),
                    child: Text(AuthState.email, style: const TextStyle(fontSize: 16, color: AppColors.textSecondary)),
                  ),
                  const SizedBox(height: 18),
                  _label(S.t('prefLang')),
                  Row(
                    children: [
                      Expanded(child: _langChip('English', !_hindi, () => setState(() => _hindi = false))),
                      const SizedBox(width: 12),
                      Expanded(child: _langChip('हिन्दी', _hindi, () => setState(() => _hindi = true))),
                    ],
                  ),
                  const SizedBox(height: 22),
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Icon(Icons.info_outline, size: 16, color: AppColors.warning),
                          const SizedBox(width: 6),
                          Expanded(child: Text(_error!, style: const TextStyle(fontSize: 13, color: AppColors.warning))),
                        ],
                      ),
                    ),
                  _saving
                      ? const SizedBox(height: 52, child: Center(child: CircularProgressIndicator(strokeWidth: 3, color: AppColors.primary)))
                      : PrimaryButton(label: S.t('saveChanges'), onPressed: _save),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _label(String t) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Text(t, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: AppColors.textFaint)),
      );

  InputDecoration _dec(String? hint) => InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide(color: AppColors.ink.withOpacity(0.12), width: 1.2)),
        focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: const BorderSide(color: AppColors.primary, width: 1.8)),
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
          border: Border.all(color: selected ? AppColors.primary : AppColors.ink.withOpacity(0.12), width: selected ? 1.8 : 1.2),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            if (selected) const Icon(Icons.check, size: 18, color: AppColors.primary),
            if (selected) const SizedBox(width: 6),
            Text(label, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: selected ? AppColors.primaryDeep : AppColors.textSecondary)),
          ],
        ),
      ),
    );
  }
}
