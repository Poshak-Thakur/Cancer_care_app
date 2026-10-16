/// One entry of GET /api/chat/contacts/:patient_id.
///
/// The backend already formats the display name ("NGO Counsellor", the
/// caregiver's relationship label, or the patient's full name) and removes the
/// signed-in user from the list.
class CareContact {
  final String userId;
  final String name;
  final String role;
  final String category; // STAFF | CAREGIVER | PATIENT

  const CareContact({
    required this.userId,
    required this.name,
    required this.role,
    required this.category,
  });

  String get displayName => name.isEmpty ? role : name;
  String get initial => displayName.isEmpty ? '?' : displayName[0].toUpperCase();
  bool get isStaff => category == 'STAFF';
  bool get isPatient => category == 'PATIENT';

  /// The backend sends `userId` / `displayName` / `isStaff` / `isPatient`
  /// (older versions sent `user_id` / `name` / `category`); both are accepted.
  factory CareContact.fromJson(Map<String, dynamic> j) {
    final id = (j['userId'] ?? j['user_id'])?.toString() ?? '';
    final isStaff = j['isStaff'] == true;
    final isPatient = j['isPatient'] == true;
    final category = (j['category'] as String?) ?? (isStaff ? 'STAFF' : (isPatient ? 'PATIENT' : 'CAREGIVER'));
    return CareContact(
      userId: id,
      name: ((j['displayName'] ?? j['name']) as String?) ?? '',
      role: (j['role'] as String?) ?? '',
      category: category,
    );
  }
}

/// Remembers contacts so other screens can show who someone is (an incoming
/// call or a conversation only carries a user id).
class ContactDirectory {
  static final Map<String, CareContact> _byId = {};

  static void remember(Iterable<CareContact> contacts) {
    for (final c in contacts) {
      _byId[c.userId] = c;
    }
  }

  static CareContact? contactFor(String userId) => _byId[userId];
  static String? nameFor(String userId) => _byId[userId]?.displayName;

  /// First known NGO staff contact (used to reach the helpline).
  static CareContact? get anyStaff {
    for (final c in _byId.values) {
      if (c.isStaff) return c;
    }
    return null;
  }

  static void clear() => _byId.clear();
}
