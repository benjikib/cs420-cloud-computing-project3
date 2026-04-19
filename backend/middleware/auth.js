const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Committee = require('../models/Committee');

/**
 * HYBRID ADMIN ARCHITECTURE
 * =========================
 * This system supports two types of administrators:
 * 
 * 1. SUPER-ADMIN (Platform Level)
 *    - Role: roles: ['super-admin']
 *    - Scope: Platform-wide access
 *    - Use case: Developers, maintainers, platform operators
 *    - Filtering: No organizationId filtering - sees all data across all organizations
 *    - Assignment: Manually set in database (not through UI)
 * 
 * 2. ORGANIZATION ADMIN (Customer Level)
 *    - Role: organizationRole: 'admin'
 *    - Scope: Organization-scoped access only
 *    - Use case: Paying customers who manage their organization
 *    - Filtering: All queries filtered by organizationId - sees only their org's data
 *    - Assignment: Promoted by organization owner through OrganizationSettings UI
 * 
 * This separation ensures:
 * - Platform operators can maintain the system without being tied to organizations
 * - Customers can safely manage their organization without platform-wide privileges
 * - Clear security boundaries between platform and customer data
 */

/**
 * Middleware to verify JWT token and authenticate user
 */
async function authenticate(req, res, next) {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided. Authorization required.'
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from database
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Invalid token.'
      });
    }

    req.user = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      roles: user.roles || [],
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please login again.'
      });
    }

    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed.'
    });
  }
}

/**
 * Optional authentication - doesn't fail if no token provided
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.userId);

      if (user) {
        req.user = {
          userId: user.userId,
          email: user.email,
          name: user.name,
          roles: user.roles || [],
        };
      }
    }

    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
}

/**
 * Middleware to check if user has a specific permission or is an admin
 */
function requirePermissionOrAdmin(permission) {
  return async (req, res, next) => {
    try {
      // User must be authenticated first
      if (!req.user || !req.user.userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Get full user data including roles and permissions
      const user = await User.findById(req.user.userId);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user is any type of admin
      const isSuperAdmin = user.roles && user.roles.includes('super-admin');
      const isAdmin = user.roles && user.roles.includes('admin');
      const hasAdminPriv = isSuperAdmin || isAdmin;

      // Check if user has the specific permission
      const hasPermission = user.permissions && user.permissions.includes(permission);

      if (hasAdminPriv || hasPermission) {
        next();
      } else {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action'
        });
      }
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking permissions'
      });
    }
  };
}

/**
 * Middleware to check if user has a specific role
 */
function requireRole(role) {
  return async (req, res, next) => {
    try {
      // User must be authenticated first
      if (!req.user || !req.user.userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }

      // Get full user data including roles
      const user = await User.findById(req.user.userId);

      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'User not found'
        });
      }

      // Check if user has the required role
      const hasRole = user.roles && user.roles.includes(role);

      if (hasRole) {
        next();
      } else {
        return res.status(403).json({
          success: false,
          message: `This action requires ${role} role`
        });
      }
    } catch (error) {
      console.error('Role check error:', error);
      return res.status(500).json({
        success: false,
        message: 'Error checking role'
      });
    }
  };
}

/**
 * Middleware to check if user is a super-admin (platform maintainer/developer)
 * Super-admins have unrestricted access to all organizations and data
 */
function requireSuperAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');

    if (isSuperAdmin) {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: 'This action requires super-admin privileges'
      });
    }
  } catch (error) {
    console.error('Super-admin check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking super-admin privileges'
    });
  }
}

/**
 * Middleware to check if user is an organization admin
 * Organization admins have admin rights within their organization only
 */
function requireAnyAdmin(req, res, next) {
  try {
    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');
    const isAdmin = req.user.roles && req.user.roles.includes('admin');

    if (isSuperAdmin || isAdmin) {
      next();
    } else {
      return res.status(403).json({
        success: false,
        message: 'This action requires administrator privileges'
      });
    }
  } catch (error) {
    console.error('Admin check error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error checking administrator privileges'
    });
  }
}

/**
 * Helper function to check if user is a super-admin
 * Can be used within route handlers
 */
function isSuperAdmin(user) {
  return user && user.roles && user.roles.includes('super-admin');
}

/**
 * Helper function to check if user is an organization admin
 * Can be used within route handlers
 */
module.exports = {
  authenticate,
  optionalAuth,
  requirePermissionOrAdmin,
  requireRole,
  requireCommitteeChairOrPermission,
  requireSuperAdmin,
  requireAnyAdmin,
  isSuperAdmin,
};

/**
 * Middleware to allow either users with a permission/admin OR the chair of the target committee
 * Usage: requireCommitteeChairOrPermission('edit_any_committee')
 */
function requireCommitteeChairOrPermission(permission) {
  return async (req, res, next) => {
    try {
      if (!req.user || !req.user.userId) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // Get full user document
      const user = await User.findById(req.user.userId);
      if (!user) {
        return res.status(401).json({ success: false, message: 'User not found' });
      }

      // Check for any admin type (super-admin, admin, or org-admin)
      const isSuperAdmin = user.roles && user.roles.includes('super-admin');
      const isAdmin = user.roles && user.roles.includes('admin');
      const hasAdminPriv = isSuperAdmin || isAdmin;
      const hasPermission = user.permissions && user.permissions.includes(permission);

      if (hasAdminPriv || hasPermission) {
        return next();
      }

      // Determine committee identifier from params or body
      const committeeIdentifier = req.params.id || req.body.committeeId || req.body.id;
      if (!committeeIdentifier) {
        return res.status(400).json({ success: false, message: 'Committee identifier required' });
      }

      const committee = await Committee.findByIdOrSlug(committeeIdentifier);
      if (!committee) {
        return res.status(404).json({ success: false, message: 'Committee not found' });
      }

      // If the authenticated user is the committee chair (or owner) according to the committee.members list, allow
      const myRole = await Committee.getMemberRole(committee.committeeId, req.user.userId);
      if (myRole === 'chair' || myRole === 'owner') {
        return next();
      }

      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action' });
    } catch (error) {
      console.error('Committee chair/permission check error:', error);
      return res.status(500).json({ success: false, message: 'Error checking permissions' });
    }
  };
}
