const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const path = require('path');

let isInitialized = false;

try {
    const serviceAccount = require(path.join(__dirname, '../../firebase-key.json'));
    
    // Modern v12+ Initialization
    initializeApp({
        credential: cert(serviceAccount)
    });
    
    isInitialized = true;
    console.log('✅ Firebase Admin SDK initialized successfully.');
} catch (error) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
}

/**
 * High-priority push to wake the phone and trigger the ring screen.
 * Always fires regardless of general notification toggles.
 */
exports.sendCallPushNotification = async (fcmToken, callData) => {
    if (!fcmToken || !isInitialized) return;
    try {
        await getMessaging().send({
            token: fcmToken,
            data: {
                type: 'CALL_INVITATION',
                call_id: String(callData.call_id),
                caller_id: String(callData.caller_id),
                caller_name: String(callData.caller_name),
                call_type: String(callData.call_type),
                channelName: String(callData.channelName),
                token: String(callData.token),
                appId: String(callData.appId)
            },
            android: {
                priority: 'high',
                ttl: 60 * 1000 // 60 seconds expiry if phone is offline
            },
            apns: {
                payload: { aps: { contentAvailable: true } },
                headers: { 'apns-priority': '10', 'apns-push-type': 'background' }
            }
        });
        console.log(`[FCM] Sent CALL_INVITATION to device.`);
    } catch (err) {
        console.error('[FCM] Error sending call notification:', err.message);
    }
};

/**
 * Standard priority push notification for incoming chat messages.
 * Only sends if recipient has notifications enabled.
 */
exports.sendMessagePushNotification = async (fcmToken, { title, body, conversationId, senderId }) => {
    if (!fcmToken || !isInitialized) return;
    try {
        await getMessaging().send({
            token: fcmToken,
            notification: {
                title,
                body
            },
            data: {
                type: 'CHAT_MESSAGE',
                conversation_id: String(conversationId),
                sender_id: String(senderId)
            },
            android: {
                priority: 'normal', // Normal priority respects OS quiet hours/do-not-disturb
                notification: { sound: 'default', channelId: 'chat_messages' }
            },
            apns: {
                payload: { aps: { sound: 'default' } }
            }
        });
        console.log(`[FCM] Sent CHAT_MESSAGE notification to device.`);
    } catch (err) {
        console.error('[FCM] Error sending chat notification:', err.message);
    }
};

/**
 * Critical emergency push for worsening symptoms or SOS alerts.
 * Always fires regardless of general notification toggles.
 */
exports.sendEmergencyAlertNotification = async (fcmToken, { title, body, alertId, patientId }) => {
    if (!fcmToken || !isInitialized) return;
    try {
        await getMessaging().send({
            token: fcmToken,
            notification: {
                title: `🚨 ${title}`,
                body
            },
            data: {
                type: 'CRITICAL_ALERT',
                alert_id: String(alertId),
                patient_id: String(patientId)
            },
            android: {
                priority: 'high',
                notification: { sound: 'default', channelId: 'emergency_alerts', priority: 'max' }
            }
        });
        console.log(`[FCM] Sent CRITICAL_ALERT notification to device.`);
    } catch (err) {
        console.error('[FCM] Error sending alert notification:', err.message);
    }
};