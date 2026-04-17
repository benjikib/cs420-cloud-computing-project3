const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   POST /auth/register
 * @desc    Register a new user
 * @access  Public
 */
router.post('/register',
  [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name').notEmpty().withMessage('Name is required')
  ],
  async (req, res) => {
    try {
      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { email, password, name, communityCode } = req.body;

      // Check if user already exists
      const existingUser = await User.findByEmail(email);
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: 'User with this email already exists'
        });
      }

      // Hash password
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      // Generate profile picture URL using DiceBear API
      const profilePictureUrl = `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(name)}&backgroundColor=54966D&textColor=ffffff`;

      const user = await User.create({
        email,
        password: hashedPassword,
        name,
        communityCode,
        picture: profilePictureUrl,
        roles: ['user'],
      });

      // Generate JWT token
      const token = jwt.sign(
        { userId: user._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.status(201).json({
        success: true,
        message: 'User registered successfully',
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
        }
      });
    } catch (error) {
      console.error('Registration error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error during registration'
      });
    }
  }
);

/**
 * @route   POST /auth/login
 * @desc    Login user and receive JWT token
 * @access  Public
 */
router.post('/login',
  [
    body('email').isEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required')
  ],
  async (req, res) => {
    try {
      console.log('Login request body:', req.body);
      console.log('Login request headers:', req.headers);

      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        console.log('Validation errors:', errors.array());
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { email, password } = req.body;

      // Find user by email
      const user = await User.findByEmail(email);
      if (!user) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Check if user has a password
      if (!user.password || typeof user.password !== 'string') {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      }

      // Generate JWT token
      const token = jwt.sign(
        { userId: user._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.json({
        success: true,
        message: 'Login successful',
        token,
        user: {
          id: user._id,
          email: user.email,
          name: user.name
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error during login'
      });
    }
  }
);

/**
 * @route   POST /auth/logout
 * @desc    Logout (invalidate token) - client-side should remove token
 * @access  Private
 */
router.post('/logout', authenticate, async (req, res) => {
  try {
    // In a JWT-based system, logout is typically handled client-side
    // The server can optionally maintain a blacklist of tokens
    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during logout'
    });
  }
});

/**
 * @route   GET /auth/me
 * @desc    Get current user info
 * @access  Private
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        bio: user.bio,
        phoneNumber: user.phoneNumber,
        address: user.address,
        picture: user.picture,
        communityCode: user.communityCode,
        roles: user.roles || ['user'],
        permissions: user.permissions || [],
        settings: user.settings || {
          theme: 'light',
          notifications: true,
          displayName: user.name
        },
        memberCommittees: user.memberCommittees || [],
        chairedCommittees: user.chairedCommittees || [],
        ownedCommittees: user.ownedCommittees || [],
        guestCommittees: user.guestCommittees || [],
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching user info'
    });
  }
});

/**
 * @route   GET /auth/settings
 * @desc    Get current user's settings
 * @access  Private
 */
router.get('/settings', authenticate, async (req, res) => {
  try {
    // Make sure req.user exists and has userId
    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // If user doesn't have settings, create default settings
    let settings = user.settings;
    if (!settings) {
      settings = {
        theme: 'light',
        notifications: true,
        displayName: user.name || 'User'
      };

      // Update user with default settings
      await User.updateSettings(req.user.userId, settings);
    }

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching settings'
    });
  }
});

/**
 * @route   PUT /auth/settings
 * @desc    Update current user's settings (theme, notifications)
 * @access  Private
 */
router.put('/settings', authenticate, async (req, res) => {
  try {
    const { theme, notifications } = req.body;

    const settingsUpdate = {};
    if (theme !== undefined) settingsUpdate.theme = theme;
    if (notifications !== undefined) settingsUpdate.notifications = notifications;

    const updatedUser = await User.updateSettings(req.user.userId, settingsUpdate);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: updatedUser.settings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating settings'
    });
  }
});

/**
 * @route   PUT /auth/profile
 * @desc    Update current user's profile (name, display name)
 * @access  Private
 */
router.put('/profile', authenticate, async (req, res) => {
  try {
    const { name, displayName } = req.body;

    if (!req.user || !req.user.userId) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const updates = {};

    // Update full name
    if (name !== undefined) {
      updates.name = name;
    }

    // Update display name in settings
    if (displayName !== undefined) {
      const settingsUpdate = { displayName };
      await User.updateSettings(req.user.userId, settingsUpdate);
    }

    // Update other user fields if provided
    if (Object.keys(updates).length > 0) {
      updates.updatedAt = new Date();
      await User.updateById(req.user.userId, updates);
    }

    // Fetch and return updated user
    const updatedUser = await User.findById(req.user.userId);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        name: updatedUser.name,
        bio: updatedUser.bio,
        phoneNumber: updatedUser.phoneNumber,
        address: updatedUser.address,
        picture: updatedUser.picture,
        communityCode: updatedUser.communityCode,
        settings: updatedUser.settings || {
          theme: 'light',
          notifications: true,
          displayName: updatedUser.name
        },
        roles: updatedUser.roles,
        createdAt: updatedUser.createdAt
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating profile'
    });
  }
});

/**
 * @route   GET /auth/users
 * @desc    Get all users (admin only, filtered by organization unless super-admin)
 * @access  Private (Admin only)
 */
router.get('/users', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');
    const isAdmin = req.user.roles && req.user.roles.includes('admin');

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    const users = await User.collection().find({}).toArray();

    const usersData = users.map(user => ({
      id: user._id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      roles: user.roles || ['user'],
      permissions: user.permissions || [],
      settings: user.settings || {
        theme: 'light',
        notifications: true,
        displayName: user.name
      },
      createdAt: user.createdAt
    }));

    res.json({
      success: true,
      users: usersData
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching users'
    });
  }
});

/**
 * @route   GET /auth/users/list
 * @desc    Get list of users for selection (authenticated users, filtered by organization unless super-admin)
 * @access  Private (authenticated)
 */
router.get('/users/list', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');
    const isAdmin = req.user.roles && req.user.roles.includes('admin');

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }
    const search = (req.query.search || '').trim();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    let filter = {};
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { name: regex },
        { email: regex },
        { 'settings.displayName': regex }
      ];
    }

    const total = await User.collection().countDocuments(filter);
    const users = await User.collection()
      .find(filter)
      .skip(skip)
      .limit(limit)
      .toArray();

    const usersData = users.map(u => ({
      _id: u._id,
      email: u.email,
      name: u.name,
      picture: u.picture,
      settings: u.settings
    }));

    res.json({ success: true, users: usersData, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get users list error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching users' });
  }
});

/**
 * @route   PUT /auth/users/:userId
 * @desc    Update a user's roles and permissions (admin only)
 * @access  Private (Admin only)
 */
router.put('/users/:userId', authenticate, async (req, res) => {
  try {
    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');
    const isAdmin = req.user.roles && req.user.roles.includes('admin');

    if (!isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    const { roles, permissions } = req.body;
    const { userId } = req.params;

    const updates = {};
    if (roles !== undefined) updates.roles = roles;
    if (permissions !== undefined) updates.permissions = permissions;
    updates.updatedAt = new Date();

    const updatedUser = await User.updateById(userId, updates);

    if (!updatedUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      user: {
        id: updatedUser._id,
        email: updatedUser.email,
        name: updatedUser.name,
        roles: updatedUser.roles,
        permissions: updatedUser.permissions
      }
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error updating user'
    });
  }
});

/**
 * @route   DELETE /auth/user/:userId
 * @desc    Delete user account (user can delete own account, admins can delete any)
 * @access  Private
 */
router.delete('/user/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.user.userId;
    
    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');
    const isAdmin = req.user.roles && req.user.roles.includes('admin');
    const isSelfDelete = String(requestingUserId) === String(userId);

    if (!isSelfDelete && !isSuperAdmin && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this user'
      });
    }

    // Get user before deletion
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Remove user from all committees
    const Committee = require('../models/Committee');
    const { getDB } = require('../config/database');
    const db = getDB();
    
    await db.collection('committees').updateMany(
      { 'members.userId': new ObjectId(userId) },
      { $pull: { members: { userId: new ObjectId(userId) } } }
    );

    // Delete user's votes
    await db.collection('votes').deleteMany({ userId: new ObjectId(userId) });

    // Delete user's comments
    await db.collection('comments').deleteMany({ author: new ObjectId(userId) });

    // Delete user's notifications
    const Notification = require('../models/Notification');
    await Notification.collection().deleteMany({ userId: new ObjectId(userId) });

    // Delete the user
    await User.deleteById(userId);

    res.json({ success: true, message: 'User account deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting user'
    });
  }
});

module.exports = router;
