import 'dart:math' as math;
import 'package:flutter/material.dart';

/// The Cancer Care pillar's dragonfly mark, drawn from the same geometry as the
/// design prototype's splash SVG (100x100 viewBox).
class DragonflyMark extends StatelessWidget {
  final double size;
  final Color color;
  const DragonflyMark({super.key, this.size = 64, this.color = Colors.white});

  @override
  Widget build(BuildContext context) {
    return CustomPaint(size: Size.square(size), painter: _DragonflyPainter(color));
  }
}

class _DragonflyPainter extends CustomPainter {
  final Color color;
  _DragonflyPainter(this.color);

  @override
  void paint(Canvas canvas, Size size) {
    final k = size.width / 100;
    final stroke = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 3.2 * k
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    void wing(double cx, double cy, double rx, double ry, double deg) {
      canvas.save();
      canvas.translate(cx * k, cy * k);
      canvas.rotate(deg * math.pi / 180);
      canvas.drawOval(Rect.fromCenter(center: Offset.zero, width: rx * 2 * k, height: ry * 2 * k), stroke);
      canvas.restore();
    }

    wing(33, 34, 21, 9.5, -24);
    wing(67, 34, 21, 9.5, 24);
    wing(35, 53, 16, 7, -14);
    wing(65, 53, 16, 7, 14);
    canvas.drawLine(Offset(50 * k, 24 * k), Offset(50 * k, 80 * k), stroke);
    canvas.drawCircle(Offset(50 * k, 18 * k), 7 * k, stroke);
  }

  @override
  bool shouldRepaint(covariant _DragonflyPainter old) => old.color != color;
}
