/// Mirrors backend/src/app.js and backend/src/routes/*.
class ApiEndpoints {
  /// Override at build time:
  ///   flutter run --dart-define=API_BASE_URL=http://192.168.1.10:3000
  /// 10.0.2.2 reaches the host machine from the Android emulator.
  static const baseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');

  static const health = '/api/health';

  // auth
  static const requestOtp = '/api/auth/request-otp';
  static const verifyOtp = '/api/auth/verify-otp';
  static const refresh = '/api/auth/refresh';
  static const logout = '/api/auth/logout';
  static const me = '/api/auth/me';

  // patients
  static const patients = '/api/patients';
  static const myPatients = '/api/patients/me';

  // care events
  static const careEvents = '/api/care-events';
  static String careEventsDaily(String patientId) => '/api/care-events/daily/$patientId';
  static String careEventStatus(String id) => '/api/care-events/$id/status';

  // documents
  static const documents = '/api/documents';
  static String patientDocuments(String patientId) => '/api/documents/patient/$patientId';
  static String verifyDocument(String id) => '/api/documents/$id/verify';

  // symptoms / check-in
  static const checkIn = '/api/symptoms/check-in';
  static String todayCheckIn(String patientId) => '/api/symptoms/today/$patientId';

  // dashboard
  static String dashboard(String patientId) => '/api/dashboard/$patientId';

  // caregivers
  static const caregiverProfile = '/api/caregivers/profile';
  static const caregiverInvite = '/api/caregivers/invite';
  static const caregiverAcceptInvite = '/api/caregivers/accept-invite';
  static const caregiverPatients = '/api/caregivers/patients';
  static String caregiverAvailability(String patientId) => '/api/caregivers/availability/$patientId';

  // chat
  static String chatContacts(String patientId) => '/api/chat/contacts/$patientId';
  static const chatThread = '/api/chat/thread';
  static const chatSend = '/api/chat/send';
  static const chatUploadAudio = '/api/chat/upload-audio';
  static String chatMessages(String conversationId) => '/api/chat/messages/$conversationId';

  // community
  static const communityFeed = '/api/community/feed';
  static const communityPosts = '/api/community/posts';

  // calls
  static const callInitiate = '/api/calls/initiate';
  static String callStatus(String id) => '/api/calls/$id/status';
}
