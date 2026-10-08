import '../../../core/constants/app_config.dart';
import '../../auth/services/auth_state.dart';
import '../../patient/messages/models/care_contact.dart';
import '../../patient/messages/services/chat_service.dart';

/// Finds the NGO helpline staff account an unlinked user can chat and call
/// (`patient_id: null` on the backend).
class HelplineService {
  /// Order: configured id (app_config.dart) > a staff contact already seen >
  /// a staff contact from this user's care team. Null when none is known.
  static Future<CareContact?> resolve() async {
    final id = AppConfig.helplineStaffUserId;
    if (id.isNotEmpty) {
      return ContactDirectory.contactFor(id) ??
          CareContact(userId: id, name: 'NGO Helpline', role: 'NGO Staff', category: 'STAFF');
    }
    final known = ContactDirectory.anyStaff;
    if (known != null) return known;
    final pid = AuthState.patientId;
    if (pid != null) {
      try {
        final all = await ChatService().contacts(pid);
        for (final c in all) {
          if (c.isStaff) return c;
        }
      } catch (_) {}
    }
    return null;
  }
}
