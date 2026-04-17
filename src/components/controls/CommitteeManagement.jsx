import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { getCommitteeById, updateCommittee, deleteCommittee, getCommitteeMembers, getPotentialMembers, addMember, removeMember } from "../../services/committeeApi"

function CommitteeManagement({ committeeId, committee: initialCommittee }) {
    const navigate = useNavigate();
    const [committee, setCommittee] = useState(initialCommittee);

    // Local state for committee settings
    const [title, setTitle] = useState(initialCommittee?.title || "");
    const [description, setDescription] = useState(initialCommittee?.description || "");
    const [members, setMembers] = useState([]);
    const [potentialMembers, setPotentialMembers] = useState([]);
    const [addRoleSelection, setAddRoleSelection] = useState({});
    const [memberSearch, setMemberSearch] = useState('');
    const [potentialSearch, setPotentialSearch] = useState('');
    const [membersLoading, setMembersLoading] = useState(true);

    // Helper: normalize and check various name fields for search
    function userMatchesSearch(u, search) {
        if (!search) return true;
        const s = (search || '').toLowerCase().trim();
        if (!s) return true;

        const candidates = [];
        if (u.name) candidates.push(u.name);
        if (u.settings && u.settings.displayName) candidates.push(u.settings.displayName);
        if (u.username) candidates.push(u.username);
        if (u.first_name || u.last_name) candidates.push(`${u.first_name || ''} ${u.last_name || ''}`.trim());

        for (const c of candidates) {
            if (!c) continue;
            if (String(c).toLowerCase().includes(s)) return true;
        }

        if (u.email && String(u.email).toLowerCase().includes(s)) return true;

        return false;
    }

    // Helper: determine if a member is a guest for this committee
    function memberIsGuest(member) {
        try {
            if (member.committeeRole) return member.committeeRole === 'guest';
            const gc = member.guestCommittees || member.guest || [];
            const cid = String((committee && (committee.committeeId || committee.id)) || committeeId);
            if (!Array.isArray(gc)) return false;
            return gc.map(String).includes(cid);
        } catch (e) {
            return false;
        }
    }

    // Fetch committee and members
    useEffect(() => {
        async function fetchData() {
            try {
                const data = await getCommitteeById(committeeId);
                const fetchedCommittee = data.committee || data;
                setCommittee(fetchedCommittee);
                setTitle(fetchedCommittee.title || "");
                setDescription(fetchedCommittee.description || "");
                fetchMembers(committeeId);
            } catch (err) {
                console.error('Error fetching committee:', err);
            }
        }

        if (committeeId) {
            fetchData();
        }
    }, [committeeId]);

    // Fetch members and potential members
    async function fetchMembers(cid) {
        try {
            setMembersLoading(true);
            const mRes = await getCommitteeMembers(cid);
            if (mRes.success) {
                setMembers(mRes.members || []);
            }
            const pRes = await getPotentialMembers(cid);
            if (pRes.success) {
                setPotentialMembers(pRes.users || []);
            }
        } catch (err) {
            console.error('Error fetching member lists:', err);
        } finally {
            setMembersLoading(false);
        }
    }

    const handleSave = async () => {
        try {
            const updates = { title, description };
            const result = await updateCommittee(committeeId, updates);
            alert("Settings saved successfully!");
            setCommittee(result.committee || result);
        } catch (error) {
            console.error('Error saving settings:', error);
            alert(`Failed to save settings: ${error.message}`);
        }
    };

    const handleDelete = async () => {
        if (!confirm(`Are you sure you want to delete "${committee.title}"? This action cannot be undone. All motions and history will be permanently deleted.`)) {
            return;
        }

        try {
            await deleteCommittee(committeeId);
            alert("Committee deleted successfully");
            navigate('/committees');
        } catch (error) {
            console.error('Error deleting committee:', error);
            alert(`Failed to delete committee: ${error.message}`);
        }
    };

    return (
        <div className="space-y-6">
            {/* Committee Title */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Committee Title
                </label>
                <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-darker-green focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="Enter committee title"
                />
            </div>

            {/* Committee Description */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Description
                </label>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-darker-green focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white"
                    placeholder="Enter committee description"
                />
            </div>

            {/* Members Section */}
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Members
                </label>
                <div className="border border-gray-300 rounded-lg p-4 dark:bg-gray-700 dark:border-gray-600">
                    <div className="mb-3 flex flex-col sm:flex-row sm:items-center gap-3">
                        <p className="text-gray-600 dark:text-gray-400">{members.length} members</p>
                        <input
                            type="text"
                            placeholder="Search members"
                            value={memberSearch}
                            onChange={(e) => setMemberSearch(e.target.value)}
                            className="sm:ml-auto px-3 py-2 border rounded bg-white dark:bg-gray-600 text-sm w-full sm:w-auto"
                        />
                    </div>

                    {membersLoading ? (
                        <p className="text-gray-500">Loading members...</p>
                    ) : (
                        <div className="space-y-2">
                            {members.filter(m => userMatchesSearch(m, memberSearch)).map(member => {
                                const memberId = member.userId || member.id;
                                const isChair = committee.chair && memberId === committee.chair;
                                const isOwner = committee.owner && memberId === committee.owner;
                                const isGuest = memberIsGuest(member);
                                const currentRole = isChair ? 'chair' : (isGuest ? 'guest' : 'member');
                                
                                return (
                                <div key={memberId} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white dark:bg-gray-600 rounded">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-gray-800 dark:text-gray-200 truncate">
                                            {member.name}
                                            {isChair && <span className="ml-2 inline-block bg-yellow-100 text-yellow-800 text-xs px-2 py-0.5 rounded">Chair</span>}
                                            {isOwner && <span className="ml-2 inline-block bg-blue-100 text-blue-800 text-xs px-2 py-0.5 rounded">Owner</span>}
                                            {isGuest && <span className="ml-2 inline-block bg-gray-100 dark:bg-gray-500 text-gray-800 dark:text-gray-200 text-xs px-2 py-0.5 rounded">Guest</span>}
                                        </div>
                                        <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{member.email}</div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                        <select
                                            value={currentRole}
                                            onChange={async (e) => {
                                                const newRole = e.target.value;
                                                if (newRole === currentRole) return;
                                                
                                                let confirmMsg = `Change ${member.name}'s role to ${newRole}?`;
                                                if (newRole === 'chair' && committee.chair) {
                                                    confirmMsg = `Promote ${member.name} to Chair? This will demote the current chair to member.`;
                                                }
                                                
                                                if (!confirm(confirmMsg)) {
                                                    e.target.value = currentRole;
                                                    return;
                                                }
                                                
                                                try {
                                                    await addMember(committeeId, memberId, newRole);
                                                    const refreshed = await getCommitteeById(committeeId);
                                                    setCommittee(refreshed.committee || refreshed);
                                                    fetchMembers(committeeId);
                                                } catch (err) {
                                                    console.error('Error changing role:', err);
                                                    alert('Failed to change role');
                                                    e.target.value = currentRole;
                                                }
                                            }}
                                            className="px-2 py-1 border border-gray-300 dark:border-gray-500 rounded text-sm bg-white dark:bg-gray-600"
                                        >
                                            <option value="member">Member</option>
                                            <option value="guest">Guest</option>
                                            <option value="chair">Chair</option>
                                        </select>

                                        <button
                                            onClick={async () => {
                                                if (!confirm(`Remove ${member.name} from ${committee.title}?`)) return;
                                                try {
                                                    await removeMember(committeeId, memberId);
                                                    fetchMembers(committeeId);
                                                } catch (err) {
                                                    console.error('Error removing member:', err);
                                                    alert('Failed to remove member');
                                                }
                                            }}
                                            className="px-3 py-1 bg-red-600 text-white rounded text-sm"
                                        >
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            )})}
                        </div>
                    )}

                    <div className="mt-4">
                        <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Add Members</h4>
                        <input
                            type="text"
                            placeholder="Search users to add"
                            value={potentialSearch}
                            onChange={(e) => setPotentialSearch(e.target.value)}
                            className="w-full px-2 py-1 mb-3 border rounded bg-white dark:bg-gray-600 text-sm"
                        />

                        <div className="space-y-2 max-h-48 overflow-auto">
                            {potentialMembers.filter(u => userMatchesSearch(u, potentialSearch)).map(user => {
                                const userId = user.userId || user.id;
                                const selectedRole = addRoleSelection[userId] || 'member';
                                return (
                                    <div key={userId} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-600 rounded">
                                        <div>
                                            <div className="font-semibold text-sm text-gray-800 dark:text-gray-200">{user.name}</div>
                                            <div className="text-xs text-gray-500 dark:text-gray-400">{user.email}</div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <select
                                                value={selectedRole}
                                                onChange={(e) => setAddRoleSelection({ ...addRoleSelection, [userId]: e.target.value })}
                                                className="px-2 py-1 border rounded text-sm bg-white dark:bg-gray-500"
                                            >
                                                <option value="member">Member</option>
                                                <option value="guest">Guest</option>
                                                <option value="chair">Chair</option>
                                            </select>
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await addMember(committeeId, userId, selectedRole);
                                                        fetchMembers(committeeId);
                                                    } catch (err) {
                                                        console.error('Error adding member:', err);
                                                        alert('Failed to add member');
                                                    }
                                                }}
                                                className="px-3 py-1 bg-darker-green text-white rounded text-sm"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4">
                <button
                    onClick={handleSave}
                    className="px-6 py-2 bg-darker-green text-white rounded-lg hover:bg-opacity-90 transition-all font-medium"
                >
                    Save Changes
                </button>

                <button
                    onClick={handleDelete}
                    className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-all font-medium"
                >
                    Delete Committee
                </button>
            </div>
        </div>
    );
}

export default CommitteeManagement;
