const express = require('express');
const { body, validationResult } = require('express-validator');
const Vote = require('../models/Vote');
const Committee = require('../models/Committee');
const Comment = require('../models/Comment');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { authenticate } = require('../middleware/auth');
const { checkVotingEligibility, isVotingPeriodExpired, closeExpiredVoting, checkQuorum, calculateMotionResult } = require('../utils/votingEligibility');

const router = express.Router();

/**
 * @route   GET /committee/:id/motion/:motionId/votes
 * @desc    Get vote summary and details
 * @access  Private
 */
router.get('/committee/:id/motion/:motionId/votes', authenticate, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const motion = await Committee.findMotionById(committee.committeeId, req.params.motionId);
    if (!motion) {
      return res.status(404).json({ success: false, message: 'Motion not found' });
    }

    const summary = await Vote.getVoteSummary(req.params.motionId);
    const userVote = await Vote.findByUserAndMotion(req.user.userId, req.params.motionId);

    res.json({
      success: true,
      summary,
      userVote: userVote ? { vote: userVote.vote, votedAt: userVote.createdAt } : null
    });
  } catch (error) {
    console.error('Get votes error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching votes' });
  }
});

/**
 * @route   POST /committee/:id/motion/:motionId/vote
 * @desc    Cast or update a vote
 * @access  Private
 */
router.post('/committee/:id/motion/:motionId/vote',
  authenticate,
  [
    body('vote').isIn(['yes', 'no', 'abstain']).withMessage('Vote must be yes, no, or abstain'),
    body('isAnonymous').optional().isBoolean().withMessage('isAnonymous must be a boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const committee = await Committee.findByIdOrSlug(req.params.id);
      if (!committee) {
        return res.status(404).json({ success: false, message: 'Committee not found' });
      }
      const committeeId = committee.committeeId;

      const motion = await Committee.findMotionById(committeeId, req.params.motionId);
      if (!motion) {
        return res.status(404).json({ success: false, message: 'Motion not found' });
      }

      // Block guests from voting
      const role = await Committee.getMemberRole(committeeId, req.user.userId);
      if (!role || role === 'guest') {
        return res.status(403).json({
          success: false,
          message: 'You must be a member (not a guest) of this committee to vote'
        });
      }

      const { vote, isAnonymous } = req.body;
      const settings = committee.settings || {};

      if (vote === 'abstain' && !settings.allowAbstentions) {
        return res.status(400).json({ success: false, message: 'Abstentions are not allowed in this committee' });
      }

      if (motion.votingStatus === 'closed') {
        return res.status(400).json({ success: false, message: 'Voting has been closed for this motion' });
      }

      const currentVotingStatus = motion.votingStatus || 'not-started';

      // Check if voting period has expired and auto-close if needed
      if (currentVotingStatus === 'open') {
        const wasExpired = await closeExpiredVoting(motion, committee, Committee.updateMotion.bind(Committee), Comment.create.bind(Comment));
        if (wasExpired) {
          return res.status(400).json({ success: false, message: 'Voting period has expired for this motion' });
        }
      }

      const isChair = await Committee.isChair(committeeId, req.user.userId);
      if (currentVotingStatus !== 'open' && !isChair) {
        const eligibility = await checkVotingEligibility(motion, settings, committeeId);
        if (!eligibility.eligible) {
          return res.status(400).json({
            success: false,
            message: 'Voting requirements not met',
            reasons: eligibility.reasons
          });
        }

        if (eligibility.canBegin && currentVotingStatus === 'not-started') {
          await Committee.updateMotion(committeeId, req.params.motionId, {
            votingStatus: 'open',
            votingOpenedAt: new Date().toISOString()
          });

          console.log('✓ Auto-opened voting for motion', req.params.motionId);

          await Comment.create({
            motionId: req.params.motionId,
            committeeId,
            author: null,
            content: '✅ All requirements met. Voting can begin.',
            stance: 'neutral',
            isSystemMessage: true,
            messageType: 'voting-eligible'
          });

          try {
            await Notification.create({
              type: 'voting_opened',
              committeeId,
              committeeTitle: committee.title,
              message: `Voting is now open for "${motion.title}"`,
              metadata: {
                motionId: req.params.motionId,
                motionTitle: motion.title,
                committeeSlug: committee.slug
              }
            });
          } catch (notifErr) {
            console.error('Failed to create voting notification:', notifErr);
          }
        }
      }

      console.log('Casting vote:', { motionId: req.params.motionId, committeeId, userId: req.user.userId, vote });

      const voteRecord = await Vote.updateOrCreate(
        req.user.userId,
        req.params.motionId,
        committeeId,
        vote,
        isAnonymous || false
      );

      // Roll call system comment
      if (settings.voteType === 'roll_call') {
        try {
          const user = await User.findById(req.user.userId);
          const userName = user ? (user.name || user.email || 'Unknown User') : 'Unknown User';
          const voteEmoji = vote === 'yes' ? '✅' : vote === 'no' ? '❌' : '⚪';
          await Comment.create({
            motionId: req.params.motionId,
            committeeId,
            author: null,
            content: `${voteEmoji} Roll Call: ${userName} voted ${vote.toUpperCase()}`,
            stance: 'neutral',
            isSystemMessage: true,
            messageType: 'roll-call-vote'
          });
        } catch (err) {
          console.warn('Failed to create roll call comment:', err);
        }
      }

      // Update embedded vote counts
      const updatedSummary = await Vote.getVoteSummary(req.params.motionId);
      await Committee.updateMotionVoteCounts(committeeId, req.params.motionId, updatedSummary);

      const updatedMotion = await Committee.findMotionById(committeeId, req.params.motionId);

      console.log('=== MOTION STATUS AFTER VOTE ===');
      console.log('Motion found:', !!updatedMotion);
      console.log('Voting status:', updatedMotion?.votingStatus);
      console.log('Motion status:', updatedMotion?.status);
      console.log('Votes:', updatedMotion?.votes);
      console.log('Motion type:', updatedMotion?.motionType);
      console.log('Vote required:', updatedMotion?.voteRequired);
      console.log('================================');

      const updatedVotingStatus = updatedMotion?.votingStatus || 'not-started';
      if (updatedMotion && updatedVotingStatus === 'open') {
        let threshold = settings.defaultVoteThreshold || 'simple_majority';
        if (updatedMotion.voteRequired) {
          if (updatedMotion.voteRequired === 'majority') threshold = 'simple_majority';
          else if (updatedMotion.voteRequired === 'two-thirds') threshold = 'two_thirds';
          else if (updatedMotion.voteRequired === 'unanimous') threshold = 'unanimous';
          else if (updatedMotion.voteRequired === 'none') threshold = null;
        }

        if (threshold) {
          const result = calculateMotionResult(updatedMotion, threshold);
          const totalMembers = committee.members ? committee.members.length : 0;
          const quorumCheck = checkQuorum(updatedMotion, settings, totalMembers);

          console.log('=== AUTO-CLOSE CHECK ===');
          console.log('Threshold:', threshold);
          console.log('Votes:', updatedMotion.votes);
          console.log('Result:', result);
          console.log('Total Members:', totalMembers);
          console.log('Quorum Check:', quorumCheck);

          let minParticipationPercent = 50;
          if (threshold === 'two_thirds') minParticipationPercent = 66.67;
          else if (threshold === 'unanimous') minParticipationPercent = 100;

          const totalVotes = updatedMotion.votes.yes + updatedMotion.votes.no + updatedMotion.votes.abstain;
          const participationPercent = totalMembers > 0 ? (totalVotes / totalMembers) * 100 : 0;
          const minParticipationMet = participationPercent >= minParticipationPercent;

          console.log('Min participation required:', minParticipationPercent + '%');
          console.log('Current participation:', participationPercent.toFixed(2) + '%', '(' + totalVotes + '/' + totalMembers + ')');
          console.log('Participation met:', minParticipationMet);

          let shouldAutoClose = false;
          let finalStatus = 'active';
          let closureReason = '';

          if (result.passed && minParticipationMet && (!settings.quorumRequired || quorumCheck.met)) {
            shouldAutoClose = true;
            finalStatus = 'passed';
            closureReason = `Motion passed with ${result.yesPercent}% yes votes (${threshold} threshold, ${totalVotes}/${totalMembers} members voted)`;
            console.log('✓ Motion should pass');
          } else if (result.passed && !minParticipationMet) {
            console.log('✗ Motion passed threshold but not enough members voted');
          } else if (result.passed && settings.quorumRequired && !quorumCheck.met) {
            console.log('✗ Motion passed threshold but quorum not met');
          } else if (!result.passed) {
            const votesRemaining = totalMembers - totalVotes;
            const maxPossibleYes = updatedMotion.votes.yes + votesRemaining;
            const maxPossibleTotal = updatedMotion.votes.yes + updatedMotion.votes.no + votesRemaining;

            if (maxPossibleTotal > 0) {
              const maxPossiblePercent = (maxPossibleYes / maxPossibleTotal) * 100;
              if (maxPossiblePercent < result.requiredPercent) {
                shouldAutoClose = true;
                finalStatus = 'failed';
                closureReason = `Motion failed - cannot reach ${threshold} threshold (${result.yesPercent}% yes)`;
              }
            }
          }

          if (shouldAutoClose) {
            await Committee.updateMotion(committeeId, req.params.motionId, {
              status: finalStatus,
              votingStatus: 'closed',
              votingClosedAt: new Date().toISOString()
            });

            const statusEmoji = finalStatus === 'passed' ? '✅' : '❌';
            await Comment.create({
              motionId: req.params.motionId,
              committeeId,
              author: null,
              content: `${statusEmoji} ${closureReason}`,
              stance: 'neutral',
              isSystemMessage: true,
              messageType: 'voting-closed'
            });

            console.log(`Auto-closed motion ${req.params.motionId}: ${closureReason}`);

            // If a reconsider motion passed, restore the target motion
            if (finalStatus === 'passed' && updatedMotion.motionType === 'reconsider' && updatedMotion.targetMotionId) {
              try {
                console.log('Reconsider motion passed - restoring target motion:', updatedMotion.targetMotionId);

                await Committee.updateMotion(committeeId, String(updatedMotion.targetMotionId), {
                  status: 'active',
                  votingStatus: 'not-started',
                  votingClosedAt: null,
                  votes: { yes: 0, no: 0, abstain: 0 }
                });

                // Delete all votes for the target motion
                await Vote.deleteByMotion(String(updatedMotion.targetMotionId));

                await Comment.create({
                  motionId: String(updatedMotion.targetMotionId),
                  committeeId,
                  author: null,
                  content: '🔄 This motion has been reconsidered and is now open for discussion and voting again.',
                  stance: 'neutral',
                  isSystemMessage: true,
                  messageType: 'motion-reconsidered'
                });

                console.log('✓ Target motion successfully reconsidered and reset');
              } catch (err) {
                console.error('Error reconsidering target motion:', err);
              }
            }
          }
        }
      }

      const summary = await Vote.getVoteSummary(req.params.motionId);
      const userVote = await Vote.findByUserAndMotion(req.user.userId, req.params.motionId);

      res.status(201).json({
        success: true,
        message: 'Vote recorded successfully',
        vote: userVote ? { vote: userVote.vote, votedAt: userVote.updatedAt || userVote.createdAt } : null,
        summary
      });
    } catch (error) {
      console.error('Cast vote error:', error);
      res.status(500).json({ success: false, message: 'Server error recording vote' });
    }
  }
);

/**
 * @route   DELETE /committee/:id/motion/:motionId/vote
 * @desc    Remove your vote
 * @access  Private
 */
router.delete('/committee/:id/motion/:motionId/vote', authenticate, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }
    const committeeId = committee.committeeId;

    const motion = await Committee.findMotionById(committeeId, req.params.motionId);
    if (!motion) {
      return res.status(404).json({ success: false, message: 'Motion not found' });
    }

    const role = await Committee.getMemberRole(committeeId, req.user.userId);
    if (!role || role === 'guest') {
      return res.status(403).json({ success: false, message: 'Guests are not permitted to vote' });
    }

    const existing = await Vote.findByUserAndMotion(req.user.userId, req.params.motionId);
    if (!existing) {
      return res.status(404).json({ success: false, message: 'No vote found to delete' });
    }

    await Vote.deleteByUserAndMotion(req.user.userId, req.params.motionId);

    const summary = await Vote.getVoteSummary(req.params.motionId);
    await Committee.updateMotionVoteCounts(committeeId, req.params.motionId, summary);

    res.json({ success: true, message: 'Vote removed successfully', summary });
  } catch (error) {
    console.error('Delete vote error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting vote' });
  }
});

module.exports = router;
