/// India Standard Time helpers.
///
/// The backend cuts "today" at midnight in Asia/Kolkata (UTC+5:30, no DST), for
/// care events, the dashboard and the daily check-in. The app uses the same
/// clock so a day never looks different on the phone and on the server.
class Ist {
  Ist._();

  static const Duration offset = Duration(hours: 5, minutes: 30);

  /// Current wall-clock time in IST, as a plain (non-UTC) DateTime.
  static DateTime now() {
    final u = DateTime.now().toUtc().add(offset);
    return DateTime(u.year, u.month, u.day, u.hour, u.minute, u.second);
  }

  /// Today's calendar date in IST (time set to 00:00).
  static DateTime today() {
    final n = now();
    return DateTime(n.year, n.month, n.day);
  }

  /// Calendar date (in IST) of an absolute moment.
  static DateTime dayOf(DateTime moment) {
    final u = moment.toUtc().add(offset);
    return DateTime(u.year, u.month, u.day);
  }

  static bool sameDay(DateTime a, DateTime b) => a.year == b.year && a.month == b.month && a.day == b.day;

  /// IST wall-clock reading ("6 Oct, 10:00") of an absolute moment, as a plain
  /// DateTime whose fields are the IST clock fields.
  static DateTime toWall(DateTime moment) {
    final u = moment.toUtc().add(offset);
    return DateTime(u.year, u.month, u.day, u.hour, u.minute);
  }

  /// The absolute moment of an IST wall-clock reading (inverse of [toWall]).
  static DateTime fromWall(DateTime wall) =>
      DateTime.utc(wall.year, wall.month, wall.day, wall.hour, wall.minute).subtract(offset);

  /// Value for the `?date=` query of /care-events/daily: a plain YYYY-MM-DD,
  /// which the backend reads as that IST calendar day.
  static String dateParam(DateTime day) =>
      '${day.year.toString().padLeft(4, '0')}-${day.month.toString().padLeft(2, '0')}-${day.day.toString().padLeft(2, '0')}';

  /// "9:05 AM" for a moment, shown in IST.
  static String clock(DateTime moment) {
    final t = moment.toUtc().add(offset);
    final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
    return '$h:${t.minute.toString().padLeft(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}';
  }

  static const _months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  static const _weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  /// "6 Oct 2026"
  static String dateLabel(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';

  /// "Tue, 6 Oct"
  static String shortDay(DateTime d) => '${_weekdays[d.weekday - 1]}, ${d.day} ${_months[d.month - 1]}';
}
