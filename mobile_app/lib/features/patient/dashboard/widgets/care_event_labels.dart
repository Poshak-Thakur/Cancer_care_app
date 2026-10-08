import '../../../../core/localization/strings.dart';
import '../../../../core/utils/ist.dart';
import '../models/care_event.dart';

String careEventTypeLabel(String type) {
  switch (type) {
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

String careEventTitle(CareEvent e) {
  final custom = e.title;
  if (custom != null && custom.isNotEmpty) return custom;
  final m = e.medication;
  if (e.isMedication && m != null) {
    final strength = m.strength;
    return (strength != null && strength.isNotEmpty) ? '${m.name} — $strength' : m.name;
  }
  return careEventTypeLabel(e.type);
}

/// 12-hour clock in India Standard Time, e.g. "9:05 AM".
String careEventTime(CareEvent e) => Ist.clock(e.scheduleTime);
