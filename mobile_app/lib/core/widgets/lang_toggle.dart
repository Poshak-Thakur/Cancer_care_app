import 'package:flutter/material.dart';
import '../localization/lang.dart';
import '../theme/app_colors.dart';

class LangToggle extends StatelessWidget {
  const LangToggle({super.key});

  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Lang.isHindi,
      builder: (context, isHindi, _) {
        return Container(
          padding: const EdgeInsets.all(3),
          decoration: BoxDecoration(color: AppColors.primaryLight, borderRadius: BorderRadius.circular(999)),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _langBtn('EN', !isHindi, () => Lang.isHindi.value = false),
              _langBtn('हिं', isHindi, () => Lang.isHindi.value = true),
            ],
          ),
        );
      },
    );
  }

  Widget _langBtn(String label, bool active, VoidCallback onTap) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(999),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: active ? AppColors.primary : Colors.transparent,
          borderRadius: BorderRadius.circular(999),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: active ? Colors.white : AppColors.primaryDeep,
          ),
        ),
      ),
    );
  }
}
