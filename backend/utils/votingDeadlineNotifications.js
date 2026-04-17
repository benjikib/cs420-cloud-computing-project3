const Committee = require('../models/Committee');
const Notification = require('../models/Notification');

/**
 * Check all open motions and send notifications for those past 50% of voting duration.
 * Called periodically (every 30 minutes from server.js).
 */
async function checkAndNotifyVotingDeadlines() {
  try {
    console.log('🔔 Checking for voting deadline notifications...');

    const committees = await Committee.findAll();
    let notificationsCreated = 0;

    for (const committee of committees) {
      if (!committee.motions || committee.motions.length === 0) continue;

      const settings = committee.settings || {};
      const votingPeriodDays = settings.votingPeriodDays || 7;
      const votingPeriodMs = votingPeriodDays * 24 * 60 * 60 * 1000;
      const halfwayMs = votingPeriodMs / 2;

      for (const motion of committee.motions) {
        if (motion.votingStatus !== 'open' || !motion.votingOpenedAt) continue;

        const now = new Date();
        const openedAt = new Date(motion.votingOpenedAt);
        const timeElapsed = now - openedAt;
        const closeAt = new Date(openedAt.getTime() + votingPeriodMs);

        if (timeElapsed >= halfwayMs && timeElapsed < votingPeriodMs) {
          // Check if we've already sent this notification
          const existing = await Notification.findPendingAccessRequest(committee.committeeId, null)
            .catch(() => null);

          // Use a scan-based check for the deadline notification
          const allNotifs = await Notification.findAll();
          const existingNotif = allNotifs.find(n =>
            n.type === 'voting_deadline_approaching' &&
            n.metadata?.motionId === motion.motionId &&
            n.committeeId === committee.committeeId
          );

          if (!existingNotif) {
            const timeRemaining = closeAt - now;
            const hoursRemaining = Math.ceil(timeRemaining / (60 * 60 * 1000));
            const daysRemaining = Math.ceil(timeRemaining / (24 * 60 * 60 * 1000));

            let timeRemainingText;
            if (daysRemaining > 1) timeRemainingText = `${daysRemaining} days`;
            else if (hoursRemaining > 1) timeRemainingText = `${hoursRemaining} hours`;
            else timeRemainingText = 'less than 1 hour';

            await Notification.create({
              type: 'voting_deadline_approaching',
              committeeId: committee.committeeId,
              committeeTitle: committee.title,
              message: `Voting closes in ${timeRemainingText} for "${motion.title}"`,
              metadata: {
                motionId: motion.motionId,
                motionTitle: motion.title,
                committeeSlug: committee.slug,
                closesAt: closeAt.toISOString(),
                timeRemaining: timeRemainingText
              }
            });

            notificationsCreated++;
            console.log(`  ✓ Created deadline notification for motion: ${motion.title}`);
          }
        }
      }
    }

    if (notificationsCreated > 0) {
      console.log(`✅ Created ${notificationsCreated} voting deadline notifications`);
    } else {
      console.log('✓ No new deadline notifications needed');
    }
  } catch (error) {
    console.error('❌ Error checking voting deadlines:', error);
  }
}

module.exports = { checkAndNotifyVotingDeadlines };
