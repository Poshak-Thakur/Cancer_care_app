import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/push/push_service.dart';
import '../../../core/realtime/socket_service.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/storage/claim_code_storage.dart';
import '../../../core/storage/local_offline_storage.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/app_text.dart';
import '../../../core/widgets/buttons.dart';
import '../../patient/patient_shell.dart';
import '../../shared/calls/call_coordinator.dart';
import '../services/auth_api_service.dart';
import '../services/auth_state.dart';
import '../services/session_router.dart';
import 'claim_blocked_screen.dart';

/// "I have a code from Dost": the NGO has already created the patient's
/// record, and gives the patient a one-time code to claim it.
///
/// Path B (Direct Code Activation):
/// Entering a valid code calls `POST /api/auth/claim-code` directly,
/// establishes the patient's account and SELF relationship, saves the offline
/// workspace locally, and navigates straight to [PatientShell] — with NO
/// email or OTP screen required upfront. The patient can link their email
/// later from the Profile screen.
class ClaimCodeScreen extends StatefulWidget {
  final bool signedIn;
  final String? message;
  const ClaimCodeScreen({super.key, this.signedIn = false, this.message});

  @override
  State<ClaimCodeScreen> createState() => _ClaimCodeScreenState();
}

class _ClaimCodeScreenState extends State<ClaimCodeScreen> {
  final _code = TextEditingController();
  late String? _error = widget.message;
  bool _busy = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    if (_busy) return;
    FocusScope.of(context).unfocus();
    final code = ClaimCodeStorage.normalize(_code.text);
    if (!ClaimCodeStorage.isValid(code)) {
      setState(() => _error = S.t('claimCodeInvalid'));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });

    // If somehow already signed in via email first, use the existing signed-in claim path
    if (widget.signedIn) {
      await ClaimCodeStorage.save(code);
      if (!mounted) return;
      await _rerunSignIn();
      return;
    }

    // Direct code-only bootstrap (no email or OTP screen!)
    try {
      final claimed = await AuthApiService().claimByCodeBootstrap(code);
      await ClaimCodeStorage.clear();

      AuthState.role = 'patient';
      AuthState.applyLogin(claimed.auth);

      if (claimed.patient != null) {
        AuthState.setPatient(
          claimed.patient!,
          relationship: 'SELF',
          accessScopes: claimed.accessScopes,
        );
        await LocalOfflineStore.instance.putCache(
          cacheKey: 'patient_profile_${claimed.patient!.id}',
          patientId: claimed.patient!.id,
          data: {
            'id': claimed.patient!.id,
            'full_name': claimed.patient!.fullName,
            'date_of_birth': claimed.patient!.dateOfBirth?.toIso8601String(),
            'preferred_language': claimed.patient!.preferredLanguage,
            'cancer_type': claimed.patient!.cancerType,
            'cancer_stage': claimed.patient!.cancerStage,
            'diagnosis_date': claimed.patient!.diagnosisDate?.toIso8601String(),
            'care_plan_summary': claimed.patient!.carePlanSummary,
          },
        );
      }

      await AuthState.persistSession();
      if (!mounted) return;

      // If the backend response already included the patient record, go straight to PatientShell
      if (AuthState.patient != null) {
        SocketService.instance.start(AuthState.userId);
        PushService.registerForUser();
        AppRoutes.pushAndClear(context, const PatientShell());
        CallCoordinator.onSessionReady();
      } else {
        await SessionRouter.go(context);
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 409) {
        setState(() => _busy = false);
        AppRoutes.push(context, ClaimBlockedScreen(message: S.t('claimAlreadySetUp')));
        return;
      }
      if (e.statusCode == 429) {
        setState(() => _busy = false);
        AppRoutes.push(context, ClaimBlockedScreen(message: S.t('claimTooMany')));
        return;
      }
      setState(() {
        _busy = false;
        _error = e.message.isEmpty ? S.t('claimInvalid') : e.message;
      });
    }
  }

  /// Already signed in: run the routing again (it will use the new code).
  Future<void> _rerunSignIn() async {
    try {
      await SessionRouter.go(context);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = e.message.isEmpty ? S.t('claimRetryFailed') : e.message;
      });
    }
  }

  Future<void> _skip() async {
    if (_busy) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    await ClaimCodeStorage.clear();
    if (!mounted) return;
    await _rerunSignIn();
  }

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, _, __) {
        return Scaffold(
          appBar: widget.signedIn ? null : AppBar(),
          body: SafeArea(
            child: ListView(
              padding: const EdgeInsets.fromLTRB(22, 18, 22, 28),
              children: [
                Text(
                  S.t('claimTitle'),
                  style: const TextStyle(
                    fontFamily: AppFonts.heading,
                    fontSize: 24,
                    fontWeight: FontWeight.bold,
                    color: AppColors.ink,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  S.t('claimSub'),
                  style: const TextStyle(
                    fontSize: 15.5,
                    color: AppColors.textSecondary,
                    height: 1.45,
                  ),
                ),
                const SizedBox(height: 26),
                Text(S.t('claimCodeLabel').toUpperCase(), style: AppText.eyebrow),
                const SizedBox(height: 8),
                TextField(
                  controller: _code,
                  autofocus: !widget.signedIn,
                  textCapitalization: TextCapitalization.characters,
                  autocorrect: false,
                  enableSuggestions: false,
                  maxLength: 12, // room for spaces or a dash while typing
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _continue(),
                  onChanged: (_) {
                    if (_error != null) setState(() => _error = null);
                  },
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 3,
                  ),
                  decoration: InputDecoration(
                    counterText: '',
                    hintText: S.t('claimCodeHint'),
                    hintStyle: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.normal,
                      letterSpacing: 0,
                    ),
                    filled: true,
                    fillColor: AppColors.surface,
                    prefixIcon: const Icon(
                      Icons.vpn_key_outlined,
                      color: AppColors.textSecondary,
                    ),
                    contentPadding: const EdgeInsets.symmetric(vertical: 16),
                    enabledBorder: _border(
                      _error != null ? AppColors.error : AppColors.ink.withOpacity(0.12),
                    ),
                    focusedBorder: _border(
                      _error != null ? AppColors.error : AppColors.primary,
                      width: 1.8,
                    ),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline, size: 16, color: AppColors.error),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            _error!,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.error,
                              height: 1.35,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: 20),
                _busy
                    ? const SizedBox(
                        height: 52,
                        child: Center(
                          child: SizedBox(
                            width: 26,
                            height: 26,
                            child: CircularProgressIndicator(
                              strokeWidth: 3,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      )
                    : PrimaryButton(label: S.t('claimContinue'), onPressed: _continue),
                if (widget.signedIn) ...[
                  const SizedBox(height: 10),
                  TextButton(
                    onPressed: _busy ? null : _skip,
                    child: Text(
                      S.t('claimNoCode'),
                      style: const TextStyle(
                        color: AppColors.primary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  OutlineInputBorder _border(Color c, {double width = 1.2}) => OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: c, width: width),
      );
}