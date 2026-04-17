import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import SideBar from './reusable/SideBar'
import HeaderNav from './reusable/HeaderNav'
import { getCommittees } from "../services/committeeApi"
import { getCurrentUser, isAdmin } from '../services/userApi';

function CommitteesPage() {
    const navigate = useNavigate();
    const [committees, setCommittees] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [searchedTerm, setSearchedTerm] = useState("")

    // Fetch committees from API when component mounts
    useEffect(() => {
        async function fetchCommittees() {
            try {
                setLoading(true)
                setError(null)
                // Try to get current user to filter visible committees
                let user = null
                try {
                    const current = await getCurrentUser()
                    user = current && current.user ? current.user : null
                    if (!user) {
                        navigate('/login');
                        return;
                    }
                } catch (e) {
                    // Not logged in or error fetching user
                    navigate('/login');
                    return;
                }

                const data = await getCommittees(1)
                const all = data.committees || []

                // If user is admin (super-admin or org-admin), show all. Otherwise, only show committees where the user is a member/owner/chair.
                const isSuperAdmin = user?.roles?.includes('super-admin');
                const isOrgAdmin = user?.organizationRole === 'admin';
                
                if (user && (isSuperAdmin || isOrgAdmin)) {
                    setCommittees(all)
                } else if (user) {
                    const uid = String(user.id || user._id || user._id)
                    const visible = all.filter(c => {
                        // committee.members may be an array of primitive ids or objects with userId/_id.
                        if (Array.isArray(c.members) && c.members.length > 0) {
                            const memberMatch = c.members.some(m => {
                                if (!m) return false;
                                if (typeof m === 'string' || typeof m === 'number') return String(m) === uid;
                                // object: may be { userId } or {_id} or {id}
                                const memberId = m.userId || m._id || m.id || m;
                                return String(memberId) === uid;
                            });
                            if (memberMatch) return true;
                        }
                        // check chair/owner fields
                        if (String(c.chair || '') === uid) return true
                        if (String(c.owner || '') === uid) return true

                        // Fallback: for legacy committees that may not have migrated members array, check user's arrays
                        if (Array.isArray(user.memberCommittees) && user.memberCommittees.map(String).includes(String(c._id || c.id))) return true;
                        if (Array.isArray(user.guestCommittees) && user.guestCommittees.map(String).includes(String(c._id || c.id))) return true;
                        return false
                    })
                    setCommittees(visible)
                } else {
                    // Not signed in — show no committees (privacy)
                    setCommittees([])
                }
            } catch (err) {
                console.error('Error fetching committees:', err)
                setError(err.message || 'Failed to load committees')
                setCommittees([])
            } finally {
                setLoading(false)
            }
        }

        fetchCommittees()
    }, []);

    // Filter committees based on search term
    let filteredCommittees = committees.filter((committee) => {
        return Object.values(committee).some((value) => {
            return String(value).toLowerCase().includes(searchedTerm.toLowerCase())
        });
    });

    return (
        <>
            <HeaderNav setSearchedTerm={setSearchedTerm} />
            <SideBar />
            <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">
                <div className="motions-section max-w-full">
                    <h2 className="section-title dark:text-gray-100">Committees</h2>

                    {loading ? (
                        <p className="text-gray-600 dark:text-gray-400 mt-4">Loading committees...</p>
                    ) : error ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mt-4">
                            Failed to load committees
                        </div>
                    ) : filteredCommittees.length === 0 ? (
                        <p className="text-gray-600 dark:text-gray-400 mt-4">No committees found.</p>
                    ) : (
                        <div className="motions-grid">
                            {filteredCommittees.map(committee => (
                                <Link
                                    key={committee.committeeId || committee.id}
                                    to={`/committee/${committee.slug || committee.committeeId}`}
                                    className="motion-card block"
                                >
                                    <div className="motion-header">
                                        <h3 className="motion-title font-bold">{committee.title}</h3>
                                    </div>
                                    <p className="motion-description">{committee.description}</p>
                                    <div className="motion-footer">
                                        <span className="text-sm text-gray-600">
                                            {committee.members?.length || 0} members
                                        </span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    )
}

export default CommitteesPage
