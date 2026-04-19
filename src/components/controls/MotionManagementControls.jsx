import { useState, useEffect } from 'react';
import { getMotionsByCommittee, updateMotion } from '../../services/motionApi';

function MotionManagementControls({ settings, updateSetting, committeeId }) {
    const [activeMotions, setActiveMotions] = useState([]);
    const [allMotions, setAllMotions] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [editingMotion, setEditingMotion] = useState(null);
    const [editForm, setEditForm] = useState({ title: '', description: '', fullDescription: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [showAllMotions, setShowAllMotions] = useState(false);

    useEffect(() => {
        fetchMotions();
    }, [committeeId]);

    const fetchMotions = async () => {
        if (!committeeId) return;
        try {
            setIsLoading(true);
            const response = await getMotionsByCommittee(committeeId, 1, {});
            const motions = response.motions || [];
            setAllMotions(motions);
            setActiveMotions(motions.filter(m => m.status === 'active' || !m.status));
        } catch (err) {
            console.error('Failed to fetch motions:', err);
            setActiveMotions([]);
            setAllMotions([]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleEditMotion = (motion) => {
        setEditingMotion(motion);
        setEditForm({
            title: motion.title || '',
            description: motion.description || '',
            fullDescription: motion.fullDescription || motion.description || ''
        });
    };

    const handleSaveEdit = async () => {
        if (!editingMotion) return;
        try {
            setIsSaving(true);
            await updateMotion(committeeId, editingMotion.motionId || editingMotion.id, editForm);
            await fetchMotions();
            setEditingMotion(null);
            alert('Motion updated successfully!');
        } catch (err) {
            console.error('Failed to update motion:', err);
            alert('Failed to update motion: ' + (err.message || 'Unknown error'));
        } finally {
            setIsSaving(false);
        }
    };

    const handleVoidMotion = async (motion) => {
        if (!confirm(`Are you sure you want to void "${motion.title}"? This will mark it as failed and move it to the voided section.`)) {
            return;
        }
        try {
            await updateMotion(committeeId, motion.motionId || motion.id, {
                status: 'voided',
                votingStatus: 'closed',
                votingClosedAt: new Date().toISOString()
            });
            await fetchMotions();
            alert('Motion voided successfully');
        } catch (err) {
            console.error('Failed to void motion:', err);
            alert('Failed to void motion: ' + (err.message || 'Unknown error'));
        }
    };

    const displayMotions = showAllMotions ? allMotions : activeMotions;

    return (
        <div className="space-y-6">
            <div>
                <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-2">
                    <span className="material-symbols-outlined">gavel</span>
                    Motion Management & Controls
                </h4>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                    Override motion status and manage procedural controls
                </p>
            </div>

            {/* Motion Settings */}
            <div className="flex items-start justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex-1">
                    <h5 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">
                        Allow Multiple Active Motions
                    </h5>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Multiple motions can be in discussion/voting simultaneously (strict Robert's Rules: one at a time)
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                    <input
                        type="checkbox"
                        checked={settings.allowMultipleActiveMotions}
                        onChange={(e) => updateSetting('allowMultipleActiveMotions', e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-darker-green"></div>
                </label>
            </div>

            <div className="flex items-start justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex-1">
                    <h5 className="font-semibold text-gray-800 dark:text-gray-200 mb-1">
                        Allow Anonymous Motions
                    </h5>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                        Members can submit motions without their name being displayed
                    </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer ml-4">
                    <input
                        type="checkbox"
                        checked={settings.allowAnonymousMotions}
                        onChange={(e) => updateSetting('allowAnonymousMotions', e.target.checked)}
                        className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-green-300 dark:peer-focus:ring-green-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-darker-green"></div>
                </label>
            </div>

            {/* Motion List Controls */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h5 className="font-semibold text-gray-800 dark:text-gray-200">
                        Motion Controls
                    </h5>
                    <button
                        onClick={() => setShowAllMotions(!showAllMotions)}
                        className="text-sm px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                    >
                        {showAllMotions ? 'Show Active Only' : 'Show All Motions'}
                    </button>
                </div>

                {isLoading ? (
                    <div className="text-center py-8 text-gray-500">
                        <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
                        <p className="mt-2">Loading motions...</p>
                    </div>
                ) : displayMotions.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <span className="material-symbols-outlined text-5xl mb-2">inbox</span>
                        <p>No {showAllMotions ? '' : 'active '}motions found</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {displayMotions.map((motion) => (
                            <div 
                                key={motion.motionId || motion.id}
                                className="p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h6 className="font-semibold text-gray-800 dark:text-gray-200">
                                                {motion.title}
                                            </h6>
                                            {motion.status && (
                                                <span className={`text-xs px-2 py-0.5 rounded ${
                                                    motion.status === 'passed' ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' :
                                                    motion.status === 'failed' ? 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300' :
                                                    motion.status === 'voided' ? 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300' :
                                                    'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                                                }`}>
                                                    {motion.status}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-2">
                                            {motion.description}
                                        </p>
                                    </div>
                                </div>
                                
                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => handleEditMotion(motion)}
                                        className="flex-1 px-3 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center justify-center gap-1"
                                    >
                                        <span className="material-symbols-outlined text-sm">edit</span>
                                        Edit
                                    </button>
                                    <button 
                                        onClick={() => handleVoidMotion(motion)}
                                        disabled={motion.status === 'voided'}
                                        className="flex-1 px-3 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <span className="material-symbols-outlined text-sm">block</span>
                                        Void
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Edit Motion Modal */}
            {editingMotion && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">
                                    Edit Motion
                                </h3>
                                <button
                                    onClick={() => setEditingMotion(null)}
                                    className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                                >
                                    <span className="material-symbols-outlined">close</span>
                                </button>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Title
                                    </label>
                                    <input
                                        type="text"
                                        value={editForm.title}
                                        onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                                        placeholder="Motion title"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Short Description
                                    </label>
                                    <textarea
                                        value={editForm.description}
                                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                                        rows="3"
                                        placeholder="Brief description"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                                        Full Description
                                    </label>
                                    <textarea
                                        value={editForm.fullDescription}
                                        onChange={(e) => setEditForm({ ...editForm, fullDescription: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200"
                                        rows="6"
                                        placeholder="Detailed description"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => setEditingMotion(null)}
                                    className="flex-1 px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    disabled={isSaving || !editForm.title.trim()}
                                    className="flex-1 px-4 py-2 bg-darker-green text-white rounded-lg hover:bg-opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <span className="material-symbols-outlined animate-spin">progress_activity</span>
                                            Saving...
                                        </>
                                    ) : (
                                        <>
                                            <span className="material-symbols-outlined">save</span>
                                            Save Changes
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MotionManagementControls;
