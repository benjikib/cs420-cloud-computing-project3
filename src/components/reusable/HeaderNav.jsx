// const SearchBar = ( {searchedTerm, setSearchedTerm} ) => {
function SearchBar( {setSearchedTerm} ) {
        // setSearchedTerm is passed from MotionsPage which puts it into HeaderNav and then we get it here in SearchBar finally
        // we just set the searchedTerm (prop that searchBar itself doesn't need to see) to whatever is in the input element

        return (
                <>
                        <div className="flex items-center border border-black dark:border-gray-600 bg-[#F8FEF9] dark:bg-gray-800 rounded-sm w-100 h-7.5">
                                <span className="material-symbols-outlined text-black dark:text-gray-300 ml-1">search</span>
                                <input
                                        placeholder="Search"
                                        className="ml-1.5 w-full h-full border-transparent focus:outline-none font-[400] text-xs text-black/60 dark:text-gray-300 bg-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
                                        onChange={ (e) => { setSearchedTerm(e.target.value) } }
                                        autoComplete="off"
                                />
                        </div> 
                </>
        )

};


import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE_URL } from '../../config/api.js';
import { getNotifications, handleNotification } from '../../services/notificationApi.js';

// const HeaderNav = ( {searchedTerm, setSearchedTerm} ) => {
export default function HeaderNav( {setSearchedTerm} ) {
        const navigate = useNavigate();
        const [user, setUser] = useState(null);
        const [isAuthenticated, setIsAuthenticated] = useState(false);
        const [notifications, setNotifications] = useState([]);
        const [unreadCount, setUnreadCount] = useState(0);
        const dropdownRef = useRef(null);
        const [open, setOpen] = useState(false);

        useEffect(() => {
                function handleClickOutside(e) {
                        if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                                setOpen(false)
                        }
                }
                document.addEventListener('mousedown', handleClickOutside)
                return () => document.removeEventListener('mousedown', handleClickOutside)
        }, [])

        async function fetchNotifications() {
                try {
                        const data = await getNotifications(1, 20)
                        const list = data.notifications || data
                        // console.log('Fetched notifications:', list);
                        setNotifications(list)
                        // Count unseen notifications (not marked with seenAt)
                        const unseen = list.filter(n => !n.seenAt).length
                        // console.log('Unseen count:', unseen);
                        setUnreadCount(unseen)
                } catch (err) {
                        console.error('Failed fetching notifications', err)
                }
        }

        async function markNotificationsAsSeen() {
                try {
                        // console.log('markNotificationsAsSeen called, notifications:', notifications);
                        const toMark = notifications.filter(n => 
                                n.type !== 'access_request' && 
                                n.type !== 'voting_opened' && 
                                n.type !== 'voting_deadline_approaching' &&
                                !n.seenAt
                        ).map(n => n._id)
                        // console.log('Notifications to mark as seen:', toMark);
                        if (toMark.length > 0) {
                                // mark each as seen
                                const results = await Promise.allSettled(toMark.map(id => handleNotification(id, 'mark_seen')))
                                // console.log('Mark seen results:', results);
                                // Refresh to update badge
                                await fetchNotifications()
                        }
                } catch (e) {
                        console.warn('Failed to mark notifications seen:', e)
                }
        }

        async function onHandle(notificationId, action) {
                try {
                        await handleNotification(notificationId, action)
                        await fetchNotifications()
                } catch (err) {
                        console.error('Failed handling notification', err)
                        alert(err.message || 'Failed to handle notification')
                }
        }

        useEffect(() => {
                async function fetchUserData() {
                        // Check if user is logged in
                        const token = localStorage.getItem('token');

                        if (token) {
                                try {
                                        // Fetch current user data from API to get latest profile picture
                                        const response = await fetch(`${API_BASE_URL}/auth/me`, {
                                                headers: {
                                                        'Authorization': `Bearer ${token}`
                                                }
                                        });

                                        if (response.ok) {
                                                const data = await response.json();
                                                setIsAuthenticated(true);
                                                setUser(data.user);
                                                // Update localStorage with latest user data
                                                localStorage.setItem('user', JSON.stringify(data.user));
                                        } else {
                                                // Token is invalid
                                                setIsAuthenticated(false);
                                                setUser(null);
                                                localStorage.removeItem('token');
                                                localStorage.removeItem('user');
                                        }
                                } catch (err) {
                                        console.error('Error fetching user data:', err);
                                        setIsAuthenticated(false);
                                        setUser(null);
                                }
                        } else {
                                setIsAuthenticated(false);
                                setUser(null);
                        }
                }

                fetchUserData();
        }, []);

        // Poll notifications every 5 minutes while a user is signed in.
        useEffect(() => {
                if (!user) return;
                // fetch immediately, then poll
                fetchNotifications();
                const intervalId = setInterval(() => {
                        fetchNotifications();
                }, 300000); // 300,000 ms = 5 minutes
                return () => clearInterval(intervalId);
        }, [user]);

        // Mark notifications as seen when dropdown opens
        useEffect(() => {
                if (open && notifications.length > 0) {
                        markNotificationsAsSeen();
                }
        }, [open]);

        const handleLogout = () => {
                // Clear token and user from localStorage
                localStorage.removeItem('token');
                localStorage.removeItem('user');
                setIsAuthenticated(false);
                setUser(null);
                navigate('/');
        };

        const handleLogin = () => {
                navigate('/');
        };

        return (
                <div className="fixed top-0 left-0 right-0 z-50 w-full border border-gray-400/10 dark:border-gray-700 shadow-md shadow-gray-500/50 dark:shadow-black/50 bg-white dark:bg-gray-900">
                        {/* Desktop Layout - horizontal */}
                        <div className="hidden lg:flex items-center justify-between h-20 px-8">
                                {/* The site name, logo, and search bar are grouped on the left */}
                                <div className="flex items-center space-x-4">
                                        <a href="/home" className="flex items-center space-x-2">
                                                <span className="text-lighter-green dark:text-white font-extrabold text-4xl site-name pt-1">Commie</span>
                                                <img src="/logo.png" alt="Logo" className="w-20 h-20"></img>
                                        </a>
                                        <div className="ml-16">
                                                <SearchBar setSearchedTerm = {setSearchedTerm}  />
                                        </div>
                                </div>

                                {/* The notifs, setting, and profile are grouped on the right */}
                                <div className="flex items-center gap-6">
                                {isAuthenticated ? (
                                        <>
                                                <div className="relative" ref={dropdownRef}>
                                                        <a
                                                                className="hover:scale-110 transition-all relative inline-block cursor-pointer"
                                                                onClick={async () => {
                                                                        setOpen(o => {
                                                                                const newVal = !o
                                                                                if (newVal) {
                                                                                        fetchNotifications()
                                                                                }
                                                                                return newVal
                                                                        })
                                                                }}
                                                                aria-label="Notifications"
                                                        >
                                                                <span className="material-symbols-outlined !text-gray-600 dark:!text-white hover:!text-gray-900 dark:hover:!text-gray-300" style={{ fontSize: '28px', paddingTop: '4px' }}>notifications</span>
                                                                {unreadCount > 0 && (
                                                                        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1">{unreadCount}</span>
                                                                )}
                                                        </a>

                                                        {/* Dropdown panel */}
                                                        {open && (
                                                                <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded shadow-lg z-50">
                                                                        <div className="p-2 border-b border-gray-100 dark:border-gray-700 font-medium">Notifications</div>
                                                                        <div className="max-h-64 overflow-auto">
                                                                                {notifications.length === 0 && (
                                                                                        <div className="p-3 text-sm text-gray-600 dark:text-gray-300">No notifications</div>
                                                                                )}
                                                                                {notifications.map(n => (
                                                                                        <div key={n._id} className="p-3 border-b last:border-b-0 bg-white dark:bg-gray-800">
                                                                                                <div className="flex justify-between items-start">
                                                                                                        <div className="text-sm font-medium dark:text-gray-100">{n.committeeTitle || 'Committee'}</div>
                                                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">{new Date(n.createdAt).toLocaleString()}</div>
                                                                                                </div>
                                                                                                <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">{n.requesterName ? `${n.requesterName} — ` : ''}{n.message}</div>
                                                                                                <div className="mt-2 flex gap-2">
                                                                                                        {(n.type === 'voting_opened' || n.type === 'voting_deadline_approaching') && n.metadata && (
                                                                                                                <button 
                                                                                                                        onClick={() => {
                                                                                                                                navigate(`/committee/${n.metadata.committeeSlug}/motion/${n.metadata.motionId}`);
                                                                                                                                onHandle(n._id, 'mark_seen');
                                                                                                                        }} 
                                                                                                                        className="px-2 py-1 bg-[#13562C] hover:bg-[#1a7a3f] text-white text-xs rounded"
                                                                                                                >
                                                                                                                        {n.type === 'voting_deadline_approaching' ? 'Vote Before Deadline' : 'Vote Now'}
                                                                                                                </button>
                                                                                                        )}
                                                                                                        {n.status === 'pending' && n.type !== 'meeting_scheduled' && n.type !== 'voting_opened' && n.type !== 'voting_deadline_approaching' && ((user?.roles?.includes('super-admin') || user?.roles?.includes('admin')) || (user?.chairedCommittees && user.chairedCommittees.map(String).includes(String(n.committeeId)))) && (
                                                                                                                <>
                                                                                                                        <button onClick={() => onHandle(n._id, 'approve')} className="px-2 py-1 bg-[#54966D] hover:bg-[#5ca377] text-white text-xs rounded">Approve</button>
                                                                                                                        <button onClick={() => onHandle(n._id, 'deny')} className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded">Deny</button>
                                                                                                                </>
                                                                                                        )}
                                                                                                        {n.status !== 'pending' && n.type !== 'meeting_scheduled' && n.type !== 'voting_opened' && n.type !== 'voting_deadline_approaching' && (
                                                                                                                <div className="text-xs text-gray-500 dark:text-gray-400">{n.status}</div>
                                                                                                        )}
                                                                                                </div>
                                                                                        </div>
                                                                                ))}
                                                                        </div>
                                                                </div>
                                                        )}
                                                </div>

                                                <a href="/settings" title="Settings" className="hover:scale-110 transition-all">
                                                        <span className="material-symbols-outlined !text-gray-600 dark:!text-white hover:!text-gray-900 dark:hover:!text-gray-300" style={{ fontSize: '28px', paddingTop: '4px' }}>settings</span>
                                                </a>
                                                <a href="/profile" title="Profile" className="hover:scale-110 transition-all">
                                                        {user?.picture ? (
                                                                <img src={user.picture} alt="Profile" className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                                                        ) : (
                                                                <span className="material-symbols-outlined text-4xl !text-gray-600 dark:!text-white hover:!text-gray-900 dark:hover:!text-gray-300">account_circle</span>
                                                        )}
                                                </a>
                                                <button
                                                        onClick={handleLogout}
                                                        className="text-sm px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white font-medium transition-all"
                                                        title="Logout"
                                                >
                                                        Logout
                                                </button>
                                        </>
                                ) : (
                                        <button
                                                onClick={handleLogin}
                                                className="text-sm px-4 py-2 rounded bg-[#54966D] hover:bg-[#5ca377] text-white font-medium transition-all"
                                        >
                                                Login
                                        </button>
                                )}
                        </div>
                        </div>

                        {/* Mobile Layout - vertical/centered */}
                        <div className="lg:hidden flex flex-col items-center py-3 px-4 space-y-3">
                                {/* Logo and title centered */}
                                <a href="/home" className="flex items-center gap-2">
                                        <span className="text-lighter-green dark:text-white font-extrabold text-2xl site-name hidden">Commie</span>
                                        <img src="/logo.png" alt="Logo" className="w-15 h-15"></img>
                                </a>
                                
                                {/* Search bar */}
                                <div className="w-full">
                                        <div className="max-w-[180px]">
                                                <SearchBar setSearchedTerm={setSearchedTerm} />
                                        </div>
                                </div>

                                {/* Actions: notifs, settings, profile, logout */}
                                <div className="flex items-center justify-center gap-4">
                                        {isAuthenticated ? (
                                                <>
                                                        <div className="relative" ref={dropdownRef}>
                                                                <a
                                                                        className="hover:scale-110 transition-all relative inline-block cursor-pointer"
                                                                        onClick={async () => {
                                                                                setOpen(o => {
                                                                                        const newVal = !o
                                                                                        if (newVal) {
                                                                                                fetchNotifications()
                                                                                        }
                                                                                        return newVal
                                                                                })
                                                                        }}
                                                                        aria-label="Notifications"
                                                                >
                                                                        <span className="material-symbols-outlined !text-gray-600 dark:!text-white hover:!text-gray-900 dark:hover:!text-gray-300" style={{ fontSize: '24px' }}>notifications</span>
                                                                        {unreadCount > 0 && (
                                                                                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full px-1">{unreadCount}</span>
                                                                        )}
                                                                </a>

                                                                {/* Dropdown uses same panel as desktop */}
                                                                {open && (
                                                                        <div className="absolute left-0 lg:right-0 lg:left-auto mt-2 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100 rounded shadow-lg z-50 max-w-[calc(100vw-2rem)]">
                                                                                <div className="p-2 border-b border-gray-100 dark:border-gray-700 font-medium">Notifications</div>
                                                                                <div className="max-h-64 overflow-auto">
                                                                                        {notifications.length === 0 && (
                                                                                                <div className="p-3 text-sm text-gray-600 dark:text-gray-300">No notifications</div>
                                                                                        )}
                                                                                        {notifications.map(n => (
                                                                                                <div key={n._id} className="p-3 border-b last:border-b-0 bg-white dark:bg-gray-800">
                                                                                                        <div className="flex justify-between items-start">
                                                                                                                <div className="text-sm font-medium dark:text-gray-100">{n.committeeTitle || 'Committee'}</div>
                                                                                                                <div className="text-xs text-gray-500 dark:text-gray-400">{new Date(n.createdAt).toLocaleString()}</div>
                                                                                                        </div>
                                                                                                        <div className="text-sm text-gray-700 dark:text-gray-300 mt-1">{n.requesterName ? `${n.requesterName} — ` : ''}{n.message}</div>
                                                                                                        <div className="mt-2 flex gap-2">
                                                                                                                {(n.type === 'voting_opened' || n.type === 'voting_deadline_approaching') && n.metadata && (
                                                                                                                        <button 
                                                                                                                                onClick={() => {
                                                                                                                                        navigate(`/committee/${n.metadata.committeeSlug}/motion/${n.metadata.motionId}`);
                                                                                                                                        onHandle(n._id, 'mark_seen');
                                                                                                                                }} 
                                                                                                                                className="px-2 py-1 bg-[#13562C] hover:bg-[#1a7a3f] text-white text-xs rounded"
                                                                                                                        >
                                                                                                                                {n.type === 'voting_deadline_approaching' ? 'Vote Before Deadline' : 'Vote Now'}
                                                                                                                        </button>
                                                                                                                )}
                                                                                                                {n.status === 'pending' && n.type !== 'meeting_scheduled' && n.type !== 'voting_opened' && n.type !== 'voting_deadline_approaching' && ((user?.roles?.includes('super-admin') || user?.roles?.includes('admin')) || (user?.chairedCommittees && user.chairedCommittees.map(String).includes(String(n.committeeId)))) && (
                                                                                                                        <>
                                                                                                                                <button onClick={() => onHandle(n._id, 'approve')} className="px-2 py-1 bg-[#54966D] hover:bg-[#5ca377] text-white text-xs rounded">Approve</button>
                                                                                                                                <button onClick={() => onHandle(n._id, 'deny')} className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded">Deny</button>
                                                                                                                        </>
                                                                                                                )}
                                                                                                                {n.status !== 'pending' && n.type !== 'meeting_scheduled' && n.type !== 'voting_opened' && n.type !== 'voting_deadline_approaching' && (
                                                                                                                        <div className="text-xs text-gray-500 dark:text-gray-400">{n.status}</div>
                                                                                                                )}
                                                                                                        </div>
                                                                                                </div>
                                                                                        ))}
                                                                                </div>
                                                                        </div>
                                                                )}
                                                        </div>

                                                        <a href="/settings" title="Settings" className="hover:scale-110 transition-all">
                                                                <span className="material-symbols-outlined !text-gray-600 dark:!text-white hover:!text-gray-900 dark:hover:!text-gray-300" style={{ fontSize: '24px' }}>settings</span>
                                                        </a>
                                                        <a href="/profile" title="Profile" className="hover:scale-110 transition-all">
                                                                {user?.picture ? (
                                                                        <img src={user.picture} alt="Profile" className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600" />
                                                                ) : (
                                                                        <span className="material-symbols-outlined text-3xl !text-gray-600 dark:!text-white hover:!text-gray-900 dark:hover:!text-gray-300">account_circle</span>
                                                                )}
                                                        </a>
                                                        <button
                                                                onClick={handleLogout}
                                                                className="text-xs px-3 py-1.5 rounded bg-red-500 hover:bg-red-600 text-white font-medium transition-all"
                                                                title="Logout"
                                                        >
                                                                Logout
                                                        </button>
                                                </>
                                        ) : (
                                                <button
                                                        onClick={handleLogin}
                                                        className="text-sm px-4 py-2 rounded bg-[#54966D] hover:bg-[#5ca377] text-white font-medium transition-all"
                                                >
                                                        Login
                                                </button>
                                        )}
                                </div>
                        </div>
                
                </div>
        );

};

// export default HeaderNav;
