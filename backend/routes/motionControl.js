const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const Committee = require('../models/Committee');
const Comment = require('../models/Comment');
const Vote = require('../models/Vote');
const Notification = require('../models/Notification');
const { checkVotingEligibility, isVotingPeriodExpired } = require('../utils/votingEligibility');

/**
 * POST /api/motion-control/:committeeId/:motionId/second
 * Second a motion (requires requireSecond setting enabled)
 */
router.post('/:committeeId/:motionId/second', authenticate, async (req, res) => {
    try {
        const { committeeId, motionId } = req.params;
        const userId = req.user.userId;

        const committee = await Committee.findByIdOrSlug(committeeId);
        if (!committee) {
            return res.status(404).json({ success: false, message: 'Committee not found' });
        }
        const cid = committee.committeeId;

        const motion = await Committee.findMotionById(cid, motionId);
        if (!motion) {
            return res.status(404).json({ success: false, message: 'Motion not found' });
        }

        const isMember = await Committee.isMember(cid, userId);
        if (!isMember) {
            return res.status(403).json({ success: false, message: 'Only committee members can second motions' });
        }

        if (String(motion.author) === String(userId)) {
            return res.status(400).json({ success: false, message: 'You cannot second your own motion' });
        }

        if (motion.secondedBy) {
            return res.status(400).json({ success: false, message: 'Motion has already been seconded' });
        }

        await Committee.updateMotion(cid, motionId, { secondedBy: userId });

        await Vote.updateOrCreate(userId, motionId, cid, 'yes', false);

        const voteSummary = await Vote.getVoteSummary(motionId);
        await Committee.updateMotionVoteCounts(cid, motionId, voteSummary);

        const updatedMotion = await Committee.findMotionById(cid, motionId);

        const settings = committee.settings || {};
        const eligibility = await checkVotingEligibility(updatedMotion, settings, cid);

        if (eligibility.canBegin && updatedMotion.votingStatus !== 'open') {
            await Committee.updateMotion(cid, motionId, {
                votingStatus: 'open',
                votingOpenedAt: new Date().toISOString()
            });

            await Comment.create({
                motionId,
                committeeId: cid,
                author: null,
                content: '✅ Motion has been seconded. Voting is now open.',
                stance: 'neutral',
                isSystemMessage: true,
                messageType: 'voting-eligible'
            });

            try {
                await Notification.create({
                    type: 'voting_opened',
                    committeeId: cid,
                    committeeTitle: committee.title,
                    message: `Voting is now open for "${updatedMotion.title}"`,
                    metadata: {
                        motionId,
                        motionTitle: updatedMotion.title,
                        committeeSlug: committee.slug
                    }
                });
            } catch (notifErr) {
                console.error('Failed to create voting notification:', notifErr);
            }

            const refreshedMotion = await Committee.findMotionById(cid, motionId);
            res.json({
                success: true,
                message: 'Motion seconded and voting opened',
                motion: refreshedMotion,
                voteSummary,
                eligibility
            });
        } else {
            res.json({
                success: true,
                message: 'Motion seconded successfully',
                motion: updatedMotion,
                voteSummary,
                eligibility
            });
        }
    } catch (error) {
        console.error('Error seconding motion:', error);
        res.status(500).json({ success: false, message: 'Failed to second motion', error: error.message });
    }
});

/**
 * GET /api/motion-control/:committeeId/:motionId/voting-eligibility
 */
router.get('/:committeeId/:motionId/voting-eligibility', authenticate, async (req, res) => {
    try {
        const { committeeId, motionId } = req.params;

        const committee = await Committee.findByIdOrSlug(committeeId);
        if (!committee) {
            return res.status(404).json({ success: false, message: 'Committee not found' });
        }
        const cid = committee.committeeId;

        const motion = await Committee.findMotionById(cid, motionId);
        if (!motion) {
            return res.status(404).json({ success: false, message: 'Motion not found' });
        }

        const settings = committee.settings || {};
        const eligibility = await checkVotingEligibility(motion, settings, cid);
        const expired = isVotingPeriodExpired(motion, settings);

        res.json({
            success: true,
            ...eligibility,
            votingStatus: motion.votingStatus || 'not-started',
            votingPeriodExpired: expired
        });
    } catch (error) {
        console.error('Error checking voting eligibility:', error);
        res.status(500).json({ success: false, message: 'Failed to check eligibility', error: error.message });
    }
});

/**
 * POST /api/motion-control/:committeeId/:motionId/open-voting
 * Chair-only: Open voting for a motion
 */
router.post('/:committeeId/:motionId/open-voting', authenticate, async (req, res) => {
    try {
        const { committeeId, motionId } = req.params;
        const userId = req.user.userId;

        const committee = await Committee.findByIdOrSlug(committeeId);
        if (!committee) {
            return res.status(404).json({ success: false, message: 'Committee not found' });
        }
        const cid = committee.committeeId;

        const isChair = await Committee.isChair(cid, userId);
        if (!isChair) {
            return res.status(403).json({ success: false, message: 'Only the chair can open voting' });
        }

        const motion = await Committee.findMotionById(cid, motionId);
        if (!motion) {
            return res.status(404).json({ success: false, message: 'Motion not found' });
        }

        if (motion.votingStatus === 'open') {
            return res.status(400).json({ success: false, message: 'Voting is already open' });
        }
        if (motion.votingStatus === 'closed') {
            return res.status(400).json({ success: false, message: 'Voting has been closed' });
        }

        await Committee.updateMotion(cid, motionId, {
            votingStatus: 'open',
            votingOpenedAt: new Date().toISOString()
        });

        await Comment.create({
            motionId,
            committeeId: cid,
            author: null,
            content: '🗳️ The chair has opened voting for this motion.',
            stance: 'neutral',
            isSystemMessage: true,
            messageType: 'voting-opened'
        });

        const updatedMotion = await Committee.findMotionById(cid, motionId);
        try {
            await Notification.create({
                type: 'voting_opened',
                committeeId: cid,
                committeeTitle: committee.title,
                message: `Voting is now open for "${updatedMotion.title}"`,
                metadata: {
                    motionId,
                    motionTitle: updatedMotion.title,
                    committeeSlug: committee.slug
                }
            });
        } catch (notifErr) {
            console.error('Failed to create voting notification:', notifErr);
        }

        res.json({ success: true, message: 'Voting opened successfully', motion: updatedMotion });
    } catch (error) {
        console.error('Error opening voting:', error);
        res.status(500).json({ success: false, message: 'Failed to open voting', error: error.message });
    }
});

/**
 * POST /api/motion-control/:committeeId/:motionId/close-voting
 * Chair-only: Close voting for a motion
 */
router.post('/:committeeId/:motionId/close-voting', authenticate, async (req, res) => {
    try {
        const { committeeId, motionId } = req.params;
        const userId = req.user.userId;

        const committee = await Committee.findByIdOrSlug(committeeId);
        if (!committee) {
            return res.status(404).json({ success: false, message: 'Committee not found' });
        }
        const cid = committee.committeeId;

        const isChair = await Committee.isChair(cid, userId);
        if (!isChair) {
            return res.status(403).json({ success: false, message: 'Only the chair can close voting' });
        }

        const motion = await Committee.findMotionById(cid, motionId);
        if (!motion) {
            return res.status(404).json({ success: false, message: 'Motion not found' });
        }

        if (motion.votingStatus === 'closed') {
            return res.status(400).json({ success: false, message: 'Voting is already closed' });
        }

        await Committee.updateMotion(cid, motionId, {
            votingStatus: 'closed',
            votingClosedAt: new Date().toISOString()
        });

        const voteSummary = await Vote.getVoteSummary(motionId);

        await Comment.create({
            motionId,
            committeeId: cid,
            author: null,
            content: `🔒 Voting has been closed. Final results: ${voteSummary.yes} Yes, ${voteSummary.no} No, ${voteSummary.abstain} Abstain.`,
            stance: 'neutral',
            isSystemMessage: true,
            messageType: 'voting-closed'
        });

        const updatedMotion = await Committee.findMotionById(cid, motionId);

        res.json({ success: true, message: 'Voting closed successfully', motion: updatedMotion, voteSummary });
    } catch (error) {
        console.error('Error closing voting:', error);
        res.status(500).json({ success: false, message: 'Failed to close voting', error: error.message });
    }
});

module.exports = router;
