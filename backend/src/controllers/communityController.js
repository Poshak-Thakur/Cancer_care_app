const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { isCentralCounsellor } = require('../services/authorizationService');
const { isUuid } = require('../utils/validators');

const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

const MEDIA_BUCKET = 'community_media';
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

exports.createPost = async (req, res, next) => {
    const uploadedPaths = [];
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

            for (const file of files) {
                const fileExt = file.originalname?.split('.').pop() || 'bin';
                const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

                const { error: uploadError } = await supabase.storage
                    .from(MEDIA_BUCKET)
                    .upload(fileName, file.buffer, {
                        contentType: file.mimetype,
                        upsert: false
                    });

                if (uploadError) throw uploadError;
                uploadedPaths.push(fileName);

                const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(fileName);
                mediaUrls.push(data.publicUrl);
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
            data: newPost
        });
    } catch (error) {
        // Don't leave orphaned media behind if the post could not be saved.
        if (uploadedPaths.length > 0 && supabase) {
            await supabase.storage.from(MEDIA_BUCKET).remove(uploadedPaths).catch(() => {});
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

        const formattedFeed = posts.map(post => ({
            id: post.id,
            author_id: post.author_id,
            author_name: post.author?.email?.split('@')[0] || 'Saathi User',
            post_type: post.post_type,
            content: post.content,
            media_urls: post.media_urls,
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
                    { visibility: 'PRIVATE' }
                ]
            },
            include: { author: { select: { id: true, email: true } } },
            orderBy: { created_at: 'desc' }
        });
        return res.status(200).json({ status: 'success', data: posts });
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

        const existing = await prisma.communitypost.findUnique({ where: { id }, select: { id: true } });
        if (!existing) return res.status(404).json({ status: 'error', message: 'Post not found.' });

        const updatedPost = await prisma.communitypost.update({
            where: { id },
            data: { status, moderator_feedback: moderator_feedback || null, moderator_id: userId }
        });

        return res.status(200).json({ status: 'success', data: updatedPost });
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
