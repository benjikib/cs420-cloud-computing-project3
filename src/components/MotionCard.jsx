import { useNavigate, useLocation } from "react-router-dom"

function MotionCard({ motion, committeeSlug }) {
    const navigate = useNavigate()
    const location = useLocation()

    const handleClick = () => {
        // Use the API-compliant route structure with slug if available
        const committeeIdentifier = committeeSlug || motion.committeeId;
        navigate(`/committee/${committeeIdentifier}/motion/${motion.motionId || motion.id}`, { state: { background: location } })
    }

    // Determine status badge styling
    const getStatusBadge = () => {
        if (motion.status === 'passed') {
            return (
                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                    ✓ Passed
                </span>
            );
        } else if (motion.status === 'failed') {
            return (
                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
                    ✗ Failed
                </span>
            );
        } else if (motion.status === 'voided') {
            return (
                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">
                    Voided
                </span>
            );
        }
        return null;
    };

    return (
        <div className="motion-card" onClick={handleClick}>
            <div className="motion-header">
                <div className="flex items-center justify-between">
                    <h3 className="motion-title font-bold">{motion.title}</h3>
                    {getStatusBadge()}
                </div>
            </div>
            <p className="motion-description">{motion.description}</p>
            {/* Subsidiaries intentionally not displayed on the motion cards - keep logic available in parent components or modal */}
            <div className="motion-footer">
                <div className="flex items-center justify-between w-full">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                        Votes: {(motion.votes?.yes || 0) + (motion.votes?.no || 0) + (motion.votes?.abstain || 0)}
                    </span>
                    <div className="flex items-center gap-2">
                        {motion.isAnonymous ? (
                            <>
                                <span className="material-symbols-outlined text-gray-500 dark:text-gray-400 text-xl">visibility_off</span>
                                <span className="text-sm text-gray-600 dark:text-gray-400 italic">Anonymous</span>
                            </>
                        ) : (motion.authorName || motion.authorInfo) ? (
                            <>
                                {motion.authorInfo?.picture ? (
                                    <img
                                        src={motion.authorInfo.picture}
                                        alt={motion.authorName || motion.authorInfo.name}
                                        className="w-6 h-6 rounded-full"
                                    />
                                ) : (
                                    <span className="material-symbols-outlined text-gray-500 dark:text-gray-400 text-xl">account_circle</span>
                                )}
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                    {motion.authorName || motion.authorInfo?.name || 'Unknown'}
                                </span>
                            </>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    )
}

export default MotionCard