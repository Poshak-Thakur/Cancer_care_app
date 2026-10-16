import 'package:flutter/material.dart';
import 'cancer_care_logo.dart';

/// The Saathi / Cancer Care mark. It now shows the NGO's logo picture.
///
/// [size] is the height. [color] is kept so existing calls still compile; the
/// logo has its own colours, so it is ignored.
class DragonflyMark extends StatelessWidget {
  final double size;
  final Color color;

  const DragonflyMark({
    super.key,
    this.size = 64,
    this.color = Colors.white,
  });

  @override
  Widget build(BuildContext context) => CancerCareLogo(height: size);
}
