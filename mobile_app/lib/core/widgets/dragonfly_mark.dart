
import 'package:flutter/material.dart';
import 'cancer_care_logo.dart';

class DragonflyMark extends StatelessWidget {
  final double size;
  final Color color;

  const DragonflyMark({
    super.key,
    this.size = 64,
    this.color = Colors.white,
  });

  @override
  Widget build(BuildContext context) {
    return CancerCareLogo(height: size);
  }
}
