import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser } from '../services/userApi';
import { getCommitteeById } from '../services/committeeApi';

export default function ActiveMotionsPanel() {
    const navigate = useNavigate();
    const [activeMotions, setActiveMotions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchActiveMotions() {
            try {
                setLoading(true);
                
                // Get current user
                const userResponse = await getCurrentUser();
                const user = userResponse?.user || userResponse;
                
                // console.log('User data:', user);
                // console.log('User keys:', Object.keys(user));
                
                if (!user) {
                    setActiveMotions([]);
                    return;
                }

                // Get all committees the user is a member of (handle different field names)
                const committeeIds = [
                    ...(user.memberCommittees || []),
                    ...(user.chairedCommittees || []),
                    ...(user.ownedCommittees || []),
                    ...(user.committees || []),
                ].map(id => {
                    if (typeof id === 'string') return id;
                    if (id && id.$oid) return id.$oid;
                    if (id && id._id) return String(id._id);
                    return String(id);
                });

                // Remove duplicates and empty values
                const uniqueCommitteeIds = [...new Set(committeeIds.filter(Boolean))];
                
                // console.log('Committee IDs to fetch:', uniqueCommitteeIds);
                
                // If no committees found in user object, fetch all committees and filter
                if (uniqueCommitteeIds.length === 0) {
                    // console.log('No committees in user object, will need to fetch from committees API');
                    // We'll need to get committees differently
                    setActiveMotions([]);
                    setLoading(false);
                    return;
                }

                // Fetch each committee and extract active motions
                const motionsPromises = uniqueCommitteeIds.map(async (committeeId) => {
                    try {
                        const response = await getCommitteeById(committeeId);
                        const committee = response?.committee || response;
                        
                        // console.log(`Committee ${committeeId}:`, committee);
                        
                        if (!committee || !committee.motions) {
                            // console.log(`No motions found for committee ${committeeId}`);
                            return [];
                        }

                        // console.log(`Motions in ${committee.title}:`, committee.motions);

                        // Filter for active motions only
                        const activeMotionsInCommittee = committee.motions.filter(motion => motion.status === 'active');
                        // console.log(`Active motions in ${committee.title}:`, activeMotionsInCommittee);
                        
                        return activeMotionsInCommittee.map(motion => ({
                                id: motion.motionId || motion.id,
                                title: motion.title,
                                committeeName: committee.title,
                                committeeSlug: committee.slug || committee.committeeId,
                                status: motion.votingStatus === 'open' || motion.votingStatus === 'pending' ? 'Voting Open' : 
                                       motion.votingStatus === 'closed' ? 'Voting Closed' : 
                                       'In Discussion',
                                metadata: getMotionMetadata(motion),
                                motion: motion
                            }));
                    } catch (error) {
                        console.error(`Error fetching committee ${committeeId}:`, error);
                        return [];
                    }
                });

                const allMotionsArrays = await Promise.all(motionsPromises);
                const allMotions = allMotionsArrays.flat();
                
                // console.log('All active motions found:', allMotions);
                
                // Sort by most recent first
                allMotions.sort((a, b) => {
                    const dateA = new Date(a.motion.updatedAt || a.motion.createdAt);
                    const dateB = new Date(b.motion.updatedAt || b.motion.createdAt);
                    return dateB - dateA;
                });

                setActiveMotions(allMotions);
            } catch (error) {
                console.error('Error fetching active motions:', error);
                setActiveMotions([]);
            } finally {
                setLoading(false);
            }
        }

        fetchActiveMotions();
    }, []);

    function getMotionMetadata(motion) {
        if (motion.votingStatus === 'open' && motion.votingOpenedAt) {
            const openedAt = new Date(motion.votingOpenedAt);
            const now = new Date();
            const hoursOpen = Math.floor((now - openedAt) / (1000 * 60 * 60));
            return `Voting opened ${hoursOpen > 24 ? Math.floor(hoursOpen / 24) + ' days' : hoursOpen + ' hours'} ago`;
        }
        
        if (motion.updatedAt) {
            const updated = new Date(motion.updatedAt);
            const now = new Date();
            const daysAgo = Math.floor((now - updated) / (1000 * 60 * 60 * 24));
            return `Updated ${daysAgo === 0 ? 'today' : daysAgo === 1 ? '1 day ago' : daysAgo + ' days ago'}`;
        }
        
        return 'Active';
    }

    function handleViewMotion(motion) {
        navigate(`/committee/${motion.committeeSlug}/motion/${motion.id}`);
    }

    const hasMotions = activeMotions.length > 0;

    return (
        <div className="active-motions-panel">
            <h2 className="active-motions-title">Your Active Motions</h2>
            {loading ? (
                <div className="active-motions-loading">
                    <p>Loading motions...</p>
                </div>
            ) : hasMotions ? (
                <div className="active-motions-list">
                    {activeMotions.map((motion) => (
                        <div key={`${motion.committeeSlug}-${motion.id}`} className="active-motion-card">
                            <div className="active-motion-content">
                                <div className="active-motion-header">
                                    <h3 className="active-motion-title">{motion.title}</h3>
                                    <span className={`active-motion-status-badge status-${motion.status.toLowerCase().replace(' ', '-')}`}>
                                        {motion.status}
                                    </span>
                                </div>
                                <div className="active-motion-committee">{motion.committeeName}</div>
                                <div className="active-motion-metadata">{motion.metadata}</div>
                            </div>
                            <div className="active-motion-actions">
                                <button 
                                    className="active-motion-button"
                                    onClick={() => handleViewMotion(motion)}
                                >
                                    View / Vote
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="active-motions-empty">
                    <p>You have no active motions right now.</p>
                </div>
            )}
        </div>
    );
}

