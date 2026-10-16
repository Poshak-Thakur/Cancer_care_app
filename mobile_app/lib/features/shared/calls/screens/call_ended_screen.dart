import 'package:flutter/material.dart';
import '../../../../core/localization/strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/app_fonts.dart';

/// Shown instead of the plain home screen when a call that was answered from
/// the phone's incoming-call screen cannot be joined any more: the caller hung
/// up, the call was already finished, the person is no longer allowed to join,
/// or the answer could not reach the server.
class CallEndedScreen extends StatelessWidget {
  /// True when the answer failed because the server could not be reached (the
  /// call may still be going on); false when the call is definitely over.
  final bool networkProblem;
  const CallEndedScreen({super.key, this.networkProblem = false});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.primaryDeep,
      body: SafeArea(
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(28),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.call_end, color: Colors.white, size: 44),
                const SizedBox(height: 16),
                Text(
                  S.t('callEndedTitle'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(fontFamily: AppFonts.heading, color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 10),
                Text(
                  S.t(networkProblem ? 'callEndedNetSub' : 'callEndedSub'),
                  textAlign: TextAlign.center,
                  style: const TextStyle(color: Colors.white, fontSize: 15, height: 1.45),
                ),
                const SizedBox(height: 26),
                FilledButton(
                  style: FilledButton.styleFrom(backgroundColor: Colors.white, foregroundColor: AppColors.primaryDeep),
                  onPressed: () => Navigator.of(context).pop(),
                  child: Text(S.t('goHome')),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
