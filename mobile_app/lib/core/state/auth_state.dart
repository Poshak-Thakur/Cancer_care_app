/// Frontend-only session store. There is no backend: everything lives in memory
/// for the lifetime of the app process, which is enough to demo the full flow.
///
/// Swap this for a real auth repository (POST /auth/otp/request and
/// /auth/otp/verify, see API spec) when the backend is wired in.
class UserProfile {
  final String name;
  final DateTime dob;
  final String role; // 'patient' | 'caregiver'
  const UserProfile({required this.name, required this.dob, required this.role});
}

class AuthState {
  /// The OTP accepted by the demo. Any valid mobile number works.
  static const demoOtp = '123456';

  static String phone = '';
  static String role = 'patient';

  /// Profiles keyed by phone number, so a returning number skips onboarding.
  static final Map<String, UserProfile> _users = {};

  static bool get isReturningUser => _users.containsKey(phone);
  static UserProfile? get profile => _users[phone];

  static void saveProfile({required String name, required DateTime dob}) {
    _users[phone] = UserProfile(name: name.trim(), dob: dob, role: role);
  }

  /// First name for greetings; falls back to a friendly default in demo mode.
  static String get firstName {
    final n = profile?.name ?? '';
    return n.isEmpty ? 'Asha' : n.split(RegExp(r'\s+')).first;
  }

  static String get fullName => profile?.name ?? 'Asha Kulkarni';
  static String get initial => fullName.isEmpty ? 'A' : fullName[0].toUpperCase();

  static String get bornDisplay {
    final d = profile?.dob;
    if (d == null) return '';
    return '${d.day} ${_months[d.month - 1]} ${d.year}';
  }

  static String get maskedPhone {
    if (phone.length < 10) return phone;
    return '+91 ${phone.substring(0, 2)}XXX XX${phone.substring(8)}';
  }

  static void signOut() {
    phone = '';
  }

  static const _months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
}
