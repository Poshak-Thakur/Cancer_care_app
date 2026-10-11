const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { isCentralCounsellor } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');
const HttpError = require('../utils/httpError');
const { recordAudit, AUDIT_ACTIONS, RESOURCES } = require('../services/auditService');

const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

// PUBLIC posts: public bucket (permanent public URL is fine - the post is public).
// PRIVATE posts: PRIVATE bucket + short-lived signed URLs, so the media can never be fetched
// just by knowing/guessing a URL. Create BOTH buckets in Supabase; the private one must NOT be public.
const MEDIA_BUCKET = 'community_media';
const PRIVATE_MEDIA_BUCKET = process.env.SUPABASE_PRIVATE_MEDIA_BUCKET || 'community_media_private';
const PRIVATE_PREFIX = 'private://';
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_MEDIA_FILES = 5;
const VALID_POST_TYPES = ['TEXT', 'IMAGE', 'VIDEO', 'POLL'];
const VALID_VISIBILITIES = ['PUBLIC', 'PRIVATE'];

// Required MIME prefix per post type. TEXT / POLL posts carry no media at all.
const MEDIA_RULES = { IMAGE: 'image/', VIDEO: 'video/' };

// The single NGO authority (central head/counsellor). No separate staff logic.
const isNgoAuthority = (userId) => isCentralCounsellor(userId);

// Returns the post only if this user is allowed to see it:
//   - the NGO authority sees everything
//   - the author sees their own posts
//   - everyone else only sees PUBLIC + APPROVED posts
// Otherwise null (callers answer 404 so the existence of hidden posts is not leaked).
const getAccessiblePost = async (postId, userId) => {
    if (!isUuid(postId)) return null;
    const post = await prisma.communitypost.findUnique({ where: { id: postId } });
    if (!post) return null;
    if (post.author_id === userId) return post;
    if (post.visibility === 'PUBLIC' && post.status === 'APPROVED') return post;
    if (await isNgoAuthority(userId)) return post;
    return null;
};

// Turns stored media references into URLs a client can open.
//   public URL            -> returned as is
//   private://<path>      -> a signed URL valid for one hour (only ever produced by handlers that
//                            have already authorised the reader)
const resolveMediaUrls = async (mediaUrls) => {
    const out = [];
    for (const url of Array.isArray(mediaUrls) ? mediaUrls : []) {
        if (typeof url === 'string' && url.startsWith(PRIVATE_PREFIX)) {
            if (!supabase) continue;
            const { data, error } = await supabase.storage
                .from(PRIVATE_MEDIA_BUCKET)
                .createSignedUrl(url.slice(PRIVATE_PREFIX.length), SIGNED_URL_TTL_SECONDS);
            if (!error && data?.signedUrl) out.push(data.signedUrl);
        } else {
            out.push(url);
        }
    }
    return out;
};

exports.createPost = async (req, res, next) => {
    const uploadedPaths = [];
    let uploadBucket = MEDIA_BUCKET;
    try {
        const userId = req.user.userId;
        const { post_type = 'TEXT', visibility = 'PUBLIC' } = req.body;
        const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
        // poll_options can come in as a string array or comma-separated string depending on form-data
        let poll_options = req.body.poll_options;
        const files = req.files || [];

        if (!VALID_POST_TYPES.includes(post_type)) {
            return res.status(400).json({ status: 'error', message: `Invalid post_type. Use one of: ${VALID_POST_TYPES.join(', ')}.` });
        }
        if (!VALID_VISIBILITIES.includes(visibility)) {
            return res.status(400).json({ status: 'error', message: 'Invalid visibility. Use PUBLIC or PRIVATE.' });
        }

        if (typeof poll_options === 'string') {
            try {
                poll_options = JSON.parse(poll_options);
            } catch (e) {
                poll_options = poll_options.split(',');
            }
        }

        if (!content && post_type !== 'IMAGE' && post_type !== 'VIDEO') {
            return res.status(400).json({ status: 'error', message: 'Text content is required.' });
        }

        // ---- media validation: IMAGE -> image/*, VIDEO -> video/*, nothing for TEXT/POLL ----
        if (files.length > MAX_MEDIA_FILES) {
            return res.status(400).json({ status: 'error', message: `A post can have at most ${MAX_MEDIA_FILES} media files.` });
        }
        const requiredPrefix = MEDIA_RULES[post_type];
        if (!requiredPrefix && files.length > 0) {
            return res.status(400).json({ status: 'error', message: `${post_type} posts cannot include media files. Use post_type IMAGE or VIDEO.` });
        }
        if (requiredPrefix) {
            if (files.length === 0) {
                return res.status(400).json({ status: 'error', message: `${post_type} posts require at least one media file.` });
            }
            const incompatible = files.find(f => typeof f.mimetype !== 'string' || !f.mimetype.startsWith(requiredPrefix));
            if (incompatible) {
                return res.status(400).json({
                    status: 'error',
                    message: `Invalid file type "${incompatible.mimetype}". ${post_type} posts only accept ${requiredPrefix}* files.`
                });
            }
        }

        const isNgo = await isNgoAuthority(userId);

        let pollOptionRows = [];
        if (post_type === 'POLL') {
            if (!isNgo) return res.status(403).json({ status: 'error', message: 'Only the NGO counsellor can create polls.' });
            if (!Array.isArray(poll_options)) {
                return res.status(400).json({ status: 'error', message: 'Polls require at least 2 options.' });
            }
            const cleaned = [...new Set(poll_options.map(o => String(o).trim()).filter(Boolean))];
            if (cleaned.length < 2) {
                return res.status(400).json({ status: 'error', message: 'Polls require at least 2 distinct options.' });
            }
            if (cleaned.some(o => o.length > 255)) {
                return res.status(400).json({ status: 'error', message: 'Poll options must be 255 characters or fewer.' });
            }
            pollOptionRows = cleaned.map(option => ({ option }));
        }

        let mediaUrls = [];
        if (files.length > 0) {
            if (!supabase) return res.status(500).json({ status: 'error', message: 'Storage not configured.' });

            const isPrivatePost = visibility === 'PRIVATE';
            uploadBucket = isPrivatePost ? PRIVATE_MEDIA_BUCKET : MEDIA_BUCKET;

            for (const file of files) {
                const fileExt = file.originalname?.split('.').pop() || 'bin';
                const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

                const { error: uploadError } = await supabase.storage
                    .from(uploadBucket)
                    .upload(fileName, file.buffer, {
                        contentType: file.mimetype,
                        upsert: false
                    });

                if (uploadError) throw uploadError;
                uploadedPaths.push(fileName);

                if (isPrivatePost) {
                    // Never store a permanent public URL for private media - store a reference only.
                    mediaUrls.push(`${PRIVATE_PREFIX}${fileName}`);
                } else {
                    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(fileName);
                    mediaUrls.push(data.publicUrl);
                }
            }
        }

        // NGO authority posts are auto-approved; everyone else goes to the moderation queue.
        const postStatus = isNgo ? 'APPROVED' : 'PENDING';

        // Post + poll options are created in ONE statement (atomic): no poll without options.
        const newPost = await prisma.communitypost.create({
            data: {
                author_id: userId,
                post_type,
                content,
                media_urls: mediaUrls,
                visibility,
                status: postStatus,
                ...(pollOptionRows.length > 0 ? { polloption: { create: pollOptionRows } } : {})
            },
            include: { polloption: true }
        });

        const privateMessage = "Your entry is completely hidden from the community. For your safety and care, it is securely shared with your NGO counselor so they can support you.";
        const publicMessage = postStatus === 'APPROVED' ? "Post published." : "Post submitted successfully. It will appear in the community feed once approved by a moderator.";

        return res.status(201).json({
            status: 'success',
            message: visibility === 'PRIVATE' ? privateMessage : publicMessage,
            data: { ...newPost, media_urls: await resolveMediaUrls(newPost.media_urls) }
        });
    } catch (error) {
        // Don't leave orphaned media behind if the post could not be saved.
        if (uploadedPaths.length > 0 && supabase) {
            await supabase.storage.from(uploadBucket).remove(uploadedPaths).catch(() => {});
        }
        next(error);
    }
};

exports.getPublicFeed = async (req, res, next) => {
    try {
        const userId = req.user.userId;

        const posts = await prisma.communitypost.findMany({
            where: { visibility: 'PUBLIC', status: 'APPROVED' },
            orderBy: { created_at: 'desc' },
            take: 50,
            include: {
                author: { select: { id: true, email: true } },
                _count: { select: { postlike: true, postcomment: true } },
                polloption: {
                    include: {
                        _count: { select: { pollvote: true } },
                        pollvote: { where: { user_id: userId }, select: { id: true } }
                    }
                },
                postlike: { where: { user_id: userId }, select: { id: true } }
            }
        });

        const resolvedMedia = await Promise.all(posts.map(p => resolveMediaUrls(p.media_urls)));

        const formattedFeed = posts.map((post, i) => ({
            id: post.id,
            author_id: post.author_id,
            author_name: post.author?.email?.split('@')[0] || 'Saathi User',
            post_type: post.post_type,
            content: post.content,
            media_urls: resolvedMedia[i],
            created_at: post.created_at,
            likes_count: post._count.postlike,
            comments_count: post._count.postcomment,
            is_liked_by_me: post.postlike.length > 0,
            poll_options: post.polloption.map(opt => ({
                id: opt.id,
                option: opt.option,
                votes: opt._count.pollvote,
                voted_by_me: opt.pollvote.length > 0
            }))
        }));

        return res.status(200).json({ status: 'success', data: formattedFeed });
    } catch (error) { next(error); }
};

const MAX_REPORT_REASON_LENGTH = 1000;
const MAX_MODERATOR_NOTE_LENGTH = 2000;
const REPORT_REVIEW_STATUSES = ['REVIEWED', 'DISMISSED'];
const REPORTER_BRIEF = { id: true, email: true, full_name: true };

// POST /api/community/posts/:id/report   body: { reason }
exports.reportPost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const raw = req.body ? req.body.reason : undefined;

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid post id.' });
        if (typeof raw !== 'string' || raw.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'A reason is required to report a post.' });
        }
        const reason = raw.trim();
        if (reason.length > MAX_REPORT_REASON_LENGTH) {
            return res.status(400).json({ status: 'error', message: `reason must be at most ${MAX_REPORT_REASON_LENGTH} characters.` });
        }

        // You can only report what you can see (hidden / private posts answer 404).
        const post = await getAccessiblePost(id, userId);
        if (!post) return res.status(404).json({ status: 'error', message: 'Post not found.' });
        if (post.author_id === userId) {
            return res.status(400).json({ status: 'error', message: 'You cannot report your own post.' });
        }

        const duplicate = () => res.status(409).json({
            status: 'error',
            code: 'ALREADY_REPORTED',
            message: 'You have already reported this post. It is waiting for review.'
        });

        // One OPEN report per user per post (the database enforces it too - see the partial unique index).
        const open = await prisma.communityreport.findFirst({ where: { post_id: id, reporter_id: userId, status: 'OPEN' } });
        if (open) return duplicate();

        let report;
        try {
            report = await prisma.$transaction(async (tx) => {
                const created = await tx.communityreport.create({
                    data: { post_id: id, reporter_id: userId, reason, status: 'OPEN' }
                });
                await recordAudit(tx, {
                    actorId: userId,
                    action: AUDIT_ACTIONS.COMMUNITY_REPORT_CREATED,
                    targetResource: RESOURCES.COMMUNITY_REPORT,
                    targetId: created.id,
                    extra: { post_id: id },
                    req
                });
                return created;
            });
        } catch (err) {
            if (err.code === 'P2002') return duplicate(); // lost a race with an identical request
            throw err;
        }

        return res.status(201).json({ status: 'success', message: 'Thank you. The NGO team will review this post.', data: report });
    } catch (error) { next(error); }
};

// PATCH /api/community/reports/:id/status   body: { status: 'REVIEWED' | 'DISMISSED', moderator_note? }  (central NGO only)
exports.updateReportStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        const { status } = req.body || {};

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid report id.' });
        if (!(await isNgoAuthority(userId))) {
            return res.status(403).json({ status: 'error', message: 'Only the NGO counsellor can review reports.' });
        }
        if (!REPORT_REVIEW_STATUSES.includes(status)) {
            return res.status(400).json({ status: 'error', message: `status must be one of: ${REPORT_REVIEW_STATUSES.join(', ')}.` });
        }
        let moderatorNote = null;
        if (req.body.moderator_note !== undefined && req.body.moderator_note !== null) {
            if (typeof req.body.moderator_note !== 'string') {
                return res.status(400).json({ status: 'error', message: 'moderator_note must be a string.' });
            }
            moderatorNote = req.body.moderator_note.trim() || null;
            if (moderatorNote && moderatorNote.length > MAX_MODERATOR_NOTE_LENGTH) {
                return res.status(400).json({ status: 'error', message: `moderator_note must be at most ${MAX_MODERATOR_NOTE_LENGTH} characters.` });
            }
        }

        const existing = await prisma.communityreport.findUnique({ where: { id } });
        if (!existing) return res.status(404).json({ status: 'error', message: 'Report not found.' });

        const updated = await prisma.$transaction(async (tx) => {
            // Atomic: a report is reviewed once; only OPEN reports can change.
            const changed = await tx.communityreport.updateMany({
                where: { id, status: 'OPEN' },
                data: { status, reviewed_by: userId, reviewed_at: new Date(), moderator_note: moderatorNote }
            });
            if (changed.count !== 1) {
                throw new HttpError(409, 'This report has already been reviewed.', 'REPORT_ALREADY_REVIEWED');
            }
            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.COMMUNITY_REPORT_REVIEWED,
                targetResource: RESOURCES.COMMUNITY_REPORT,
                targetId: id,
                extra: { post_id: existing.post_id, from: 'OPEN', to: status },
                req
            });
            return tx.communityreport.findUnique({ where: { id } });
        });

        return res.status(200).json({ status: 'success', data: updated });
    } catch (error) { next(error); }
};

exports.getModerationQueue = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        if (!(await isNgoAuthority(userId))) {
            return res.status(403).json({ status: 'error', message: 'Only the NGO counsellor can access the moderation queue.' });
        }

        const posts = await prisma.communitypost.findMany({
            where: {
                OR: [
                    { visibility: 'PUBLIC', status: 'PENDING' },
                    { visibility: 'PRIVATE' },
                    // Already-approved public posts that someone has reported and nobody has reviewed yet.
                    { visibility: 'PUBLIC', status: 'APPROVED', communityreport: { some: { status: 'OPEN' } } }
                ]
            },
            include: {
                author: { select: { id: true, email: true } },
                communityreport: {
                    where: { status: 'OPEN' },
                    orderBy: { created_at: 'asc' },
                    include: { reporter: { select: REPORTER_BRIEF } }
                }
            },
            orderBy: { created_at: 'desc' }
        });
        const data = await Promise.all(posts.map(async ({ communityreport, ...p }) => {
            const reports = (communityreport || []).map(({ reporter, ...r }) => ({ ...r, reporter }));
            return {
                ...p,
                media_urls: await resolveMediaUrls(p.media_urls),
                open_reports_count: reports.length,
                reports
            };
        }));
        return res.status(200).json({ status: 'success', data });
    } catch (error) { next(error); }
};

exports.moderatePost = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, moderator_feedback } = req.body;
        const userId = req.user.userId;

        if (!isUuid(id)) return res.status(400).json({ status: 'error', message: 'Invalid post id.' });
        if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid moderation status.' });
        }

        if (!(await isNgoAuthority(userId))) {
            return res.status(403).json({ status: 'error', message: 'Only the NGO counsellor can moderate posts.' });
        }

        if (status === 'REJECTED' && !moderator_feedback) {
            return res.status(400).json({ status: 'error', message: 'A compassionate moderator_feedback reason is required when rejecting a post.' });
        }

        const existing = await prisma.communitypost.findUnique({ where: { id }, select: { id: true, status: true } });
        if (!existing) return res.status(404).json({ status: 'error', message: 'Post not found.' });

        // Post status, any open reports on it, and the audit record change together.
        const { updatedPost, reportsClosed } = await prisma.$transaction(async (tx) => {
            const post = await tx.communitypost.update({
                where: { id },
                data: { status, moderator_feedback: moderator_feedback || null, moderator_id: userId }
            });
            // Approve / reject / request-revision (PENDING + feedback) all count as the moderator's review.
            const closed = await tx.communityreport.updateMany({
                where: { post_id: id, status: 'OPEN' },
                data: {
                    status: 'REVIEWED',
                    reviewed_by: userId,
                    reviewed_at: new Date(),
                    moderator_note: moderator_feedback || null
                }
            });
            await recordAudit(tx, {
                actorId: userId,
                action: AUDIT_ACTIONS.COMMUNITY_POST_MODERATED,
                targetResource: RESOURCES.COMMUNITY_POST,
                targetId: id,
                extra: { from: existing.status, to: status, feedback_provided: !!moderator_feedback, reports_closed: closed.count },
                req
            });
            return { updatedPost: post, reportsClosed: closed.count };
        });

        return res.status(200).json({
            status: 'success',
            data: { ...updatedPost, media_urls: await resolveMediaUrls(updatedPost.media_urls) },
            meta: { reports_closed: reportsClosed }
        });
    } catch (error) { next(error); }
};

exports.toggleLike = async (req, res, next) => {
    try {
        const { id: post_id } = req.params;
        const userId = req.user.userId;

        // Access is checked BEFORE any interaction.
        const post = await getAccessiblePost(post_id, userId);
        if (!post) return res.status(404).json({ status: 'error', message: 'Post not found.' });

        const existingLike = await prisma.postlike.findUnique({
            where: { post_id_user_id: { post_id, user_id: userId } }
        });

        if (existingLike) {
            await prisma.postlike.deleteMany({ where: { id: existingLike.id } });
            return res.status(200).json({ status: 'success', message: 'Post unliked', is_liked: false });
        }

        try {
            await prisma.postlike.create({ data: { post_id, user_id: userId } });
        } catch (err) {
            // Double-tap race: the like already exists, which is the state the user asked for.
            if (err.code !== 'P2002') throw err;
        }
        return res.status(200).json({ status: 'success', message: 'Post liked', is_liked: true });
    } catch (error) { next(error); }
};

exports.addComment = async (req, res, next) => {
    try {
        const { id: post_id } = req.params;
        const { content } = req.body;
        const userId = req.user.userId;

        if (typeof content !== 'string' || content.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'Comment content is required.' });
        }

        const post = await getAccessiblePost(post_id, userId);
        if (!post) return res.status(404).json({ status: 'error', message: 'Post not found.' });

        const comment = await prisma.postcomment.create({
            data: { post_id, user_id: userId, content: content.trim() }
        });

        return res.status(201).json({ status: 'success', data: comment });
    } catch (error) { next(error); }
};

exports.getComments = async (req, res, next) => {
    try {
        const { id: post_id } = req.params;
        const userId = req.user.userId;

        const post = await getAccessiblePost(post_id, userId);
        if (!post) return res.status(404).json({ status: 'error', message: 'Post not found.' });

        const comments = await prisma.postcomment.findMany({
            where: { post_id },
            orderBy: { created_at: 'asc' },
            include: { user: { select: { id: true, email: true } } }
        });

        const formatted = comments.map(c => ({
            id: c.id,
            content: c.content,
            author_name: c.user?.email?.split('@')[0] || 'User',
            created_at: c.created_at
        }));

        return res.status(200).json({ status: 'success', data: formatted });
    } catch (error) { next(error); }
};

exports.votePoll = async (req, res, next) => {
    try {
        const { option_id } = req.params;
        const userId = req.user.userId;

        if (!isUuid(option_id)) return res.status(404).json({ status: 'error', message: 'Poll option not found.' });

        const option = await prisma.polloption.findUnique({ where: { id: option_id } });
        if (!option) return res.status(404).json({ status: 'error', message: 'Poll option not found.' });

        // The voter must be allowed to see the poll's post.
        const post = await getAccessiblePost(option.post_id, userId);
        if (!post) return res.status(404).json({ status: 'error', message: 'Poll option not found.' });

        const existingVoteInPost = await prisma.pollvote.findFirst({
            where: { user_id: userId, post_id: option.post_id }
        });
        if (existingVoteInPost) {
            return res.status(400).json({ status: 'error', message: 'You have already voted on this poll.' });
        }

        try {
            // post_id is stored on the vote so the DB itself enforces one vote per user per poll.
            const vote = await prisma.pollvote.create({
                data: { polloption_id: option_id, post_id: option.post_id, user_id: userId }
            });
            return res.status(201).json({ status: 'success', data: vote });
        } catch (err) {
            if (err.code === 'P2002') {
                return res.status(400).json({ status: 'error', message: 'You have already voted on this poll.' });
            }
            throw err;
        }
    } catch (error) { next(error); }
};
