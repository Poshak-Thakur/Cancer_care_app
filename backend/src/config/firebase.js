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

// NEW: Tells the receiver's phone to stop ringing if the caller hangs up
exports.sendCallCancelledPush = async (fcmToken, callId) => {
    if (!fcmToken || !isInitialized) return;
    try {
        await getMessaging().send({
            token: fcmToken,
            data: { type: 'CALL_CANCELLED', call_id: String(callId) },
            android: { priority: 'high', ttl: 60 * 1000 }
        });
        console.log(`[FCM] Sent CALL_CANCELLED to device.`);
    } catch (err) { 
        console.error('[FCM] Error sending call cancel:', err.message); 
    }
};

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
                priority: 'normal',
                notification: { sound: 'default' } // channelId removed so OS defaults work safely
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
 * Sends one critical-alert push and REPORTS THE OUTCOME instead of swallowing it:
 *   { ok: true }                     FCM accepted the message (does NOT prove the device displayed it)
 *   { ok: false, reason: '<CODE>' }  it could not be handed to FCM
 * It never throws, so a caller can always record the result on the alertdelivery row.
 */
exports.sendEmergencyAlertNotification = async (fcmToken, { title, body, alertId, patientId }) => {
    if (!fcmToken) return { ok: false, reason: 'NO_DEVICE_TOKEN' };
    if (!isInitialized) return { ok: false, reason: 'FIREBASE_NOT_INITIALIZED' };
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
                notification: { sound: 'default' } // channelId removed so OS defaults work safely
            }
        });
        console.log(`[FCM] Sent CRITICAL_ALERT notification to device.`);
        return { ok: true };
    } catch (err) {
        console.error('[FCM] Error sending alert notification:', err.message);
        // Only the error CODE is stored (never the message, which can echo the device token).
        const code = String(err && err.code ? err.code : 'UNKNOWN').replace(/[^A-Za-z0-9/_.-]/g, '').slice(0, 80) || 'UNKNOWN';
        return { ok: false, reason: `FCM_ERROR:${code}` };
    }
};
