
import 'package:flutter/material.dart';

class CancerCareLogo extends StatelessWidget {
  final double height;

  const CancerCareLogo({
    super.key,
    this.height = 64,
  });

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/images/cancer_care_logo.png',
      height: height,
      fit: BoxFit.contain,
      filterQuality: FilterQuality.high,
    );
  }
}
