import React, { useState, useEffect } from 'react';
import { getCurrentUser } from '../services/userApi';
import { getCommitteeById } from '../services/committeeApi';
import { getVotes } from '../services/voteApi';
import { getMotionById } from '../services/motionApi';
import { getCommentsByMotion } from '../services/commentApi';

export default function AnalyticsPanel() {
    const [analyticsData, setAnalyticsData] = useState([
        { label: "Votes cast this week", value: "0", subtitle: null },
        { label: "Motions requiring your vote", value: "0", subtitle: "Still open for voting" },
        { label: "New comments", value: "0", subtitle: "On motions you're involved in" },
        { label: "Upcoming deadlines", value: "0", subtitle: null },
        { label: "Committees you're active in", value: "0", subtitle: null },
        { label: "Motions participated in (30 days)", value: "0", subtitle: "Voted or commented" }
    ]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchAnalytics() {
            try {
                setLoading(true);

                // Get current user
                const userResponse = await getCurrentUser();
                const user = userResponse?.user || userResponse;
                
                if (!user) {
                    setLoading(false);
                    return;
                }

                // Get all committees the user is a member of
                const committeeIds = [
                    ...(user.memberCommittees || []),
                    ...(user.chairedCommittees || []),
                    ...(user.ownedCommittees || [])
                ].map(id => typeof id === 'string' ? id : id.$oid || String(id));

                const uniqueCommitteeIds = [...new Set(committeeIds.filter(Boolean))];

                // Fetch all committees
                const committeesPromises = uniqueCommitteeIds.map(id => 
                    getCommitteeById(id).catch(() => null)
                );
                const committeesData = await Promise.all(committeesPromises);
                const committees = committeesData
                    .filter(Boolean)
                    .map(res => res?.committee || res);

                const userId = String(user.id || user._id);

                // Calculate analytics
                const now = new Date();
                const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

                let votesThisWeek = 0;
                let motionsNeedingVote = 0;
                let upcomingDeadlines = 0;
                let motionsParticipatedIn30Days = new Set();
                let newCommentsCount = 0;
                
                // Count only successfully fetched committees
                const validCommitteeCount = committees.length;

                // Process each committee
                for (const committee of committees) {
                    if (!committee?.motions) continue;

                    const committeeId = String(committee.committeeId || committee.id);
                    // console.log(`Processing committee ${committee.title} (${committeeId}), motions: ${committee.motions.length}`);

                    for (const motion of committee.motions) {
                        const motionId = String(motion.motionId || motion.id);
                        
                        // Fetch actual votes for this motion
                        let hasUserVoted = false;
                        let userVoteDate = null;
                        try {
                            const votesResponse = await getVotes(committeeId, motionId);
                            // console.log(`Votes for motion ${motion.title}:`, votesResponse);
                            
                            // Check if user has voted using the userVote field
                            if (votesResponse?.userVote) {
                                hasUserVoted = true;
                                userVoteDate = new Date(votesResponse.userVote.votedAt);
                                // console.log(`User voted on ${motion.title} at:`, userVoteDate);
                            }
                        } catch (error) {
                            // Silently skip if votes can't be fetched
                            // console.log(`Failed to fetch votes for motion ${motionId}:`, error.message);
                        }

                        // Check if user voted this week
                        if (hasUserVoted && userVoteDate && userVoteDate >= oneWeekAgo) {
                            votesThisWeek++;
                        }

                        // Check if motion needs user's vote (active, voting open, user hasn't voted)
                        if (motion.status === 'active' && (motion.votingStatus === 'open' || motion.votingStatus === 'pending')) {
                            if (!hasUserVoted) {
                                motionsNeedingVote++;

                                // Check if voting closes soon (within 24 hours)
                                if (motion.votingOpenedAt) {
                                    const openedAt = new Date(motion.votingOpenedAt);
                                    const votingPeriodDays = committee.settings?.votingPeriodDays || 7;
                                    const closesAt = new Date(openedAt.getTime() + votingPeriodDays * 24 * 60 * 60 * 1000);
                                    const hoursUntilClose = (closesAt - now) / (1000 * 60 * 60);
                                    
                                    // console.log(`Motion ${motion.title}: opens at ${openedAt}, closes at ${closesAt}, hours left: ${hoursUntilClose.toFixed(2)}`);
                                    
                                    if (hoursUntilClose > 0 && hoursUntilClose <= 24) {
                                        upcomingDeadlines++;
                                    }
                                }
                            }
                        }
                        // Check participation in last 30 days (voted or authored)
                        const motionDate = new Date(motion.createdAt);
                        if (motionDate >= thirtyDaysAgo) {
                            const isAuthor = String(motion.author) === userId;
                            
                            if (hasUserVoted || isAuthor) {
                                motionsParticipatedIn30Days.add(motionId);
                                
                                // Count new comments on motions user is involved in
                                try {
                                    const commentsResponse = await getCommentsByMotion(committeeId, motionId);
                                    if (commentsResponse?.comments) {
                                        // Count comments from the last 7 days that are not by the user and not system messages
                                        const newComments = commentsResponse.comments.filter(comment => {
                                            const commentDate = new Date(comment.createdAt);
                                            const isRecent = commentDate >= oneWeekAgo;
                                            const isNotUser = String(comment.author) !== userId;
                                            const isNotSystem = !comment.isSystemMessage;
                                            return isRecent && isNotUser && isNotSystem;
                                        });
                                        newCommentsCount += newComments.length;
                                    }
                                } catch (error) {
                                    // Silently skip if comments can't be fetched
                                }
                            }
                        }
                    }
                }

                // Update analytics data
                setAnalyticsData([
                    {
                        label: "Votes cast this week",
                        value: String(votesThisWeek),
                        subtitle: null
                    },
                    {
                        label: "Motions requiring your vote",
                        value: String(motionsNeedingVote),
                        subtitle: motionsNeedingVote > 0 ? "Still open for voting" : null
                    },
                    {
                        label: "New comments",
                        value: String(newCommentsCount),
                        subtitle: "On motions you're involved in"
                    },
                    {
                        label: "Upcoming deadlines",
                        value: String(upcomingDeadlines),
                        subtitle: upcomingDeadlines > 0 ? `${upcomingDeadlines} vote${upcomingDeadlines > 1 ? 's' : ''} closing soon` : null
                    },
                    {
                        label: "Committees you're active in",
                        value: String(validCommitteeCount),
                        subtitle: null
                    },
                    {
                        label: "Motions participated in (30 days)",
                        value: String(motionsParticipatedIn30Days.size),
                        subtitle: "Voted or authored"
                    }
                ]);

            } catch (error) {
                console.error('Error fetching analytics:', error);
            } finally {
                setLoading(false);
            }
        }

        fetchAnalytics();
    }, []);

    return (
        <div className="analytics-panel">
            <h2 className="analytics-title">Analytics</h2>
            {loading ? (
                <div className="p-8 text-center text-gray-500">
                    <p>Loading analytics...</p>
                </div>
            ) : (
                <div className="analytics-grid">
                    {analyticsData.map((stat, index) => (
                        <div key={index} className="analytics-stat-card">
                            <div className="analytics-stat-label">{stat.label}</div>
                            <div className="analytics-stat-value">{stat.value}</div>
                            {stat.subtitle && (
                                <div className="analytics-stat-subtitle">{stat.subtitle}</div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

