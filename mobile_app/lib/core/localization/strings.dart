import 'lang.dart';

class S {
  static const Map<String, List<String>> _t = {
    // Home
    'goodMorning': ['Good morning, Asha', 'सुप्रभात, आशा'],
    'howFeeling': ['How are you feeling today?', 'आज आप कैसा महसूस कर रही हैं?'],
    'imOkay': ["I'm okay", 'मैं ठीक हूँ'],
    'letsCheckin': ["Let's do your check-in", 'चलिए आपकी जांच करते हैं'],
    'medicines': ['Medicines', 'दवाइयाँ'],
    'twoToday': ['2 today', 'आज 2'],
    'appointment': ['Appointment', 'अपॉइंटमेंट'],
    'tomorrow': ['Tomorrow', 'कल'],
    'yourCounsellor': ['Your counsellor', 'आपकी काउंसलर'],
    'oneNewMessage': ['1 new message', '1 नया संदेश'],
    'view': ['View →', 'देखें →'],
    'yourCommunity': ['Your community', 'आपका समुदाय'],
    'threeNewStories': ['3 new stories', '3 नई कहानियाँ'],
    'today': ['Today', 'आज'],
    'medication': ['Medication', 'दवा'],
    'checkin': ['Check-in', 'जांच'],
    'counsellorFollowup': ['Counsellor follow-up', 'काउंसलर फॉलो-अप'],
    // Check-in
    'todaysCheckin': ["Today's check-in", 'आज की जांच'],
    'checkinSub': [
      'Takes less than 30 seconds. Answer only what feels right.',
      '30 सेकंड से भी कम समय लगता है। जो सही लगे वही बताएं।'
    ],
    'pain': ['Pain', 'दर्द'],
    'fatigue': ['Fatigue', 'थकान'],
    'appetite': ['Appetite', 'भूख'],
    'mood': ['Mood', 'मनोदशा'],
    'none': ['None', 'नहीं'],
    'mild': ['Mild', 'हल्का'],
    'moderate': ['Moderate', 'मध्यम'],
    'severe': ['Severe', 'गंभीर'],
    'aLittle': ['A little', 'थोड़ी'],
    'aLot': ['A lot', 'ज़्यादा'],
    'exhausted': ['Exhausted', 'बहुत थकी'],
    'good': ['Good', 'अच्छी'],
    'okay': ['Okay', 'ठीक'],
    'low': ['Low', 'कम'],
    'veryLow': ['Very low', 'बहुत उदास'],
    'saveCheckin': ['Save check-in', 'जांच सहेजें'],
    'savedWaiting': [
      'Saved. Waiting to sync — this is normal offline, nothing is lost.',
      'सहेजा गया। सिंक होने की प्रतीक्षा है — ऑफ़लाइन होना सामान्य है, कुछ भी नहीं खोता।'
    ],
    'syncedMsg': ['Synced with your counsellor.', 'आपकी काउंसलर के साथ सिंक हो गया।'],
    // Care
    'yourCare': ['Your care', 'आपकी देखभाल'],
    'careSub': [
      'Medicines, appointments and records in one place',
      'दवाइयाँ, अपॉइंटमेंट और रिकॉर्ड एक ही जगह'
    ],
    'appointments': ['Appointments', 'अपॉइंटमेंट'],
    'learn': ['Learn', 'जानें'],
    'takenAt8': ['Taken · 8:00 AM', 'ले लिया · सुबह 8:00'],
    'dueAt9': ['Due · 9:00 PM', 'बाकी · रात 9:00'],
    'followUpVisit': ['Follow-up visit', 'फॉलो-अप विज़िट'],
    'followUpTime': ['Tomorrow · 11:30 AM', 'कल · सुबह 11:30'],
    'eatingWell': ['Eating well during treatment', 'इलाज के दौरान अच्छा खाना'],
    'reviewedByOrg': [
      'Reviewed by an authorized Saathi/NGO reviewer',
      'अधिकृत Saathi/NGO समीक्षक द्वारा समीक्षित'
    ],
    // Community
    'communitySub': ['Stories from people who understand', 'उन लोगों की कहानियां जो समझते हैं'],
    'shareSomething': ['Share something with your community…', 'अपने समुदाय के साथ कुछ साझा करें…'],
    'reply': ['Reply', 'जवाब दें'],
    'beingReviewed': ['Being reviewed', 'समीक्षा जारी है'],
    'reviewedOn': [
      'Reviewed by an authorized Saathi/NGO reviewer · 12 Sep',
      'अधिकृत Saathi/NGO समीक्षक द्वारा समीक्षित · 12 सितंबर'
    ],
    'composeTitle': ['Share with your community', 'अपने समुदाय के साथ साझा करें'],
    'composeSub': [
      'Is this your own story or experience, or are you suggesting something that helped with treatment, symptoms, or diet?',
      'क्या यह आपकी अपनी कहानी या अनुभव है, या आप कुछ ऐसा सुझा रही हैं जिससे इलाज, लक्षणों या आहार में मदद मिली?'
    ],
    'ownStory': ['My own story or experience', 'मेरी अपनी कहानी या अनुभव'],
    'ownStorySub': ['Posts right away — no review needed', 'तुरंत पोस्ट होता है — समीक्षा की ज़रूरत नहीं'],
    'suggestion': ['A treatment, symptom or diet suggestion', 'इलाज, लक्षण या आहार सुझाव'],
    'suggestionSub': [
      "An NGO reviewer checks this before it's visible to others",
      'दूसरों को दिखने से पहले एक NGO समीक्षक इसे जांचते हैं'
    ],
    'post': ['Post', 'पोस्ट करें'],
    'sharedCommunity': ['Shared with your community.', 'आपके समुदाय के साथ साझा किया गया।'],
    'sharedReview': [
      'Shared. An NGO reviewer will check it before others see it.',
      'साझा किया गया। दूसरों को दिखने से पहले एक NGO समीक्षक इसे जांचेंगे।'
    ],
    'reportedToast': [
      'Reported. Your identity stays private — even from other reporters.',
      'रिपोर्ट किया गया। आपकी पहचान निजी रहती है — अन्य रिपोर्टरों से भी।'
    ],
    'composePlaceholder': ["Share what's on your mind…", 'जो मन में है वह साझा करें…'],
    'you': ['You', 'आप'],
    'justNow': ['Just now', 'अभी अभी'],
    // Chat
    'yourNgoCounsellor': ['Your NGO counsellor', 'आपकी NGO काउंसलर'],
    'typeMessage': ['Type a message…', 'संदेश लिखें…'],
    // Profile
    'yourProfile': ['Your profile', 'आपकी प्रोफ़ाइल'],
    'profileSub': ["Tell us a little, whenever you're ready", 'जब भी तैयार हों, थोड़ा हमें बताएं'],
    'bornMeta': ['Born 14 Mar 1968 · English', 'जन्म 14 मार्च 1968 · अंग्रेज़ी'],
    'moreAboutYou': ['More about you (optional)', 'आपके बारे में और (वैकल्पिक)'],
    'cancerType': ['Cancer type & stage', 'कैंसर का प्रकार और चरण'],
    'cancerWhy': [
      'We ask this so your trend graph can compare like with like.',
      'हम यह इसलिए पूछते हैं ताकि आपका ट्रेंड ग्राफ सही तुलना कर सके।'
    ],
    'treatmentPlan': ['Treatment plan', 'इलाज योजना'],
    'treatmentWhy': [
      'Helps us tailor medication reminders to your schedule.',
      'यह आपके शेड्यूल के अनुसार दवा अनुस्मारक बनाने में मदद करता है।'
    ],
    'diagnosisDate': ['Diagnosis date', 'निदान की तारीख'],
    'diagnosisWhy': [
      'Used only to show how far along your care journey is.',
      'केवल यह दिखाने के लिए कि आपकी देखभाल यात्रा कितनी आगे बढ़ी है।'
    ],
    'add': ['Add', 'जोड़ें'],
    'inviteNote': [
      'Rather tell a person? Your counsellor can add these for you with your say-so.',
      'किसी व्यक्ति को बताना पसंद करेंगी? आपकी अनुमति से आपकी काउंसलर यह जोड़ सकती हैं।'
    ],
    'linkedCaregiver': ['Linked caregiver', 'जुड़ा हुआ देखभालकर्ता'],
    'sonFullAccess': ['Son · Full access', 'बेटा · पूर्ण पहुंच'],
    'signOut': ['Sign out', 'साइन आउट करें'],

    // Auth & onboarding
    'tagline': ['No one should walk through this alone', 'इस सफ़र में कोई अकेला न चले'],
    'welcomeTitle': ['Welcome to Saathi', 'Saathi में आपका स्वागत है'],
    'welcomeSub': [
      'Sign in with your email address. There is no password to remember.',
      'अपने ईमेल पते से साइन इन करें। कोई पासवर्ड याद रखने की ज़रूरत नहीं।'
    ],
    'iAmA': ['I am signing in as', 'मैं इस रूप में साइन इन कर रहा/रही हूँ'],
    'rolePatient': ['Patient', 'मरीज़'],
    'rolePatientSub': ['Managing my own care', 'अपनी देखभाल स्वयं संभाल रहा/रही हूँ'],
    'roleCaregiver': ['Caregiver', 'देखभालकर्ता'],
    'roleCaregiverSub': ['Supporting a loved one', 'अपने प्रियजन का साथ दे रहा/रही हूँ'],
    'comingSoon': ['Coming soon', 'जल्द आ रहा है'],
    'caregiverSoonMsg': [
      'Caregiver sign-in is coming soon. Please continue as a patient for now.',
      'देखभालकर्ता साइन-इन जल्द आ रहा है। अभी के लिए मरीज़ के रूप में जारी रखें।'
    ],
    'emailLabel': ['Email address', 'ईमेल पता'],
    'emailHint': ['you@example.com', 'you@example.com'],
    'emailInvalid': [
      'Please enter a valid email address.',
      'कृपया सही ईमेल पता दर्ज करें।'
    ],
    'sendOtp': ['Send OTP', 'OTP भेजें'],
    'otpNote': [
      "We'll email you a 6-digit code. It stays valid for 10 minutes.",
      'हम आपको 6 अंकों का कोड ईमेल करेंगे। यह 10 मिनट तक मान्य रहता है।'
    ],
    'demoBanner': [
      'Test mode: emails are not sent yet. The code appears in the backend server console.',
      'टेस्ट मोड: अभी ईमेल नहीं भेजे जाते। कोड बैकएंड सर्वर कंसोल में दिखता है।'
    ],
    'termsNote': [
      'By continuing you agree to our Terms and Privacy Policy.',
      'आगे बढ़ने पर आप हमारी शर्तों और गोपनीयता नीति से सहमत होते हैं।'
    ],
    'verifyTitle': ['Enter the code', 'कोड दर्ज करें'],
    'verifySub': ['We sent a 6-digit code to', 'हमने 6 अंकों का कोड भेजा है'],
    'verify': ['Verify', 'सत्यापित करें'],
    'otpWrong': [
      "That code doesn't match. Please try again.",
      'यह कोड मेल नहीं खाता। कृपया फिर कोशिश करें।'
    ],
    'resendIn': ['Resend code in', 'कोड दोबारा भेजें:'],
    'resendNow': ['Resend code', 'कोड दोबारा भेजें'],
    'codeSent': ['A new code has been sent.', 'नया कोड भेज दिया गया है।'],
    'changeEmail': ['Change email', 'ईमेल बदलें'],
    'otpExpired': [
      'This code has expired. Please request a new one.',
      'यह कोड समाप्त हो गया है। कृपया नया कोड मंगवाएं।'
    ],
    'genericError': [
      'Something went wrong. Please try again.',
      'कुछ गलत हो गया। कृपया दोबारा कोशिश करें।'
    ],
    'loadingAccount': ['Setting things up…', 'सब कुछ तैयार हो रहा है…'],
    'couldntLoad': ["We couldn't load your account", 'हम आपका खाता लोड नहीं कर सके'],
    'couldntLoadSub': [
      'Please check your connection and try again.',
      'कृपया अपना कनेक्शन जांचें और दोबारा कोशिश करें।'
    ],
    'tryAgain': ['Try again', 'दोबारा कोशिश करें'],
    'onbTitle': ["Let's get you started", 'चलिए शुरू करते हैं'],
    'onbSub': [
      'Just three things. That is all we need to open the app for you.',
      'बस तीन बातें। ऐप खोलने के लिए हमें बस इतना ही चाहिए।'
    ],
    'fullName': ['Full name', 'पूरा नाम'],
    'nameHint': ['e.g. Asha Kulkarni', 'जैसे आशा कुलकर्णी'],
    'dob': ['Date of birth', 'जन्म तिथि'],
    'pickDate': ['Tap to choose', 'चुनने के लिए टैप करें'],
    'prefLang': ['Preferred language', 'पसंदीदा भाषा'],
    'onbPrivacy': [
      'We never ask for cancer type or treatment details here. If a feature needs them later, we will tell you why, and you can always skip.',
      'हम यहाँ कैंसर के प्रकार या इलाज की जानकारी नहीं पूछते। बाद में किसी सुविधा को इनकी ज़रूरत हुई तो हम कारण बताएंगे, और आप छोड़ सकती हैं।'
    ],
    'getStarted': ['Get started', 'शुरू करें'],
    'signOutTitle': ['Sign out of Saathi?', 'Saathi से साइन आउट करें?'],
    'signOutBody': [
      'Your information stays safely saved. You can sign back in any time with your email and a new code.',
      'आपकी जानकारी सुरक्षित रहेगी। आप कभी भी अपने ईमेल और नए कोड से दोबारा साइन इन कर सकती हैं।'
    ],
    'cancel': ['Cancel', 'रद्द करें'],
  };

  static String t(String key) => _t[key]![Lang.isHindi.value ? 1 : 0];

  /// Home greeting personalised with the signed-in user's first name.
  static String greeting(String name) =>
      Lang.isHindi.value ? 'सुप्रभात, $name' : 'Good morning, $name';
}
