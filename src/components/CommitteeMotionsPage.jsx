import { useState, useEffect } from "react"
import { useParams, Link, useLocation, useNavigate } from "react-router-dom"
import MotionCard from "./MotionCard"
import SideBar from './reusable/SideBar'
import HeaderNav from './reusable/HeaderNav'
import Tabs from './reusable/Tabs'
import { getCommitteeById, getCommitteeMembers } from "../services/committeeApi"
import { getMotionsByCommittee } from "../services/motionApi"
import { getCurrentUser, isAdmin } from '../services/userApi'
import NoAccessPage from './NoAccessPage'

function CommitteeMotionsPage() {
    const { id } = useParams();
    const [committee, setCommittee] = useState(null);
    const [motions, setMotions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchedTerm, setSearchedTerm] = useState("");
    const [hasAccess, setHasAccess] = useState(null);
    const [activeTab, setActiveTab] = useState("active");
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalMotions, setTotalMotions] = useState(0);
    const [jumpPage, setJumpPage] = useState('');
    const [jumpToPage, setJumpToPage] = useState('');

    const location = useLocation();
    const navigate = useNavigate();

    // Fetch committee and motions from API when component mounts or when id/currentPage changes
    async function fetchData() {
            try {
                setLoading(true);
                setError(null);

                // Fetch committee details
                const committeeData = await getCommitteeById(id);
                const fetchedCommittee = committeeData.committee || committeeData;
                setCommittee(fetchedCommittee);

                // Determine access: fetch current user and committee members
                let allowed = false;
                try {
                    const current = await getCurrentUser();
                    const user = current && current.user ? current.user : null;
                    if (!user) {
                        navigate('/login');
                        return;
                    }
                    // Check if user is any type of admin (super-admin, admin, or org-admin)
                    if (user && isAdmin(user)) {
                        allowed = true;
                    }

                    // Fetch committee members list and check membership
                    try {
                        const membersRes = await getCommitteeMembers(id);
                        const membersList = (membersRes && membersRes.members) || []; 
                        // current.user.id might be an ObjectId string; members have _id
                        if (user) {
                            const uid = String(user.id || user.userId);
                            if (membersList.some(m => { if (!m) return false; const mid = m.userId || m.id || m; return String(mid) === uid; })) {
                                allowed = true;
                            }
                            // Fallback: check if the user is a declared guest in their user doc (legacy data)
                            if (!allowed && Array.isArray(user.guestCommittees) && user.guestCommittees.map(String).includes(String(id))) {
                                allowed = true;
                            }
                        }
                    } catch (e) {
                        // If members endpoint fails, fall back to checking chair/owner
                        console.warn('Failed to fetch committee members for access check:', e);
                    }

                    // Check chair/owner fields on committee
                    if (!allowed && fetchedCommittee) {
                        const uid = user ? String(user.id || user.userId) : null;
                        if (uid) {
                            if (String(fetchedCommittee.chair || '') === uid || String(fetchedCommittee.owner || '') === uid) {
                                allowed = true;
                            }
                        }
                    }
                } catch (e) {
                    // Not authenticated or error fetching user — treat as not allowed
                    allowed = false;
                }

                setHasAccess(Boolean(allowed));

                // Fetch motions only if allowed
                    if (allowed) {
                        // Request top-level motions (backend will attach subsidiaries to parent motions)
                        const filters = {};
                        // Map frontend tab to backend status
                        // 'past' tab should show both 'passed' and 'failed' motions
                        if (activeTab === 'past') {
                            // Backend now supports comma-separated multiple statuses
                            filters.status = 'passed,failed';
                        } else if (activeTab && activeTab !== 'all') {
                            filters.status = activeTab;
                        }
                        const motionsData = await getMotionsByCommittee(id, currentPage, filters);
                    const fetchedMotions = motionsData.motions || motionsData || [];
                    setMotions(fetchedMotions);
                    setTotalPages((typeof motionsData.totalPages === 'number' && motionsData.totalPages >= 0) ? motionsData.totalPages : Math.max(1, Math.ceil((motionsData.total || fetchedMotions.length) / (motionsData.limit || 10))));
                    setTotalMotions(motionsData.total || 0);
                } else {
                    setMotions([]);
                }
            } catch (err) {
                console.error('Error fetching data:', err);
                setError(err.message || 'Failed to load data');
                setCommittee(null);
                setMotions([]);
            } finally {
                setLoading(false);
            }
        }

    useEffect(() => {
        if (id) {
            fetchData();
        }
    }, [id, currentPage, activeTab]);

    // Poll for motions every POLL_INTERVAL_MS (default 60s) while on this page and user has access
    useEffect(() => {
        if (!id || !hasAccess) return;
        const POLL_INTERVAL_MS = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_POLL_INTERVAL_MOTIONS_MS) ? Number(import.meta.env.VITE_POLL_INTERVAL_MOTIONS_MS) : 60000;
        const DEBUG_POLLING = typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_DEBUG_POLLING === 'true';
        // Poll when the page is visible to avoid unnecessary requests
        const poll = () => {
            if (document.visibilityState !== 'visible') return;
            if (DEBUG_POLLING) console.log(`[CommitteeMotionsPage] poll triggered at ${new Date().toISOString()} interval=${POLL_INTERVAL_MS}`);
            fetchData();
        };

        const intervalRef = setInterval(poll, POLL_INTERVAL_MS);

        // Also perform one immediate poll to ensure freshness when enabling polling
        poll();

        // If the page becomes visible again, fetch immediately
        const handleVisibility = () => {
            if (document.visibilityState === 'visible') poll();
        };
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            clearInterval(intervalRef);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [id, currentPage, activeTab, hasAccess]);

    // When activeTab changes (filter by status), reset to page 1 so we fetch the correct page set
    useEffect(() => {
        setCurrentPage(1);
    }, [activeTab]);

    // Utility: compute small list of page buttons to render (condenses when pages large)
    function getVisiblePages(current, total) {
        const visible = [];
        if (total <= 7) {
            for (let i = 1; i <= total; i++) visible.push(i);
            return visible;
        }
        // Show first, maybe ellipsis, current-2..current+2, maybe ellipsis, last
        visible.push(1);
        if (current > 4) visible.push('...');
        const start = Math.max(2, current - 2);
        const end = Math.min(total - 1, current + 2);
        for (let i = start; i <= end; i++) visible.push(i);
        if (current < total - 3) visible.push('...');
        visible.push(total);
        return visible;
    }

    // If motion was deleted and we navigated to this page with state, remove it locally and re-fetch
    useEffect(() => {
        const deletedMotionId = location?.state?.deletedMotionId;
        if (deletedMotionId) {
            // Remove from local state immediately for snappy UI
            setMotions(prev => prev.filter(m => String(m.motionId || m.id) !== String(deletedMotionId)));
            // Re-fetch to ensure canonical dataset
            (async () => {
                try {
                    setLoading(true);
                    const motionsData = await getMotionsByCommittee(id, currentPage);
                    setMotions(motionsData.motions || motionsData || []);
                } catch (err) {
                    console.error('Failed to refresh motions after delete:', err);
                } finally {
                    setLoading(false);
                }
            })();
            // Remove the deleted state so we don't run this effect again on back/forward
            navigate(location.pathname, { replace: true, state: {} });
        }
    }, [location?.state?.deletedMotionId]);


    const tabs = [
        { id: "all", label: "All", icon: "list" },
        { id: "active", label: "Active", icon: "bolt" },
        { id: "past", label: "Past", icon: "check_circle" },
        { id: "voided", label: "Voided", icon: "block" }
    ];

    // Filter motions based on search term
    let filteredMotions = motions.filter((motion) => {
        return Object.values(motion).some((value) => {
            return String(value).toLowerCase().includes(searchedTerm.toLowerCase())
        });
    });

    // Backend now handles status filtering, so no need for client-side tab filtering

    // Generate page list to display (numbered) with ellipses
    function getPageList(current, total) {
        const delta = 2; // how many neighbors to show
        const range = [];
        for (let i = Math.max(1, current - delta); i <= Math.min(total, current + delta); i++) {
            range.push(i);
        }
        const pages = [];
        if (range[0] > 1) {
            pages.push(1);
            if (range[0] > 2) pages.push('...');
        }
        pages.push(...range);
        if (range[range.length - 1] < total) {
            if (range[range.length - 1] < total - 1) pages.push('...');
            pages.push(total);
        }
        return pages;
    }

    return (
        <>
            <HeaderNav setSearchedTerm={setSearchedTerm} />
            <SideBar />
            <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">
                <div className="motions-section">
                    {loading ? (
                        <>
                            <h2 className="section-title dark:text-gray-100">Loading...</h2>
                            <p className="text-gray-600 dark:text-gray-400 mt-4">Loading committee data...</p>
                        </>
                    ) : error ? (
                        <>
                            <h2 className="section-title dark:text-gray-100">Error</h2>
                            {/* Error Banner */}
                            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg mt-4">
                                Failed to load committee data
                            </div>
                        </>
                    ) : !committee ? (
                        <>
                            <h2 className="section-title dark:text-gray-100">Committee Not Found</h2>
                        </>
                    ) : hasAccess === false ? (
                        <NoAccessPage committeeId={id} committeeTitle={committee?.title} />
                    ) : (
                        <>
                            <h2 className="section-title dark:text-gray-100">{committee.title} Motions</h2>
                            <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

                            {filteredMotions.length === 0 ? (
                                <p className="text-gray-600 dark:text-gray-400 mt-4">No motions found for this committee.</p>
                            ) : (
                                <div className="motions-grid">
                                    {filteredMotions.map(motion => (
                                        <MotionCard
                                            key={motion.motionId || motion.id}
                                            motion={motion}
                                            committeeSlug={committee?.slug || id}
                                        />
                                    ))}
                                </div>
                            )}
                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="mt-6 p-2">
                                    <div className="flex items-center justify-center gap-2 flex-col sm:flex-row">
                                    <div className="flex items-center gap-2">
                                        <button className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200" disabled={currentPage <= 1} onClick={() => setCurrentPage(1)}>First</button>
                                        <button className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200" disabled={currentPage <= 1} onClick={() => setCurrentPage(currentPage - 1)}>Prev</button>
                                    </div>

                                    <div className="flex items-center gap-1">
                                        {getPageList(currentPage, totalPages).map((p, idx) => (
                                            typeof p === 'string' ? (
                                                <span key={`el-${idx}`} className="px-2">{p}</span>
                                            ) : (
                                                <button
                                                    key={p}
                                                    className={`px-3 py-1 rounded ${p === currentPage ? 'bg-amber-500 text-white' : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200'}`}
                                                    onClick={() => setCurrentPage(p)}
                                                >{p}</button>
                                            )
                                        ))}
                                    </div>

                                    <div className="flex items-center gap-2">
                                        <button className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(currentPage + 1)}>Next</button>
                                        <button className="px-3 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(totalPages)}>Last</button>
                                    </div>

                                    <div className="ml-2 flex items-center gap-2">
                                        <input type="number" min="1" max={totalPages} value={jumpPage} onChange={(e) => setJumpPage(e.target.value)} className="w-16 px-2 py-1 border border-gray-300 dark:border-gray-700 rounded" placeholder="Page" />
                                        <button className="px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700" onClick={() => {
                                            const val = Math.max(1, Math.min(totalPages, parseInt(jumpPage || currentPage, 10) || currentPage));
                                            setCurrentPage(val);
                                            setJumpPage('');
                                        }}>Go</button>
                                    </div>
                                </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </>
    )
}

export default CommitteeMotionsPage
