import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import SideBar from './reusable/SideBar';
import HeaderNav from './reusable/HeaderNav';
import Tabs from './reusable/Tabs';
import OrganizationSettings from './OrganizationSettings';
import { getCurrentUser, isAdmin, getUserSettings, updateUserSettings, deleteUser } from '../services/userApi';
import { deleteOrganization } from '../services/organizationApi';
import { API_BASE_URL } from '../config/api.js';

function AdminPanel() {
    const navigate = useNavigate();
    const [currentUser, setCurrentUser] = useState(null);
    const [users, setUsers] = useState([]);
    const [committees, setCommittees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchedTerm, setSearchedTerm] = useState("");
    const [editingUser, setEditingUser] = useState(null);
    const [saving, setSaving] = useState(false);
    const [successMessage, setSuccessMessage] = useState("");
    const [activeTab, setActiveTab] = useState("users");
    const [organizations, setOrganizations] = useState([]);
    const [selectedOrgFilter, setSelectedOrgFilter] = useState("all"); // "all" or organizationId
    const [enabledNotificationOrgs, setEnabledNotificationOrgs] = useState([]); // Array of org IDs with notifications enabled
    const [savingNotificationSettings, setSavingNotificationSettings] = useState(false);
    const [deletingOrg, setDeletingOrg] = useState(null); // Organization being deleted
    const [deletingUser, setDeletingUser] = useState(null); // User being deleted (for self-delete)

    // Check if user is admin and fetch data
    useEffect(() => {
        async function checkAdminAndFetchData() {
            try {
                setLoading(true);
                const userResponse = await getCurrentUser();

                if (!userResponse.success) {
                    navigate('/login');
                    return;
                }
                
                if (!isAdmin(userResponse.user)) {
                    navigate('/home');
                    return;
                }

                setCurrentUser(userResponse.user);

                // Fetch organizations
                if (userResponse.user.roles?.includes('super-admin')) {
                    // Super-admins: fetch all organizations for filtering
                    try {
                        const orgsResponse = await fetch(`${API_BASE_URL}/organizations`, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${localStorage.getItem('token')}`
                            }
                        });
                        if (orgsResponse.ok) {
                            const orgsData = await orgsResponse.json();
                            setOrganizations(orgsData.organizations || []);
                        }
                    } catch (err) {
                        console.error('Error fetching organizations:', err);
                    }
                    
                    // Load notification settings
                    try {
                        const settingsResponse = await getUserSettings();
                        if (settingsResponse.success) {
                            setEnabledNotificationOrgs(settingsResponse.settings.enabledNotificationOrgs || []);
                        }
                    } catch (err) {
                        console.error('Error fetching notification settings:', err);
                    }
                } else if (userResponse.user.organizationId) {
                    // Org-admins: fetch their own organization for owner checks
                    try {
                        const orgId = userResponse.user.organizationId.$oid || userResponse.user.organizationId.toString?.() || userResponse.user.organizationId;
                        // console.log('Fetching organization with ID:', orgId);
                        const orgResponse = await fetch(`${API_BASE_URL}/organizations/${orgId}`, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${localStorage.getItem('token')}`
                            }
                        });
                        if (orgResponse.ok) {
                            const orgData = await orgResponse.json();
                            // console.log('Organization response:', orgData);
                            // Response is the organization object directly
                            setOrganizations([orgData]);
                        } else {
                            console.error('Failed to fetch organization:', orgResponse.status, await orgResponse.text());
                        }
                    } catch (err) {
                        console.error('Error fetching organization:', err);
                    }
                }

                // Fetch all users
                const usersResponse = await fetch(`${API_BASE_URL}/auth/users`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });

                if (!usersResponse.ok) {
                    throw new Error('Failed to fetch users');
                }

                const usersData = await usersResponse.json();
                setUsers(usersData.users || []);

                // Fetch all committees
                const committeesResponse = await fetch(`${API_BASE_URL}/committees/1`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    }
                });

                if (committeesResponse.ok) {
                    const committeesData = await committeesResponse.json();
                    setCommittees(committeesData.committees || []);
                }
            } catch (err) {
                console.error('Error:', err);
                setError(err.message || 'Failed to load data');
            } finally {
                setLoading(false);
            }
        }

        checkAdminAndFetchData();
    }, [navigate]);

    const handleEditUser = (user) => {
        // Check if user is the organization owner
        const userOrgId = user.organizationId?.$oid || user.organizationId?.toString?.() || user.organizationId;
        const userOrganization = organizations.find(org => {
            if (!org || !org._id) return false;
            const orgId = org._id?.$oid || org._id?.toString?.() || org._id;
            return String(orgId) === String(userOrgId);
        });
        const ownerId = userOrganization?.owner?.$oid || userOrganization?.owner?.toString?.(  ) || userOrganization?.owner;
        const isOwner = ownerId && String(ownerId) === String(user.id);
        
        setEditingUser({
            id: user.id,
            name: user.name,
            organizationRole: user.organizationRole || 'member',
            isSuperAdmin: user.roles?.includes('super-admin') || false,
            isOwner: isOwner
        });
        setSuccessMessage("");
        setError(null);
    };

    const handleCancelEdit = () => {
        setEditingUser(null);
    };

    const handleOrgRoleChange = (role) => {
        setEditingUser(prev => ({
            ...prev,
            organizationRole: role
        }));
    };

    const handleSuperAdminToggle = () => {
        setEditingUser(prev => ({
            ...prev,
            isSuperAdmin: !prev.isSuperAdmin
        }));
    };

    const handleSaveUser = async () => {
        try {
            setSaving(true);
            setError(null);
            setSuccessMessage("");

            // Prevent changing organization owner's role from admin
            if (editingUser.isOwner && editingUser.organizationRole !== 'admin') {
                setError('Cannot change the organization owner\'s role from admin. Transfer ownership first.');
                return;
            }

            // Prepare roles array based on super-admin status
            const roles = editingUser.isSuperAdmin ? ['super-admin', 'user'] : ['user'];

            const response = await fetch(`${API_BASE_URL}/auth/users/${editingUser.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    roles: roles,
                    organizationRole: editingUser.organizationRole
                })
            });

            if (!response.ok) {
                throw new Error('Failed to update user');
            }

            const data = await response.json();

            // Update local users list
            setUsers(users.map(u =>
                u.id === editingUser.id
                    ? { 
                        ...u, 
                        roles: data.user.roles, 
                        organizationRole: data.user.organizationRole 
                    }
                    : u
            ));

            setSuccessMessage('User updated successfully!');
            setTimeout(() => setSuccessMessage(""), 3000);
            setEditingUser(null);
        } catch (err) {
            console.error('Error updating user:', err);
            setError(err.message || 'Failed to update user');
        } finally {
            setSaving(false);
        }
    };

    // Helper to compare MongoDB ObjectIds (handles both string and object formats)
    const compareObjectIds = (id1, id2) => {
        const getId = (id) => {
            if (!id) return null;
            if (typeof id === 'string') return id;
            if (id.$oid) return id.$oid;
            if (id.toString) return id.toString();
            return String(id);
        };
        return getId(id1) === getId(id2);
    };

    // Filter users and committees based on selected organization (for super-admins)
    const filteredUsers = currentUser?.roles?.includes('super-admin') && selectedOrgFilter !== 'all'
        ? users.filter(user => {
            const match = compareObjectIds(user.organizationId, selectedOrgFilter);
            return match;
        })
        : users;

    const filteredCommittees = currentUser?.roles?.includes('super-admin') && selectedOrgFilter !== 'all'
        ? committees.filter(committee => {
            const match = compareObjectIds(committee.organizationId, selectedOrgFilter);
            return match;
        })
        : committees;

    if (loading) {
        return (
            <>
                <HeaderNav setSearchedTerm={setSearchedTerm} />
                <SideBar />
                <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">
                    <div className="text-gray-600 dark:text-gray-400">Loading...</div>
                </div>
            </>
        );
    }

    return (
        <>
            <HeaderNav setSearchedTerm={setSearchedTerm} />
            <SideBar />
            <div className="mt-20 ml-0 lg:ml-[16rem] px-4 lg:px-8 min-h-screen bg-[#F8FEF9] dark:bg-gray-900">
                <div className="max-w-6xl">
                    <h2 className="section-title dark:text-gray-100">Admin Panel</h2>
                    <p className="text-gray-600 dark:text-gray-400 mb-6">Manage users, committees, and system settings</p>

                    {/* Super-Admin Organization Filter */}
                    {currentUser?.roles?.includes('super-admin') && organizations.length > 0 && (
                        <div className="mb-6 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                <div className="flex flex-col sm:flex-row sm:items-center gap-3 lg:gap-4 flex-1">
                                    <label className="text-sm font-medium text-purple-900 dark:text-purple-200 whitespace-nowrap">
                                        Filter by Organization:
                                    </label>
                                    <select
                                        value={selectedOrgFilter}
                                        onChange={(e) => setSelectedOrgFilter(e.target.value)}
                                        className="w-full sm:flex-1 px-3 lg:px-4 py-2 border border-purple-300 dark:border-purple-700 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent text-sm lg:text-base"
                                    >
                                        <option value="all">All Organizations (Platform-wide)</option>
                                        {organizations.map(org => {
                                            const orgId = org._id?.$oid || org._id?.toString?.() || org._id;
                                            return (
                                                <option key={orgId} value={orgId}>
                                                    {org.name}
                                                </option>
                                            );
                                        })}
                                    </select>
                                </div>
                                <div className="text-sm text-purple-700 dark:text-purple-300">
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Admin Type Badge */}
                    {currentUser && (
                        <div className="mb-6 p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                            <div className="flex items-center justify-between">
                                <div>
                                    <span className="text-sm text-gray-600 dark:text-gray-400">Admin Type: </span>
                                    <span className={`ml-2 px-3 py-1 rounded-full text-sm font-medium ${
                                        currentUser.roles?.includes('super-admin') 
                                            ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300' 
                                            : 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
                                    }`}>
                                        {currentUser.roles?.includes('super-admin') ? 'Platform Super-Admin' : 'Organization Administrator'}
                                    </span>
                                </div>
                                {!currentUser.roles?.includes('super-admin') && currentUser.organizationId && (
                                    <div className="text-sm text-gray-600 dark:text-gray-400">
                                        Organization Scoped Access
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Success Message */}
                    {successMessage && (
                        <div className="mb-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-3 rounded-lg">
                            {successMessage}
                        </div>
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="mb-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg">
                            {error}
                        </div>
                    )}

                    {/* Tabs */}
                    <Tabs
                        tabs={[
                            { id: "users", label: "Users", icon: "person" },
                            { id: "committees", label: "Committees", icon: "groups" },
                            { id: "system", label: "System", icon: "settings" }
                        ]}
                        activeTab={activeTab}
                        onTabChange={setActiveTab}
                    />

                    {/* Users Tab */}
                    {activeTab === "users" && (
                        <div>
                            {/* Users Table */}
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-gray-50 dark:bg-gray-900">
                                    <tr>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            User
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Email
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Roles
                                        </th>
                                        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                            Actions
                                        </th>
                                    </tr>
                                </thead>
                                <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                    {filteredUsers.map((user) => (
                                        <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    {user.picture ? (
                                                        <img
                                                            src={user.picture}
                                                            alt={user.name}
                                                            className="w-10 h-10 rounded-full mr-3"
                                                        />
                                                    ) : (
                                                        <div className="w-10 h-10 rounded-full bg-lighter-green flex items-center justify-center text-white font-semibold mr-3">
                                                            {user.name?.[0]?.toUpperCase() || 'U'}
                                                        </div>
                                                    )}
                                                    <div>
                                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {user.name}
                                                        </div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            {user.settings?.displayName || 'No display name'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                                                {user.email}
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex flex-wrap gap-1">
                                                    {user.roles?.includes('super-admin') && (
                                                        <span className="px-2 py-1 text-xs rounded-full font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                                                            super-admin
                                                        </span>
                                                    )}
                                                    {user.organizationRole === 'admin' && (
                                                        <span className="px-2 py-1 text-xs rounded-full font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                                                            org-admin
                                                        </span>
                                                    )}
                                                    {user.organizationRole === 'member' && (
                                                        <span className="px-2 py-1 text-xs rounded-full font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                                                            member
                                                        </span>
                                                    )}
                                                    {!user.organizationRole && !user.roles?.includes('super-admin') && (
                                                        <span className="px-2 py-1 text-xs rounded-full font-semibold bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200">
                                                            user
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleEditUser(user)}
                                                        disabled={(() => {
                                                            // Check if this user is the owner and trying to edit themselves
                                                            if (user.id !== currentUser?.id) return false;
                                                            if (!organizations || organizations.length === 0) return false;
                                                            
                                                            const userOrgId = user.organizationId?.$oid || user.organizationId?.toString?.() || user.organizationId;
                                                            const userOrganization = organizations.find(org => {
                                                                if (!org || !org._id) return false;
                                                                const orgId = org._id?.$oid || org._id?.toString?.() || org._id;
                                                                return String(orgId) === String(userOrgId);
                                                            });
                                                            if (!userOrganization) return false;
                                                            const ownerId = userOrganization.owner?.$oid || userOrganization.owner?.toString?.() || userOrganization.owner;
                                                            return ownerId && String(ownerId) === String(user.id);
                                                        })()}
                                                        className="text-lighter-green hover:text-darker-green font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                        title={(() => {
                                                            if (user.id !== currentUser?.id) return "";
                                                            if (!organizations || organizations.length === 0) return "";
                                                            
                                                            const userOrgId = user.organizationId?.$oid || user.organizationId?.toString?.() || user.organizationId;
                                                            const userOrganization = organizations.find(org => {
                                                                if (!org || !org._id) return false;
                                                                const orgId = org._id?.$oid || org._id?.toString?.() || org._id;
                                                                return String(orgId) === String(userOrgId);
                                                            });
                                                            if (!userOrganization) return "";
                                                            const ownerId = userOrganization.owner?.$oid || userOrganization.owner?.toString?.() || userOrganization.owner;
                                                            const isOwner = ownerId && String(ownerId) === String(user.id);
                                                            return isOwner ? "Organization owners cannot change their own role" : "";
                                                        })()}
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            if (user.id === currentUser.id) {
                                                                setError('Use the "Delete My Account" button in the System tab to delete your own account');
                                                                return;
                                                            }
                                                            
                                                            const confirmed = window.confirm(
                                                                `Delete user "${user.name}" (${user.email})?\n\n` +
                                                                `This will:\n` +
                                                                `- Remove them from all committees\n` +
                                                                `- Delete all their votes and comments\n` +
                                                                `- Delete all their notifications\n\n` +
                                                                `This action CANNOT be undone!`
                                                            );
                                                            
                                                            if (!confirmed) return;
                                                            
                                                            try {
                                                                const result = await deleteUser(user.id);
                                                                if (result.success) {
                                                                    setSuccessMessage(`User ${user.name} deleted successfully`);
                                                                    // Remove from local state
                                                                    setUsers(users.filter(u => u.id !== user.id));
                                                                    setTimeout(() => setSuccessMessage(''), 3000);
                                                                } else {
                                                                    setError(result.message || 'Failed to delete user');
                                                                }
                                                            } catch (err) {
                                                                setError('Failed to delete user: ' + err.message);
                                                            }
                                                        }}
                                                        className="text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 font-medium"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {filteredUsers.length === 0 && (
                        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                            {selectedOrgFilter !== 'all' 
                                ? 'No users found in this organization'
                                : 'No users found'
                            }
                        </div>
                    )}
                        </div>
                    )}

                    {/* Committees Tab */}
                    {activeTab === "committees" && (
                        <div>
                            {/* Committees Table */}
                            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                                <div className="overflow-x-auto">
                                    <table className="w-full">
                                        <thead className="bg-gray-50 dark:bg-gray-900">
                                            <tr>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                                    Committee
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                                    Slug
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                                    Members
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                                    Motions
                                                </th>
                                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                                                    Actions
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                                            {filteredCommittees.map((committee) => (
                                                <tr key={committee.committeeId || committee.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                                                    <td className="px-6 py-4 whitespace-nowrap">
                                                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                                            {committee.name}
                                                        </div>
                                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                                            {committee.description?.substring(0, 50) || 'No description'}
                                                            {committee.description?.length > 50 ? '...' : ''}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                                                        {committee.slug || 'N/A'}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                                                        {committee.members?.length || 0}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 dark:text-gray-300">
                                                        {committee.motions?.length || 0}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                                                        <button
                                                            onClick={() => navigate(`/committee/${committee.slug || committee.committeeId}`)}
                                                            className="text-lighter-green hover:text-darker-green font-medium"
                                                        >
                                                            View
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {filteredCommittees.length === 0 && (
                                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                                    {selectedOrgFilter !== 'all' 
                                        ? 'No committees found in this organization'
                                        : 'No committees found'
                                    }
                                </div>
                            )}
                        </div>
                    )}

                    {/* System Tab */}
                    {activeTab === "system" && (
                        <div className="space-y-6">
                            {/* Organization Settings */}
                            <OrganizationSettings />
                            
                            {/* Super-Admin Notification Settings */}
                            {currentUser?.roles?.includes('super-admin') && (
                                <div className="bg-purple-50 dark:bg-purple-900/20 p-6 rounded-lg shadow-sm border-2 border-purple-300 dark:border-purple-700">
                                    <div className="flex items-start gap-3 mb-4">
                                        <span className="material-symbols-outlined text-purple-600 dark:text-purple-400 text-3xl">admin_panel_settings</span>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-purple-900 dark:text-purple-200 mb-2">Super-Admin: Organization Notifications</h3>
                                            <p className="text-sm text-purple-700 dark:text-purple-300 mb-4">
                                                By default, super-admins don't see any organization-level notifications (access requests, motion updates, voting alerts, meeting schedules, etc.). 
                                                Use the filter below to enable notifications for specific organizations or all organizations at once.
                                            </p>
                                        </div>
                                    </div>
                                    
                                    {/* Organization Selection Dropdown */}
                                    {organizations.length > 0 && (
                                        <div className="mb-4 bg-white dark:bg-purple-950/30 p-4 rounded-lg">
                                            <label className="block text-sm font-semibold text-purple-900 dark:text-purple-200 mb-2">
                                                Select Organization for Notifications:
                                            </label>
                                            <select
                                                value={selectedOrgFilter}
                                                onChange={(e) => setSelectedOrgFilter(e.target.value)}
                                                className="w-full px-3 py-2 border border-purple-300 dark:border-purple-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                                            >
                                                <option value="all">All Organizations</option>
                                                {organizations.map(org => {
                                                    const orgId = org._id?.$oid || org._id || org.id;
                                                    return (
                                                        <option key={orgId} value={orgId}>
                                                            {org.name}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                    )}
                                    
                                    <div className="flex items-center justify-between bg-white dark:bg-purple-950/30 p-4 rounded-lg">
                                        <div>
                                            <p className="text-sm font-semibold text-purple-900 dark:text-purple-200">Notification Status</p>
                                            <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
                                                {enabledNotificationOrgs.includes('all') 
                                                    ? "All organizations enabled" 
                                                    : selectedOrgFilter === 'all'
                                                    ? `${enabledNotificationOrgs.length} organization(s) enabled`
                                                    : enabledNotificationOrgs.includes(selectedOrgFilter)
                                                    ? "This organization is enabled"
                                                    : "This organization is disabled"
                                                }
                                            </p>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                setSavingNotificationSettings(true);
                                                try {
                                                    let newEnabledOrgs;
                                                    
                                                    if (selectedOrgFilter === 'all') {
                                                        // Toggle all organizations
                                                        if (enabledNotificationOrgs.includes('all')) {
                                                            newEnabledOrgs = []; // Disable all
                                                        } else {
                                                            newEnabledOrgs = ['all']; // Enable all
                                                        }
                                                    } else {
                                                        // Toggle specific organization
                                                        if (enabledNotificationOrgs.includes(selectedOrgFilter)) {
                                                            // Remove this org
                                                            newEnabledOrgs = enabledNotificationOrgs.filter(id => id !== selectedOrgFilter && id !== 'all');
                                                        } else {
                                                            // Add this org (remove 'all' if present)
                                                            newEnabledOrgs = [...enabledNotificationOrgs.filter(id => id !== 'all'), selectedOrgFilter];
                                                        }
                                                    }
                                                    
                                                    const response = await updateUserSettings({
                                                        enabledNotificationOrgs: newEnabledOrgs
                                                    });
                                                    if (response.success) {
                                                        setEnabledNotificationOrgs(newEnabledOrgs);
                                                        const actionText = selectedOrgFilter === 'all' 
                                                            ? (newEnabledOrgs.includes('all') ? 'enabled for all organizations' : 'disabled for all organizations')
                                                            : (newEnabledOrgs.includes(selectedOrgFilter) ? 'enabled for this organization' : 'disabled for this organization');
                                                        setSuccessMessage(`Notifications ${actionText}!`);
                                                        setTimeout(() => setSuccessMessage(''), 3000);
                                                    }
                                                } catch (err) {
                                                    console.error('Error updating notification settings:', err);
                                                    setError('Failed to update notification settings');
                                                } finally {
                                                    setSavingNotificationSettings(false);
                                                }
                                            }}
                                            disabled={savingNotificationSettings}
                                            className="px-6 py-2 !bg-purple-600 !text-white rounded-lg font-semibold hover:!bg-purple-700 transition-all hover:scale-105 !border-none disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {savingNotificationSettings ? 'Saving...' : (
                                                selectedOrgFilter === 'all'
                                                    ? (enabledNotificationOrgs.includes('all') ? 'Disable All' : 'Enable All')
                                                    : (enabledNotificationOrgs.includes(selectedOrgFilter) ? 'Disable' : 'Enable')
                                            )}
                                        </button>
                                    </div>
                                </div>
                            )}
                            
                            {/* Delete Organization Section */}
                            {(currentUser?.roles?.includes('super-admin') || currentUser?.organizationRole === 'admin') && (
                                <div className="bg-red-50 dark:bg-red-900/20 p-6 rounded-lg shadow-sm border-2 border-red-300 dark:border-red-700">
                                    <div className="flex items-start gap-3 mb-4">
                                        <span className="material-symbols-outlined text-red-600 dark:text-red-400 text-3xl">delete_forever</span>
                                        <div className="flex-1">
                                            <h3 className="text-lg font-semibold text-red-900 dark:text-red-200 mb-2">
                                                {currentUser?.roles?.includes('super-admin') ? 'Delete Organization' : 'Delete Your Organization'}
                                            </h3>
                                            <p className="text-sm text-red-700 dark:text-red-300 mb-4">
                                                <strong>Warning:</strong> This action is permanent and will delete all associated data including:
                                            </p>
                                            <ul className="text-sm text-red-700 dark:text-red-300 list-disc list-inside space-y-1 mb-4">
                                                <li>All committees in the organization</li>
                                                <li>All motions, comments, and votes</li>
                                                <li>All notifications</li>
                                                <li>User organization memberships (users themselves are not deleted)</li>
                                            </ul>
                                        </div>
                                    </div>
                                    
                                    {currentUser?.roles?.includes('super-admin') && organizations.length > 0 && (
                                        <div className="mb-4 bg-white dark:bg-red-950/30 p-4 rounded-lg">
                                            <label className="block text-sm font-semibold text-red-900 dark:text-red-200 mb-2">
                                                Select Organization to Delete:
                                            </label>
                                            <select
                                                value={deletingOrg || ''}
                                                onChange={(e) => setDeletingOrg(e.target.value || null)}
                                                className="w-full px-3 py-2 border border-red-300 dark:border-red-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-red-500 focus:border-transparent"
                                            >
                                                <option value="">-- Select an organization --</option>
                                                {organizations.map(org => {
                                                    const orgId = org._id?.$oid || org._id || org.id;
                                                    return (
                                                        <option key={orgId} value={orgId}>
                                                            {org.name}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>
                                    )}
                                    
                                    <button
                                        onClick={async () => {
                                            const orgToDelete = currentUser?.roles?.includes('super-admin') 
                                                ? deletingOrg 
                                                : currentUser?.organizationId;
                                            
                                            if (!orgToDelete) {
                                                setError('Please select an organization to delete');
                                                return;
                                            }
                                            
                                            const orgName = currentUser?.roles?.includes('super-admin')
                                                ? organizations.find(o => (o._id?.$oid || o._id || o.id) === orgToDelete)?.name
                                                : 'your organization';
                                            
                                            const confirmed = window.confirm(
                                                `Are you absolutely sure you want to delete ${orgName}?\n\n` +
                                                `This will permanently delete:\n` +
                                                `- All committees and motions\n` +
                                                `- All votes and comments\n` +
                                                `- All notifications\n` +
                                                `- User memberships\n\n` +
                                                `This action CANNOT be undone!\n\n` +
                                                `Type the organization name to confirm.`
                                            );
                                            
                                            if (!confirmed) return;
                                            
                                            const confirmName = window.prompt(
                                                `Type "${orgName}" to confirm deletion:`
                                            );
                                            
                                            if (confirmName !== orgName) {
                                                setError('Organization name did not match. Deletion cancelled.');
                                                return;
                                            }
                                            
                                            try {
                                                const result = await deleteOrganization(orgToDelete);
                                                if (result.success) {
                                                    setSuccessMessage(`Organization deleted: ${result.stats?.committees || 0} committees, ${result.stats?.motions || 0} motions`);
                                                    
                                                    // Refresh organizations list
                                                    if (currentUser?.roles?.includes('super-admin')) {
                                                        const orgsResponse = await fetch(`${API_BASE_URL}/organizations`, {
                                                            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                                                        });
                                                        if (orgsResponse.ok) {
                                                            const orgsData = await orgsResponse.json();
                                                            setOrganizations(orgsData.organizations || []);
                                                        }
                                                        setDeletingOrg(null);
                                                    } else {
                                                        // Org admin deleted their own org - they now have no organization
                                                        // Redirect to organization-deleted page
                                                        window.location.href = '/organization-deleted';
                                                    }
                                                    
                                                    setTimeout(() => setSuccessMessage(''), 5000);
                                                } else {
                                                    setError(result.error || 'Failed to delete organization');
                                                }
                                            } catch (err) {
                                                setError('Failed to delete organization: ' + err.message);
                                            }
                                        }}
                                        disabled={currentUser?.roles?.includes('super-admin') && !deletingOrg}
                                        className="px-6 py-2 !bg-red-600 !text-white rounded-lg font-semibold hover:!bg-red-700 transition-all hover:scale-105 !border-none disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        {currentUser?.roles?.includes('super-admin') ? 'Delete Selected Organization' : 'Delete My Organization'}
                                    </button>
                                </div>
                            )}
                            
                            {/* Delete User Account Section */}
                            <div className="bg-orange-50 dark:bg-orange-900/20 p-6 rounded-lg shadow-sm border-2 border-orange-300 dark:border-orange-700">
                                <div className="flex items-start gap-3 mb-4">
                                    <span className="material-symbols-outlined text-orange-600 dark:text-orange-400 text-3xl">person_remove</span>
                                    <div className="flex-1">
                                        <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-200 mb-2">Delete User Account</h3>
                                        <p className="text-sm text-orange-700 dark:text-orange-300 mb-4">
                                            Delete your own account or manage user deletions. This will:
                                        </p>
                                        <ul className="text-sm text-orange-700 dark:text-orange-300 list-disc list-inside space-y-1 mb-4">
                                            <li>Remove user from all committees</li>
                                            <li>Delete all votes and comments</li>
                                            <li>Delete all notifications</li>
                                            <li>Permanently remove the account</li>
                                        </ul>
                                    </div>
                                </div>
                                
                                <button
                                    onClick={async () => {
                                        const isOrgOwner = currentUser?.organizationRole === 'admin' && currentUser?.organizationId;
                                        
                                        let warningMessage = 'Are you sure you want to delete your account?\n\n' +
                                            'This will:\n' +
                                            '- Remove you from all committees\n' +
                                            '- Delete all your votes and comments\n' +
                                            '- Delete all your notifications\n';
                                        
                                        if (isOrgOwner) {
                                            warningMessage += '- DELETE YOUR ORGANIZATION (you are the owner)\n' +
                                                '- Cancel your subscription (mock)\n' +
                                                '- Remove all organization members\n' +
                                                '- Delete all committees and motions\n';
                                        }
                                        
                                        warningMessage += '- Log you out immediately\n\n' +
                                            'This action CANNOT be undone!';
                                        
                                        const confirmed = window.confirm(warningMessage);
                                        
                                        if (!confirmed) return;
                                        
                                        const confirmText = window.prompt(
                                            'Type "DELETE MY ACCOUNT" to confirm:'
                                        );
                                        
                                        if (confirmText !== 'DELETE MY ACCOUNT') {
                                            setError('Confirmation text did not match. Deletion cancelled.');
                                            return;
                                        }
                                        
                                        try {
                                            const result = await deleteUser(currentUser.id);
                                            if (result.success) {
                                                if (result.organizationDeleted) {
                                                    // console.log('Organization deleted:', result.organizationStats);
                                                    alert(
                                                        `Account and Organization Deleted\n\n` +
                                                        `Organization: ${result.organizationStats.organizationName}\n` +
                                                        `Committees deleted: ${result.organizationStats.committees}\n` +
                                                        `Motions deleted: ${result.organizationStats.motions}\n` +
                                                        `Subscription cancelled (mock)`
                                                    );
                                                }
                                                localStorage.removeItem('token');
                                                localStorage.removeItem('user');
                                                navigate('/login');
                                            } else {
                                                setError(result.message || 'Failed to delete account');
                                            }
                                        } catch (err) {
                                            setError('Failed to delete account: ' + err.message);
                                        }
                                    }}
                                    className="px-6 py-2 !bg-orange-600 !text-white rounded-lg font-semibold hover:!bg-orange-700 transition-all hover:scale-105 !border-none"
                                >
                                    Delete My Account
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit User Modal */}
            {editingUser && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="p-6">
                            <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                                Edit User Roles & Permissions
                            </h3>

                            <div className="space-y-6">
                                {/* Super Admin Toggle */}
                                {currentUser?.roles?.includes('super-admin') && (
                                    <div>
                                        <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                                            Platform Access
                                        </label>
                                        <label className="flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={editingUser.isSuperAdmin}
                                                onChange={handleSuperAdminToggle}
                                                className="mr-2 h-4 w-4 text-purple-600 focus:ring-purple-500 border-gray-300 rounded"
                                            />
                                            <span className="text-sm text-gray-700 dark:text-gray-300">
                                                Super Admin (Platform-level access)
                                            </span>
                                        </label>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">
                                            Can manage all organizations and users
                                        </p>
                                    </div>
                                )}

                                {/* Organization Role Section */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
                                        Organization Role
                                    </label>
                                    {editingUser.isOwner && (
                                        <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                                🔒 <strong>Organization Owner</strong> - This user owns the organization and must remain an admin. Transfer ownership to change their role.
                                            </p>
                                        </div>
                                    )}
                                    <div className="space-y-2">
                                        <label className="flex items-center">
                                            <input
                                                type="radio"
                                                name="organizationRole"
                                                value="admin"
                                                checked={editingUser.organizationRole === 'admin'}
                                                onChange={() => handleOrgRoleChange('admin')}
                                                disabled={editingUser.isOwner}
                                                className="mr-2 h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 disabled:opacity-50"
                                            />
                                            <span className={`text-sm ${editingUser.isOwner ? 'text-gray-500 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                                                Admin (Can manage organization settings and members)
                                            </span>
                                        </label>
                                        <label className="flex items-center">
                                            <input
                                                type="radio"
                                                name="organizationRole"
                                                value="member"
                                                checked={editingUser.organizationRole === 'member'}
                                                onChange={() => handleOrgRoleChange('member')}
                                                disabled={editingUser.isOwner}
                                                className="mr-2 h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 disabled:opacity-50"
                                            />
                                            <span className={`text-sm ${editingUser.isOwner ? 'text-gray-500 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                                                Member (Standard organization access)
                                            </span>
                                        </label>
                                    </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex justify-end gap-3 pt-4">
                                    <button
                                        onClick={handleCancelEdit}
                                        disabled={saving}
                                        className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-lg font-semibold hover:bg-gray-400 dark:hover:bg-gray-500 transition-all disabled:opacity-50"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={handleSaveUser}
                                        disabled={saving}
                                        className="px-4 py-2 !bg-lighter-green !text-white rounded-lg font-semibold hover:!bg-darker-green transition-all !border-none disabled:opacity-50"
                                    >
                                        {saving ? 'Saving...' : 'Save Changes'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export default AdminPanel;
