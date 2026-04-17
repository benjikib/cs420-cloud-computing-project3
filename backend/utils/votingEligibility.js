const Comment = require('../models/Comment');
const Vote = require('../models/Vote');

/**
 * Check if voting is eligible for a motion based on committee settings
 * @param {Object} motion - The motion document
 * @param {Object} committeeSettings - The committee settings object
 * @param {String} committeeId - The committee ID
 * @returns {Object} { eligible: boolean, reasons: string[], canBegin: boolean }
 */
async function checkVotingEligibility(motion, committeeSettings, committeeId) {
    const reasons = [];
    let eligible = true;

    // If motion already has voting closed, not eligible
    if (motion.votingStatus === 'closed') {
        reasons.push('Voting has been closed for this motion');
        return { eligible: false, reasons, canBegin: false };
    }

    // If voting is already open, eligible
    if (motion.votingStatus === 'open') {
        return { eligible: true, reasons: ['Voting is currently open'], canBegin: true };
    }

    // Check if motion is a subsidiary, incidental, or privileged motion
    // These motions bypass all discussion requirements per Robert's Rules
    const subsidiaryMotionTypes = [
        'amend', 'refer_to_committee', 'postpone', 'limit_debate', 
        'previous_question', 'table', 'reconsider'
    ];
    const incidentalMotionTypes = [
        'point_of_order', 'appeal', 'suspend_rules', 'division'
    ];
    const privilegedMotionTypes = [
        'recess', 'adjourn', 'question_of_privilege'
    ];
    
    const isProcedural = motion.motionType && (
        subsidiaryMotionTypes.includes(motion.motionType) ||
        incidentalMotionTypes.includes(motion.motionType) ||
        privilegedMotionTypes.includes(motion.motionType)
    );
    
    // For procedural motions (subsidiary, incidental, privileged), skip all discussion requirements
    // They can go straight to voting
    if (isProcedural) {
        console.log('✓ Procedural motion (subsidiary/incidental/privileged) - bypassing all discussion requirements');
        return { eligible: true, reasons: ['Procedural motion - voting can begin immediately'], canBegin: true };
    }

    // Check seconding requirement (only for main motions)
    if (committeeSettings.requireSecond && !motion.secondedBy) {
        reasons.push('Motion must be seconded before voting can begin');
        eligible = false;
    }

    // Check minimum speakers requirement
    if (committeeSettings.minSpeakersBeforeVote > 0) {
        try {
            const result = await Comment.findByMotion(motion.motionId || motion._id?.toString(), 1, 1000);
            const comments = (result.comments || []).filter(c => !c.isSystemMessage);

            // Get unique authors
            let motionAuthorStr = motion.author ? String(motion.author) : null;
            
            const uniqueSpeakers = new Set();
            
            // Always count the motion author as a speaker
            if (motionAuthorStr) {
                uniqueSpeakers.add(motionAuthorStr);
            }
            
            console.log('=== SPEAKER COUNT DEBUG ===');
            console.log('Motion author (normalized):', motionAuthorStr);
            console.log('  ✓ Motion author counted as speaker');
            console.log('Total comments found:', comments.length);
            
            comments.forEach(comment => {
                const commentAuthorStr = String(comment.author);
                console.log('  Comment author:', commentAuthorStr, '| isSystem:', comment.isSystemMessage, '| content:', comment.content?.substring(0, 30));
                
                if (!comment.isSystemMessage) {
                    const wasNew = !uniqueSpeakers.has(commentAuthorStr);
                    uniqueSpeakers.add(commentAuthorStr);
                    if (wasNew) {
                        console.log('    ✓ Added as unique speaker');
                    } else {
                        console.log('    ✓ Already counted');
                    }
                } else {
                    console.log('    ✗ Skipped (system message)');
                }
            });

            console.log('Unique speakers:', Array.from(uniqueSpeakers));
            console.log(`Result: ${uniqueSpeakers.size}/${committeeSettings.minSpeakersBeforeVote} speakers`);
            console.log('=========================');

            if (uniqueSpeakers.size < committeeSettings.minSpeakersBeforeVote) {
                reasons.push(
                    `Need ${committeeSettings.minSpeakersBeforeVote - uniqueSpeakers.size} more speaker(s) ` +
                    `(${uniqueSpeakers.size}/${committeeSettings.minSpeakersBeforeVote})`
                );
                eligible = false;
            }
        } catch (err) {
            console.error('Error checking speaker count:', err);
            reasons.push('Unable to verify speaker requirement');
            eligible = false;
        }
    }

    // Check Pro/Con balance requirement
    if (committeeSettings.requireProConBalance) {
        try {
            const result = await Comment.findByMotion(motion.motionId || motion._id?.toString(), 1, 1000);
            const comments = (result.comments || []).filter(c => !c.isSystemMessage);
            
            const hasProComment = comments.some(c => c.stance === 'pro');
            const hasConComment = comments.some(c => c.stance === 'con');

            if (!hasProComment || !hasConComment) {
                const missing = [];
                if (!hasProComment) missing.push('supporting');
                if (!hasConComment) missing.push('opposing');
                reasons.push(`Need at least one ${missing.join(' and ')} comment`);
                eligible = false;
            }
        } catch (err) {
            console.error('Error checking pro/con balance:', err);
            reasons.push('Unable to verify pro/con balance');
            eligible = false;
        }
    }

    // Check minimum discussion period
    if (committeeSettings.minDiscussionHours > 0) {
        const motionCreatedAt = new Date(motion.createdAt);
        const hoursElapsed = (Date.now() - motionCreatedAt.getTime()) / (1000 * 60 * 60);
        
        if (hoursElapsed < committeeSettings.minDiscussionHours) {
            const hoursRemaining = Math.ceil(committeeSettings.minDiscussionHours - hoursElapsed);
            reasons.push(
                `Minimum discussion period not met (${hoursRemaining} hour(s) remaining)`
            );
            eligible = false;
        }
    }

    return { 
        eligible, 
        reasons: eligible ? ['All requirements met - voting can begin'] : reasons,
        canBegin: eligible
    };
}

/**
 * Check if voting period has expired
 * @param {Object} motion - The motion document
 * @param {Object} committeeSettings - The committee settings
 * @returns {boolean} - true if voting period has expired
 */
function isVotingPeriodExpired(motion, committeeSettings) {
    if (!motion.votingOpenedAt || motion.votingStatus === 'closed') {
        return false;
    }

    const votingOpenedAt = new Date(motion.votingOpenedAt);
    const expiresAt = new Date(votingOpenedAt.getTime() + (committeeSettings.votingPeriodDays * 24 * 60 * 60 * 1000));
    
    return Date.now() > expiresAt.getTime();
}

/**
 * Close voting and fail motion if voting period has expired without meeting requirements
 * @param {Object} motion - The motion document
 * @param {Object} committee - The committee document
 * @param {Function} updateMotionFn - Function to update the motion
 * @param {Function} createCommentFn - Function to create a system comment
 * @returns {Promise<boolean>} - true if motion was closed due to expiration
 */
async function closeExpiredVoting(motion, committee, updateMotionFn, createCommentFn) {
    const settings = committee.settings || {};
    
    if (!isVotingPeriodExpired(motion, settings)) {
        return false;
    }

    // Voting period has expired - close voting and fail the motion
    const committeeId = committee.committeeId || committee._id?.toString();
    const motionId = motion.motionId || motion._id?.toString();

    await updateMotionFn(committeeId, motionId, {
        status: 'failed',
        votingStatus: 'closed',
        votingClosedAt: new Date().toISOString()
    });

    // Create system message
    const totalVotes = motion.votes.yes + motion.votes.no + motion.votes.abstain;
    const totalMembers = committee.members ? committee.members.length : 0;

    await createCommentFn({
        motionId,
        committeeId,
        author: null,
        content: `❌ Voting period expired. Motion failed - quorum/participation requirements not met (${totalVotes}/${totalMembers} members voted)`,
        stance: 'neutral',
        isSystemMessage: true,
        messageType: 'voting-expired'
    });

    console.log(`Voting expired for motion ${motionId} - marked as failed`);
    return true;
}

/**
 * Check if quorum is met for a motion
 * @param {Object} motion - The motion document
 * @param {Object} committeeSettings - The committee settings
 * @param {Number} totalMembers - Total number of committee members
 * @returns {Object} { met: boolean, required: number, current: number }
 */
function checkQuorum(motion, committeeSettings, totalMembers) {
    if (!committeeSettings.quorumRequired) {
        return { met: true, required: 0, current: 0, notRequired: true };
    }

    const totalVotes = motion.votes.yes + motion.votes.no + motion.votes.abstain;
    const required = Math.ceil(totalMembers * (committeeSettings.quorumPercentage / 100));
    
    return {
        met: totalVotes >= required,
        required,
        current: totalVotes,
        notRequired: false
    };
}

/**
 * Determine motion result based on vote threshold
 * @param {Object} motion - The motion with votes
 * @param {String} threshold - 'simple_majority' | 'two_thirds' | 'unanimous'
 * @returns {Object} { passed: boolean, yesPercent: number, threshold: string }
 */
function calculateMotionResult(motion, threshold = 'simple_majority') {
    const totalVotes = motion.votes.yes + motion.votes.no;
    
    if (totalVotes === 0) {
        return { passed: false, yesPercent: 0, threshold, reason: 'No votes cast' };
    }

    const yesPercent = (motion.votes.yes / totalVotes) * 100;
    let requiredPercent = 50;
    let passed = false;

    switch (threshold) {
        case 'simple_majority':
            requiredPercent = 50;
            passed = yesPercent > 50;
            break;
        case 'two_thirds':
            requiredPercent = 66.67;
            passed = yesPercent >= 66.67;
            break;
        case 'unanimous':
            requiredPercent = 100;
            passed = yesPercent === 100;
            break;
    }

    return { 
        passed, 
        yesPercent: yesPercent.toFixed(2),
        requiredPercent,
        threshold,
        reason: passed ? 'Motion passed' : 'Motion failed'
    };
}

module.exports = {
    checkVotingEligibility,
    isVotingPeriodExpired,
    closeExpiredVoting,
    checkQuorum,
    calculateMotionResult
};
