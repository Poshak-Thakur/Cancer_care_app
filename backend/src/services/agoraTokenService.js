const { RtcTokenBuilder, RtcRole } = require('agora-token');

/**
 * Agora RTC token for a call room. ONE place builds it, so POST /api/calls/initiate and
 * POST /api/calls/:id/join-token always produce tokens the same way:
 * uid 0 (any uid), PUBLISHER role, valid for one hour from now.
 */
const TOKEN_TTL_SECONDS = 3600;

// Returns { appId, appCertificate } or null when the server is not configured for calls.
const getAgoraCredentials = () => {
    const appId = process.env.AGORA_APP_ID || '';
    const appCertificate = process.env.AGORA_APP_CERTIFICATE || '';
    return appId && appCertificate ? { appId, appCertificate } : null;
};

const buildCallToken = ({ appId, appCertificate }, channelName) => {
    const privilegeExpiredTs = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
    return RtcTokenBuilder.buildTokenWithUid(appId, appCertificate, channelName, 0, RtcRole.PUBLISHER, privilegeExpiredTs);
};

module.exports = { getAgoraCredentials, buildCallToken, TOKEN_TTL_SECONDS };
