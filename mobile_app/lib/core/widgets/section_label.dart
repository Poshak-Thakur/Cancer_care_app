import 'package:flutter/material.dart';
import '../theme/app_text.dart';

/// Small uppercase label above a group of content (Cinzel, from the theme).
class SectionLabel extends StatelessWidget {
  final String text;
  const SectionLabel(this.text, {super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 6, bottom: 10),
      child: Text(text.toUpperCase(), style: AppText.eyebrow),
    );
  }
}
