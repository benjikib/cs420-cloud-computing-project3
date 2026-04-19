import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useNavigationBlock } from '../../context/NavigationContext';
import { getCurrentUser, hasRole, isAdmin } from '../../services/userApi';
import { getCommitteeById } from '../../services/committeeApi';

//   const SideBar = () => {
export default function SideBar() {

      const location = useLocation();
      const navigate = useNavigate();
      const { confirmNavigation } = useNavigationBlock();
      const [userIsChair, setUserIsChair] = useState(false);
      const [userIsAdmin, setUserIsAdmin] = useState(false);
        const [userIsGuest, setUserIsGuest] = useState(false);
            const [userIsOwner, setUserIsOwner] = useState(false);
        const [userIsMember, setUserIsMember] = useState(false);
      const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

      // Check if user is a chair
      useEffect(() => {
          async function checkUserRoles() {
              try {
                  const response = await getCurrentUser();
                  if (response && response.success) {
                      const user = response.user || {};
                      const hasChairRole = hasRole(user, 'chair');
                      const hasAdminRole = isAdmin(user);
                      const isSuperAdmin = hasRole(user, 'super-admin');

                      setUserIsAdmin(hasAdminRole);

                      // determine committee context (may change when location changes)
                      const committeeId = getNavigationContext().committeeId;

                      // member/guest/owner/chair status: prefer using committee.myRole if available
                      if (committeeId) {
                          try {
                              const committee = await getCommitteeById(committeeId);
                              const myRole = committee && committee.myRole ? committee.myRole : null;
                              // Super-admins and org-admins can act as chairs for all committees
                              setUserIsChair(hasChairRole || myRole === 'chair' || myRole === 'owner' || isSuperAdmin);
                              setUserIsOwner(myRole === 'owner');
                              setUserIsMember(myRole === 'member' || myRole === 'chair' || myRole === 'owner');
                              setUserIsGuest(myRole === 'guest');
                          } catch (e) {
                              // fallback to checking user arrays if committee lookup fails
                              setUserIsMember(committeeId && Array.isArray(user.memberCommittees) ? user.memberCommittees.map(String).includes(String(committeeId)) : false);
                              setUserIsGuest(committeeId && Array.isArray(user.guestCommittees) ? user.guestCommittees.map(String).includes(String(committeeId)) : false);
                              setUserIsChair(hasChairRole || isSuperAdmin);
                              setUserIsOwner(committeeId && Array.isArray(user.ownedCommittees) ? user.ownedCommittees.map(String).includes(String(committeeId)) : false);
                          }
                      } else {
                          setUserIsMember(false);
                          setUserIsGuest(false);
                          setUserIsChair(hasChairRole || isSuperAdmin);
                          setUserIsOwner(false);
                      }

                      // owner status
                      if (committeeId && Array.isArray(user.ownedCommittees)) {
                          setUserIsOwner(user.ownedCommittees.map(String).includes(String(committeeId)));
                      } else {
                          setUserIsOwner(false);
                      }
                  } else {
                      setUserIsChair(false);
                      setUserIsAdmin(false);
                      setUserIsGuest(false);
                      setUserIsMember(false);
                  }
              } catch (err) {
                  console.error('Error checking user roles/status:', err);
                  setUserIsChair(false);
                  setUserIsAdmin(false);
                  setUserIsGuest(false);
                  setUserIsMember(false);
              }
          }

          // Re-run when location changes so committee context updates correctly
          checkUserRoles();
      }, [location.pathname]);

      // Determine back navigation and committee context based on current path
      const getNavigationContext = () => {
          const path = location.pathname;

          // Check if we're on a motion details page: /committee/:id/motion/:motionId
          const motionMatch = path.match(/^\/committee\/([^\/]+)\/motion\/[^\/]+$/);
          if (motionMatch) {
              const committeeId = motionMatch[1];
              return {
                  backNav: {
                      label: 'Back to Committee',
                      path: `/committee/${committeeId}`
                  },
                  committeeId: committeeId,
                  showSettings: false,
                  showCreateCommittee: false
              };
          }

          // Check if we're on a committee settings page: /committee/:id/settings
          const settingsMatch = path.match(/^\/committee\/([^\/]+)\/settings$/);
          if (settingsMatch) {
              const committeeId = settingsMatch[1];
              return {
                  backNav: {
                      label: 'Back to Committee',
                      path: `/committee/${committeeId}`
                  },
                  committeeId: committeeId,
                  showSettings: false,
                  showCreateCommittee: false
              };
          }

          // Check if we're on a create motion page: /committee/:id/create-motion
          const createMotionMatch = path.match(/^\/committee\/([^\/]+)\/create-motion$/);
          if (createMotionMatch) {
              const committeeId = createMotionMatch[1];
              return {
                  backNav: {
                      label: 'Back to Committee',
                      path: `/committee/${committeeId}`
                  },
                  committeeId: committeeId,
                  showSettings: false,
                  showCreateCommittee: false
              };
          }

          // Check if we're on a create committee page: /create-committee
          if (path === '/create-committee') {
              return {
                  backNav: {
                      label: 'Committees',
                      path: '/committees'
                  },
                  committeeId: null,
                  showSettings: false,
                  showCreateCommittee: false
              };
          }

          // Check if we're on a committee page: /committee/:id (slug or ID)
          const committeeMatch = path.match(/^\/committee\/([^\/]+)$/);
          if (committeeMatch) {
              const committeeId = committeeMatch[1];
              return {
                  backNav: {
                      label: 'Committees',
                      path: '/committees'
                  },
                  committeeId: committeeId,
                  showSettings: true,
                  showCreateCommittee: false
              };
          }

          // Check if we're on the committees page: /committees
          if (path === '/committees') {
              return {
                  backNav: null,
                  committeeId: null,
                  showSettings: false,
                  showCreateCommittee: true
              };
          }

          return {
              backNav: null,
              committeeId: null,
              showSettings: false,
              showCreateCommittee: false
          };
      };

      const navContext = getNavigationContext();

      // Determine chair control path based on context
      const chairControlPath = navContext.committeeId && userIsChair 
          ? `/chair-control/${navContext.committeeId}`
          : '/chair-control';

      const navItems = [
          { path: '/home', label: 'Home', icon: 'home' },
          { path: '/committees', label: 'Committees', icon: 'groups' },
          ...(userIsChair
              ? [{ path: chairControlPath, label: 'Chair Control', icon: 'gavel' }]
              : []
          ),
          ...(userIsAdmin
              ? [{ path: '/admin', label: 'Admin Panel', icon: 'admin_panel_settings' }]
              : []
          ),
      ];

      // Check if there's any content to show in the light green section
      const hasContent = navContext.backNav || navContext.showSettings || navContext.showCreateCommittee;

      // Handle navigation with confirmation
      const handleNavigation = (e, path) => {
          if (!confirmNavigation()) {
              e.preventDefault();
          } else {
              setMobileMenuOpen(false);
          }
      };

      return (
          <>
              {/* Mobile hamburger button */}
              <button
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className="fixed top-4 left-4 z-50 lg:hidden w-12 h-12 flex items-center justify-center bg-darker-green text-white rounded-lg shadow-lg"
                  aria-label="Toggle menu"
              >
                  <span className="material-symbols-outlined text-2xl">
                      {mobileMenuOpen ? 'close' : 'menu'}
                  </span>
              </button>

              {/* Mobile overlay */}
              {mobileMenuOpen && (
                  <div
                      className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
                      onClick={() => setMobileMenuOpen(false)}
                  />
              )}

              <div className={`fixed top-0 left-0 z-40 h-screen flex-shrink-0 flex transition-transform duration-300 lg:translate-x-0 ${
                  mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
              }`}>
                  {/* Dark green section with icons */}
                  <div className="w-20 flex-shrink-0 h-screen bg-darker-green flex flex-col items-center pt-44 lg:pt-24 gap-6 overflow-hidden">
                      {navItems.map((item) => (
                          <Link
                              key={item.path}
                              to={item.path}
                              onClick={(e) => handleNavigation(e, item.path)}
                              title={item.label}
                              className={`flex items-center justify-center w-14 h-14 flex-shrink-0 rounded-lg transition-all ${
                                  location.pathname === item.path
                                      ? '!text-white scale-125'
                                      : '!text-superlight-green/60 hover:!text-superlight-green/90 hover:scale-110'
                              }`}
                          >
                              <span className={`material-symbols-outlined ${
                                  location.pathname === item.path ? 'text-4xl' : 'text-3xl'
                              }`}>{item.icon}</span>
                          </Link>
                      ))}
                  </div>

                  {/* Light green section for back navigation and committee controls */}
                  <div className={`flex-shrink-0 h-screen bg-lighter-green pt-44 lg:pt-24 transition-all duration-300 ease-in-out ${
                      hasContent ? 'w-44 px-4 opacity-100' : 'w-0 px-0 opacity-0'
                  } ${hasContent ? 'overflow-y-auto' : 'overflow-hidden'}`}>
                      {navContext.backNav && (
                          <Link
                              to={navContext.backNav.path}
                              onClick={(e) => handleNavigation(e, navContext.backNav.path)}
                              className="flex items-center gap-2 !text-gray-300 hover:!text-white transition-colors group mb-4"
                          >
                              <span className="material-symbols-outlined !text-gray-300 group-hover:!text-white text-2xl group-hover:translate-x-[-4px] transition-all">
                                  arrow_back
                              </span>
                              <span className="text-lg font-medium !text-gray-300 group-hover:!text-white">{navContext.backNav.label}</span>
                          </Link>
                      )}

                      {navContext.showSettings && navContext.committeeId && (
                          <>
                              {(userIsAdmin || userIsChair || (userIsMember && !userIsGuest)) && (
                                  <Link
                                      to={`/committee/${navContext.committeeId}/create-motion`}
                                      onClick={(e) => handleNavigation(e, `/committee/${navContext.committeeId}/create-motion`)}
                                      className="flex items-center gap-2 !text-gray-300 hover:!text-white transition-colors group mt-6"
                                  >
                                      <span className="material-symbols-outlined !text-gray-300 group-hover:!text-white text-2xl">
                                          add_circle
                                      </span>
                                      <span className="text-lg font-medium !text-gray-300 group-hover:!text-white">Create</span>
                                  </Link>
                              )}
                              {(userIsAdmin || userIsChair || userIsOwner) && (
                                  <Link
                                      to={`/committee/${navContext.committeeId}/settings`}
                                      onClick={(e) => handleNavigation(e, `/committee/${navContext.committeeId}/settings`)}
                                      className="flex items-center gap-2 !text-gray-300 hover:!text-white transition-colors group mt-2"
                                  >
                                      <span className="material-symbols-outlined !text-gray-300 group-hover:!text-white text-2xl">
                                          settings
                                      </span>
                                      <span className="text-lg font-medium !text-gray-300 group-hover:!text-white">Settings</span>
                                  </Link>
                              )}
                          </>
                      )}

                      {navContext.showCreateCommittee && userIsAdmin && (
                          <Link
                              to="/create-committee"
                              onClick={(e) => handleNavigation(e, '/create-committee')}
                              className="flex items-center gap-2 !text-gray-300 hover:!text-white transition-colors group mt-6"
                          >
                              <span className="material-symbols-outlined !text-gray-300 group-hover:!text-white text-2xl">
                                  add_circle
                              </span>
                              <span className="text-lg font-medium !text-gray-300 group-hover:!text-white">Create</span>
                          </Link>
                      )}
                  </div>
              </div>
          </>
      );
      
  };

//   export default SideBar;
