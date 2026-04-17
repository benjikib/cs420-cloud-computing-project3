import { useState, useEffect } from 'react';
import { getMotionsByCommittee } from '../../services/motionApi';
import { getCommentsByMotion } from '../../services/commentApi';

function CommitteeHistory({ committeeId, committee }) {
    const [motions, setMotions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedMotion, setSelectedMotion] = useState(null);
    const [motionComments, setMotionComments] = useState([]);
    const [loadingComments, setLoadingComments] = useState(false);

    useEffect(() => {
        async function fetchMotions() {
            if (!committeeId) return;
            try {
                setLoading(true);
                // Fetch all motions (including past/archived) for history view
                const response = await getMotionsByCommittee(committeeId, 1, 100, { 
                    includeSubsidiaries: true 
                });
                const allMotions = response.motions || [];
                
                // Sort by date (newest first)
                const sorted = allMotions.sort((a, b) => 
                    new Date(b.createdAt) - new Date(a.createdAt)
                );
                
                setMotions(sorted);
            } catch (err) {
                console.error('Error loading motions for history:', err);
            } finally {
                setLoading(false);
            }
        }
        
        fetchMotions();
    }, [committeeId]);

    const handleSelectMotion = async (motion) => {
        setSelectedMotion(motion);
        setLoadingComments(true);
        try {
            const response = await getCommentsByMotion(committeeId, motion.motionId || motion.id);
            setMotionComments(response.comments || []);
        } catch (err) {
            console.error('Error loading comments:', err);
            setMotionComments([]);
        } finally {
            setLoadingComments(false);
        }
    };

    const getMotionResult = (motion) => {
        const { votes } = motion;
        const total = votes.yes + votes.no + votes.abstain;
        if (total === 0) return 'No votes cast';
        
        const yesPercent = ((votes.yes / total) * 100).toFixed(1);
        
        if (votes.yes > votes.no) {
            return `Passed (${yesPercent}% yes)`;
        } else if (votes.yes < votes.no) {
            return `Failed (${yesPercent}% yes)`;
        } else {
            return `Tied (${yesPercent}% yes)`;
        }
    };

    const calculateMeetingMinutes = (motion) => {
        if (!motion.createdAt) return null;
        
        // Use votingClosedAt if available (when motion passed/failed), otherwise use current time
        const endTime = motion.votingClosedAt ? new Date(motion.votingClosedAt) : new Date();
        const startTime = new Date(motion.createdAt);
        
        const diffMs = endTime - startTime;
        const diffMinutes = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMinutes / 60);
        const remainingMinutes = diffMinutes % 60;
        
        return {
            totalMinutes: diffMinutes,
            hours: diffHours,
            minutes: remainingMinutes,
            formatted: diffHours > 0 
                ? `${diffHours}h ${remainingMinutes}m` 
                : `${diffMinutes}m`
        };
    };

    const downloadMotionDocument = () => {
        if (!selectedMotion) return;

        // Build document content
        let content = '';
        
        // Header
        content += `${committee.title}\n`;
        content += `Motion Record\n`;
        content += `${'='.repeat(60)}\n\n`;
        
        // Motion Details
        content += `Title: ${selectedMotion.title}\n`;
        content += `Status: ${selectedMotion.status || 'active'}\n`;
        content += `Date Created: ${new Date(selectedMotion.createdAt).toLocaleString()}\n`;
        
        // Add voting closed time and meeting duration
        if (selectedMotion.votingClosedAt) {
            content += `Voting Closed: ${new Date(selectedMotion.votingClosedAt).toLocaleString()}\n`;
        }
        
        const meetingTime = calculateMeetingMinutes(selectedMotion);
        if (meetingTime) {
            content += `Total Meeting Time: ${meetingTime.formatted} (${meetingTime.totalMinutes} minutes)\n`;
        }
        
        content += `Author: ${selectedMotion.authorName || 'Unknown'}\n\n`;
        
        content += `Description:\n${selectedMotion.description}\n\n`;
        
        if (selectedMotion.fullDescription && selectedMotion.fullDescription !== selectedMotion.description) {
            content += `Full Description:\n${selectedMotion.fullDescription}\n\n`;
        }
        
        // Vote Results
        content += `${'='.repeat(60)}\n`;
        content += `VOTE RESULTS\n`;
        content += `${'='.repeat(60)}\n\n`;
        content += `Yes: ${selectedMotion.votes.yes}\n`;
        content += `No: ${selectedMotion.votes.no}\n`;
        content += `Abstain: ${selectedMotion.votes.abstain}\n`;
        content += `Total: ${selectedMotion.votes.yes + selectedMotion.votes.no + selectedMotion.votes.abstain}\n`;
        content += `Result: ${getMotionResult(selectedMotion)}\n\n`;
        
        // Subsidiary Motions
        if (selectedMotion.subsidiaries && selectedMotion.subsidiaries.length > 0) {
            content += `${'='.repeat(60)}\n`;
            content += `SUBSIDIARY MOTIONS\n`;
            content += `${'='.repeat(60)}\n\n`;
            selectedMotion.subsidiaries.forEach((sub, index) => {
                content += `${index + 1}. ${sub.title}\n`;
                content += `   Description: ${sub.description}\n`;
                content += `   Votes - Yes: ${sub.votes.yes}, No: ${sub.votes.no}, Abstain: ${sub.votes.abstain}\n\n`;
            });
        }
        
        // Discussion Transcript
        if (motionComments.length > 0) {
            content += `${'='.repeat(60)}\n`;
            content += `DISCUSSION TRANSCRIPT\n`;
            content += `${'='.repeat(60)}\n\n`;
            motionComments.forEach((comment, index) => {
                const date = new Date(comment.createdAt).toLocaleString();
                const stance = comment.stance && comment.stance !== 'neutral' ? ` [${comment.stance.toUpperCase()}]` : '';
                content += `[${date}] ${comment.authorName || 'Unknown'}${stance}:\n`;
                content += `${comment.content}\n\n`;
            });
        }
        
        // Footer
        content += `${'='.repeat(60)}\n`;
        content += `Document generated on ${new Date().toLocaleString()}\n`;
        
        // Create and download file
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        const filename = `${selectedMotion.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${selectedMotion._id.slice(-6)}.txt`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6">
            <div>
                <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined">history</span>
                    Committee History
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    View complete motion history with vote totals and discussion transcripts
                </p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <span className="material-symbols-outlined text-4xl text-gray-300 dark:text-gray-700 animate-spin">
                        progress_activity
                    </span>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Motion List */}
                    <div className="space-y-3">
                        <h5 className="font-semibold text-gray-800 dark:text-gray-200 mb-3">
                            All Motions ({motions.length})
                        </h5>
                        <div className="space-y-2 max-h-[600px] overflow-y-auto">
                            {motions.length === 0 ? (
                                <div className="p-6 text-center text-gray-500 dark:text-gray-500 bg-gray-50 dark:bg-gray-900 rounded-lg">
                                    No motions found
                                </div>
                            ) : (
                                motions.map((motion) => (
                                    <div
                                        key={motion.motionId || motion.id}
                                        onClick={() => handleSelectMotion(motion)}
                                        className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                                            selectedMotion?.motionId === motion.motionId
                                                ? 'border-darker-green bg-superlight-green/10 dark:bg-darker-green/10'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between mb-2">
                                            <h6 className="font-semibold text-gray-800 dark:text-gray-200 text-sm line-clamp-2">
                                                {motion.title}
                                            </h6>
                                            <span className={`text-xs px-2 py-1 rounded ml-2 whitespace-nowrap ${
                                                motion.status === 'active' 
                                                    ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                                            }`}>
                                                {motion.status || 'active'}
                                            </span>
                                        </div>
                                        
                                        <div className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-xs">calendar_today</span>
                                                {new Date(motion.createdAt).toLocaleDateString()}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="material-symbols-outlined text-xs">how_to_vote</span>
                                                {motion.votes.yes} Yes · {motion.votes.no} No · {motion.votes.abstain} Abstain
                                            </div>
                                            {motion.subsidiaries && motion.subsidiaries.length > 0 && (
                                                <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400">
                                                    <span className="material-symbols-outlined text-xs">account_tree</span>
                                                    {motion.subsidiaries.length} subsidiary motion{motion.subsidiaries.length > 1 ? 's' : ''}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* Motion Details */}
                    <div>
                        {selectedMotion ? (
                            <div className="space-y-4">
                                {/* Download Button */}
                                <div className="flex items-center justify-between">
                                    <h5 className="font-semibold text-gray-800 dark:text-gray-200">
                                        Motion Details
                                    </h5>
                                    <button
                                        onClick={downloadMotionDocument}
                                        className="px-4 py-2 bg-darker-green text-white rounded-lg hover:bg-opacity-90 transition-all font-medium flex items-center gap-2"
                                    >
                                        <span className="material-symbols-outlined text-lg">
                                            download
                                        </span>
                                        Download
                                    </button>
                                </div>
                                
                                <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 max-h-[600px] overflow-y-auto space-y-4">
                                <div>
                                    <h5 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">
                                        {selectedMotion.title}
                                    </h5>
                                    <p className="text-sm text-gray-600 dark:text-gray-400">
                                        {selectedMotion.description}
                                    </p>
                                    
                                    {/* Meeting Duration */}
                                    {(() => {
                                        const meetingTime = calculateMeetingMinutes(selectedMotion);
                                        return meetingTime && (
                                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                                                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                                                    <span className="material-symbols-outlined text-lg">schedule</span>
                                                    <span className="font-medium">Total Meeting Time:</span>
                                                    <span className="font-semibold text-gray-800 dark:text-gray-200">
                                                        {meetingTime.formatted}
                                                    </span>
                                                    <span className="text-xs">
                                                        ({meetingTime.totalMinutes} minutes)
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500 mt-2 ml-7">
                                                    <span>Created: {new Date(selectedMotion.createdAt).toLocaleString()}</span>
                                                    {selectedMotion.votingClosedAt && (
                                                        <span>Closed: {new Date(selectedMotion.votingClosedAt).toLocaleString()}</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Vote Summary */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                    <h6 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">poll</span>
                                        Vote Results
                                    </h6>
                                    <div className="space-y-2">
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-700 dark:text-gray-300">Yes</span>
                                            <span className="font-semibold text-green-600 dark:text-green-400">
                                                {selectedMotion.votes.yes}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-700 dark:text-gray-300">No</span>
                                            <span className="font-semibold text-red-600 dark:text-red-400">
                                                {selectedMotion.votes.no}
                                            </span>
                                        </div>
                                        <div className="flex items-center justify-between text-sm">
                                            <span className="text-gray-700 dark:text-gray-300">Abstain</span>
                                            <span className="font-semibold text-gray-600 dark:text-gray-400">
                                                {selectedMotion.votes.abstain}
                                            </span>
                                        </div>
                                        <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
                                            <div className="flex items-center justify-between text-sm font-semibold">
                                                <span className="text-gray-800 dark:text-gray-200">Result</span>
                                                <span className={`${
                                                    getMotionResult(selectedMotion).startsWith('Passed')
                                                        ? 'text-green-600 dark:text-green-400'
                                                        : getMotionResult(selectedMotion).startsWith('Failed')
                                                        ? 'text-red-600 dark:text-red-400'
                                                        : 'text-gray-600 dark:text-gray-400'
                                                }`}>
                                                    {getMotionResult(selectedMotion)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Subsidiary Motions */}
                                {selectedMotion.subsidiaries && selectedMotion.subsidiaries.length > 0 && (
                                    <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                        <h6 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                                            <span className="material-symbols-outlined text-sm">account_tree</span>
                                            Subsidiary Motions
                                        </h6>
                                        <div className="space-y-2">
                                            {selectedMotion.subsidiaries.map((sub) => (
                                                <div key={sub._id} className="p-2 bg-gray-50 dark:bg-gray-900 rounded text-sm">
                                                    <div className="font-medium text-gray-800 dark:text-gray-200">
                                                        {sub.title}
                                                    </div>
                                                    <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                                                        Yes: {sub.votes.yes} · No: {sub.votes.no} · Abstain: {sub.votes.abstain}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Discussion Transcript */}
                                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                                    <h6 className="font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center gap-2">
                                        <span className="material-symbols-outlined text-sm">chat</span>
                                        Discussion Transcript
                                    </h6>
                                    {loadingComments ? (
                                        <div className="text-center text-gray-500 dark:text-gray-500 py-4">
                                            Loading comments...
                                        </div>
                                    ) : motionComments.length === 0 ? (
                                        <div className="text-center text-gray-500 dark:text-gray-500 py-4">
                                            No comments
                                        </div>
                                    ) : (
                                        <div className="space-y-3 max-h-[300px] overflow-y-auto">
                                            {motionComments.map((comment) => (
                                                <div key={comment.commentId || comment.id} className="p-3 bg-gray-50 dark:bg-gray-900 rounded">
                                                    <div className="flex items-start justify-between mb-1">
                                                        <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                                                            {comment.authorName || 'Unknown'}
                                                        </span>
                                                        <span className="text-xs text-gray-500 dark:text-gray-500">
                                                            {new Date(comment.createdAt).toLocaleDateString()}
                                                        </span>
                                                    </div>
                                                    {comment.stance && comment.stance !== 'neutral' && (
                                                        <span className={`text-xs px-2 py-0.5 rounded ${
                                                            comment.stance === 'pro' 
                                                                ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300'
                                                                : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                                                        }`}>
                                                            {comment.stance}
                                                        </span>
                                                    )}
                                                    <p className="text-sm text-gray-700 dark:text-gray-300 mt-2">
                                                        {comment.content}
                                                    </p>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                            </div>
                        ) : (
                            <div className="flex items-center justify-center h-[600px] bg-gray-50 dark:bg-gray-900 rounded-lg">
                                <div className="text-center text-gray-500 dark:text-gray-500">
                                    <span className="material-symbols-outlined text-6xl mb-2">history</span>
                                    <p>Select a motion to view details</p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export default CommitteeHistory;
