const prisma = require('../config/db');
const { isCentralCounsellor } = require('../services/authorizationService');

exports.createPost = async (req, res, next) => {
    try {
        const { content, media_url, visibility = 'PUBLIC' } = req.body;
        const userId = req.user.userId;

        if (!content) return res.status(400).json({ status: 'error', message: 'Post content is required.' });
        if (!['PUBLIC', 'PRIVATE'].includes(visibility)) return res.status(400).json({ status: 'error', message: 'Invalid visibility value.' });

        const post = await prisma.communitypost.create({
            data: { author_id: userId, content, media_url: media_url || null, visibility }
        });

        const privateMessage = "Your entry is completely hidden from the community. For your safety and care, it is securely shared with your NGO counselor so they can support you.";
        const publicMessage = "Post submitted successfully. It will appear in the community feed once approved by a moderator.";

        return res.status(201).json({ status: 'success', message: visibility === 'PRIVATE' ? privateMessage : publicMessage, data: post });
    } catch (error) { next(error); }
};

exports.getPublicFeed = async (req, res, next) => {
    try {
        const posts = await prisma.communitypost.findMany({
            where: { visibility: 'PUBLIC', status: 'APPROVED' },
            include: { author: { select: { id: true } } },
            orderBy: { created_at: 'desc' }
        });
        return res.status(200).json({ status: 'success', data: posts });
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