const prisma = require('../config/db');
const { createClient } = require('@supabase/supabase-js');
const { isCentralCounsellor } = require('../services/authorizationService');

const supabase = (process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY))
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY)
    : null;

// Helper function to verify if user is an NGO Admin/Counsellor
const isStaffUser = async (userId) => {
    const isCentral = await isCentralCounsellor(userId);
    if (isCentral) return true;
    const isAssigned = await prisma.staffassignment.findFirst({ where: { staff_user_id: userId, status: 'ACTIVE' } });
    return !!isAssigned;
};

exports.createPost = async (req, res, next) => {
    try {
        const userId = req.user.userId;
        const { content, post_type = 'TEXT', visibility = 'PUBLIC' } = req.body;
        // poll_options can come in as a string array or comma-separated string depending on form-data
        let poll_options = req.body.poll_options; 
        const files = req.files || [];

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

        const isStaff = await isStaffUser(userId);

        if (post_type === 'POLL') {
            if (!isStaff) return res.status(403).json({ status: 'error', message: 'Only NGO Staff can create polls.' });
            if (!poll_options || !Array.isArray(poll_options) || poll_options.length < 2) {
                return res.status(400).json({ status: 'error', message: 'Polls require at least 2 options.' });
            }
        }

        let mediaUrls = [];
        if (files.length > 0) {
            if (!supabase) return res.status(500).json({ status: 'error', message: 'Storage not configured.' });

            for (const file of files) {
                const fileExt = file.originalname?.split('.').pop() || 'bin';
                const fileName = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

                const { error: uploadError } = await supabase.storage
                    .from('community_media')
                    .upload(fileName, file.buffer, {
                        contentType: file.mimetype,
                        upsert: false
                    });

                if (uploadError) throw uploadError;

                const { data } = supabase.storage.from('community_media').getPublicUrl(fileName);
                mediaUrls.push(data.publicUrl);
            }
        }

        const postStatus = isStaff ? 'APPROVED' : 'PENDING';

        const newPost = await prisma.communitypost.create({
            data: {
                author_id: userId,
                post_type,
                content: content || '',
                media_urls: mediaUrls,
                visibility,
                status: postStatus
            }
        });

        if (post_type === 'POLL' && poll_options) {
            const optionsData = poll_options.map(opt => ({
                post_id: newPost.id,
                option: String(opt).trim()
            }));
            await prisma.polloption.createMany({ data: optionsData });
        }

        const privateMessage = "Your entry is completely hidden from the community. For your safety and care, it is securely shared with your NGO counselor so they can support you.";
        const publicMessage = postStatus === 'APPROVED' ? "Post published." : "Post submitted successfully. It will appear in the community feed once approved by a moderator.";

        return res.status(201).json({ 
            status: 'success', 
            message: visibility === 'PRIVATE' ? privateMessage : publicMessage,
            data: newPost 
        });
    } catch (error) { next(error); }
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
        const isStaff = await isCentralCounsellor(userId);
        
        if (!isStaff) return res.status(403).json({ status: 'error', message: 'Only NGO staff can access the moderation queue.' });

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

        if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
            return res.status(400).json({ status: 'error', message: 'Invalid moderation status.' });
        }

        const isStaff = await isCentralCounsellor(userId);
        if (!isStaff) return res.status(403).json({ status: 'error', message: 'Only authorized NGO staff can moderate posts.' });

        if (status === 'REJECTED' && !moderator_feedback) {
            return res.status(400).json({ status: 'error', message: 'A compassionate moderator_feedback reason is required when rejecting a post.' });
        }

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

        const existingLike = await prisma.postlike.findUnique({
            where: { post_id_user_id: { post_id, user_id: userId } }
        });

        if (existingLike) {
            await prisma.postlike.delete({ where: { id: existingLike.id } });
            return res.status(200).json({ status: 'success', message: 'Post unliked', is_liked: false });
        } else {
            await prisma.postlike.create({ data: { post_id, user_id: userId } });
            return res.status(200).json({ status: 'success', message: 'Post liked', is_liked: true });
        }
    } catch (error) { next(error); }
};

exports.addComment = async (req, res, next) => {
    try {
        const { id: post_id } = req.params;
        const { content } = req.body;
        const userId = req.user.userId;

        if (!content || content.trim() === '') {
            return res.status(400).json({ status: 'error', message: 'Comment content is required.' });
        }

        const comment = await prisma.postcomment.create({
            data: { post_id, user_id: userId, content }
        });

        return res.status(201).json({ status: 'success', data: comment });
    } catch (error) { next(error); }
};

exports.getComments = async (req, res, next) => {
    try {
        const { id: post_id } = req.params;
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

        const option = await prisma.polloption.findUnique({ where: { id: option_id }});
        if (!option) return res.status(404).json({ status: 'error', message: 'Poll option not found.' });

        const existingVoteInPost = await prisma.pollvote.findFirst({
            where: { 
                user_id: userId, 
                option: { post_id: option.post_id } 
            }
        });

        if (existingVoteInPost) {
            return res.status(400).json({ status: 'error', message: 'You have already voted on this poll.' });
        }

        const vote = await prisma.pollvote.create({
            data: { polloption_id: option_id, user_id: userId }
        });

        return res.status(201).json({ status: 'success', data: vote });
    } catch (error) { next(error); }
};