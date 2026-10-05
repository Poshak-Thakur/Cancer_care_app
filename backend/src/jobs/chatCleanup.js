const cron = require('node-cron');
const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

const supabase = (supabaseUrl && supabaseKey) 
    ? createClient(supabaseUrl, supabaseKey) 
    : null;

async function purgeExpiredChatsAndMedia() {
    try {
        const AUDIO_RETENTION_DAYS = 3;
        const TEXT_RETENTION_DAYS = 7;
        
        const audioCutoff = new Date(Date.now() - AUDIO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const textCutoff = new Date(Date.now() - TEXT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

        console.log(`[Auto-Cleanup] Scanning for audio older than 3 days and text older than 7 days...`);

        // 1. Locate and delete expired AUDIO messages (3 Days)
        if (supabase) {
            const expiredMedia = await prisma.chatmessage.findMany({
                where: { created_at: { lt: audioCutoff }, message_type: 'AUDIO', media_url: { not: null } },
                select: { id: true, media_url: true }
            });

            if (expiredMedia.length > 0) {
                const filePaths = expiredMedia.map(m => {
                    const parts = m.media_url.split('/voice_notes/');
                    return parts.length > 1 ? parts[1].split('?')[0] : m.media_url.split('/').pop().split('?')[0];
                }).filter(Boolean);

                if (filePaths.length > 0) {
                    await supabase.storage.from('voice_notes').remove(filePaths);
                    console.log(`[Auto-Cleanup] Removed ${filePaths.length} audio files from Supabase Storage.`);
                }
            }
        }
        
        // Delete the AUDIO rows from the database
        await prisma.chatmessage.deleteMany({
            where: { created_at: { lt: audioCutoff }, message_type: 'AUDIO' }
        });

        // 2. Delete expired TEXT messages (7 Days)
        const deletedText = await prisma.chatmessage.deleteMany({
            where: { created_at: { lt: textCutoff }, message_type: 'TEXT' }
        });

        console.log(`[Auto-Cleanup] Successfully purged ${deletedText.count} expired text messages.`);
    } catch (error) {
        console.error('[Auto-Cleanup] Error during ephemeral chat purge:', error);
    }
}

function initChatCleanupJob() {
    purgeExpiredChatsAndMedia();
    cron.schedule('0 3 * * *', () => {
        purgeExpiredChatsAndMedia();
    });
}

module.exports = { initChatCleanupJob, purgeExpiredChatsAndMedia };