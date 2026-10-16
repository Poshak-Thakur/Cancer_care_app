import 'app_config.dart';

/// Every backend route the app uses. Mirrors backend/src/app.js and routes/*.
/// The host comes from [AppConfig.baseUrl] (see app_config.dart).
class ApiEndpoints {
  ApiEndpoints._();

  static String get baseUrl => AppConfig.baseUrl;

  static const health = '/api/health';

  // auth
  static const requestOtp = '/api/auth/request-otp';
  static const verifyOtp = '/api/auth/verify-otp';
  static const refresh = '/api/auth/refresh';
  static const logout = '/api/auth/logout';
  static const me = '/api/auth/me';
  static const authProfile = '/api/auth/profile'; // PATCH
  static const fcmToken = '/api/auth/fcm-token';

  // direct code-based patient bootstrap & later email linking from Profile
  static const claimCodeBootstrap = '/api/auth/claim-code';
  static const linkEmailRequestOtp = '/api/auth/link-email/request-otp';
  static const linkEmailVerifyOtp = '/api/auth/link-email/verify-otp';

  // patients
  static const patients = '/api/patients';
  static const myPatients = '/api/patients/me';
  static const patientClaim = '/api/patients/claim'; // POST { code }
  static String patient(String patientId) => '/api/patients/$patientId'; // PATCH

  // care events
  static const careEvents = '/api/care-events';
  static const careEventParse = '/api/care-events/parse-command';
  static String careEventsDaily(String patientId) => '/api/care-events/daily/$patientId';
  static String careEventStatus(String id) => '/api/care-events/$id/status';

  // documents / prescriptions
  static const documents = '/api/documents';
  static const prescriptionScan = '/api/documents/prescriptions/scan';
  static const medicationsConfirm = '/api/documents/medications/confirm';
  static String patientDocuments(String patientId) => '/api/documents/patient/$patientId';

  // symptoms / check-in
  static const checkIn = '/api/symptoms/check-in';
  static const checkInForm = '/api/symptoms/check-in/form'; // published NGO-controlled form
  static String todayCheckIn(String patientId) => '/api/symptoms/today/$patientId';
  static String symptomHistory(String patientId) => '/api/symptoms/history/$patientId';

  // alerts (manual Help Now)
  static const helpNow = '/api/alerts/help-now';
  static String cancelHelpNow(String alertId) => '/api/alerts/$alertId/cancel'; // PATCH

  // dashboard
  static String dashboard(String patientId) => '/api/dashboard/$patientId';

  // caregivers
  static const caregiverProfile = '/api/caregivers/profile';
  static const caregiverAvatar = '/api/caregivers/avatar';
  static const caregiverInvite = '/api/caregivers/invite';
  static const caregiverAcceptInvite = '/api/caregivers/accept-invite';
  static const caregiverPatients = '/api/caregivers/patients';
  static const caregiverRevoke = '/api/caregivers/revoke';
  static String caregiverAvailability(String patientId) => '/api/caregivers/availability/$patientId';

  // chat
  static String chatContacts(String patientId) => '/api/chat/contacts/$patientId';
  static const chatThread = '/api/chat/threads'; // POST: open or create a conversation
  static const chatConversations = '/api/chat/conversations';
  static const chatSend = '/api/chat/send';
  static const chatUploadAudio = '/api/chat/upload-audio';
  static String chatMessages(String conversationId) => '/api/chat/messages/$conversationId';

  // community
  static const communityFeed = '/api/community/feed';
  static const communityPosts = '/api/community/posts';
  static String postLike(String id) => '/api/community/posts/$id/like';
  static String postComment(String id) => '/api/community/posts/$id/comment';
  static String postComments(String id) => '/api/community/posts/$id/comments';
  static String pollVote(String optionId) => '/api/community/poll/$optionId/vote';

  // calls
  static const callInitiate = '/api/calls/initiate';
  static const callsIncoming = '/api/calls/incoming';
  static String callStatus(String id) => '/api/calls/$id/status';
}