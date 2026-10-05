import '../../../../core/localization/strings.dart';
import '../models/care_event.dart';

String careEventTitle(CareEvent e) {
  final m = e.medication;
  if (e.isMedication && m != null) {
    final strength = m.strength;
    return (strength != null && strength.isNotEmpty) ? '${m.name} — $strength' : m.name;
  }
  switch (e.type) {
    case 'MEDICATION_DOSE':
      return S.t('medication');
    case 'APPOINTMENT':
      return S.t('appointment');
    case 'THERAPY_SESSION':
      return S.t('therapySession');
    case 'COUNSELLOR_FOLLOWUP':
      return S.t('counsellorFollowup');
    case 'HOME_VISIT':
      return S.t('homeVisit');
    default:
      return S.t('otherTask');
  }
}

/// 12-hour clock, e.g. "9:05 AM".
String careEventTime(CareEvent e) {
  final t = e.scheduleTime;
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  final m = t.minute.toString().padLeft(2, '0');
  return '$h:$m ${t.hour < 12 ? 'AM' : 'PM'}';
}
