import 'dart:async';
import 'package:flutter/material.dart';
import '../../../core/localization/lang.dart';
import '../../../core/localization/strings.dart';
import '../../../core/routing/app_routes.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_fonts.dart';
import '../../../core/theme/app_text.dart';
import '../../../core/widgets/dragonfly_mark.dart';
import 'session_gate_screen.dart';
import '../../../core/constants/app_brand.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _fade;
  Timer? _timer;

  @override
  void initState() {
    super.initState();

    _fade = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 700),
    )..forward();

    _timer = Timer(const Duration(milliseconds: 2000), () {
      if (!mounted) return;
      AppRoutes.fadeReplace(context, const SessionGateScreen());
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _fade.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.primaryDeep,
      body: Center(
        child: FadeTransition(
          opacity: _fade,
          child: ValueListenableBuilder<bool>(
            valueListenable: Lang.isHindi,
            builder: (context, _, __) => Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 18,
                    vertical: 12,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.bg,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: const DragonflyMark(size: 72),
                ),
                const SizedBox(height: 16),
                const Text(
                  AppBrand.name,
                  style: TextStyle(
                    fontFamily: AppFonts.heading,
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: AppColors.bg,
                    letterSpacing: 0.2,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  AppBrand.tagline.toUpperCase(),
                  textAlign: TextAlign.center,
                  style: AppText.eyebrow.copyWith(color: AppColors.primaryLight),
                ),
                const SizedBox(height: 14),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 32),
                  child: Text(
                    S.t('tagline'),
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 14,
                      color: AppColors.primaryLight.withOpacity(0.9),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
