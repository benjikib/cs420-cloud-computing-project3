const express = require('express');
const { body, validationResult } = require('express-validator');
const { ObjectId } = require('mongodb');
const Committee = require('../models/Committee');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Comment = require('../models/Comment');
const Vote = require('../models/Vote');
const { authenticate, optionalAuth, requirePermissionOrAdmin, requireCommitteeChairOrPermission } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /committees/my-chairs
 * @desc    Get committees where current user is chair (or all committees for super-admins/org-admins)
 * @access  Private (requires authentication)
 */
router.get('/committees/my-chairs', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');

    let committees;

    if (isSuperAdmin) {
      committees = await Committee.collection().find({}).toArray();
    } else {
      committees = await Committee.collection()
        .find({ chair: userId })
        .toArray();
    }

    res.json({
      success: true,
      committees,
      total: committees.length
    });
  } catch (error) {
    console.error('Get chair committees error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching chair committees'
    });
  }
});

/**
 * @route   GET /committees/:page
 * @desc    Get all committees (paginated, filtered by organization unless super-admin)
 * @access  Public
 */
router.get('/committees/:page', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;

    const committees = await Committee.collection()
      .find({})
      .skip(skip)
      .limit(limit)
      .toArray();

    const total = await Committee.collection().countDocuments({});

    res.json({
      success: true,
      committees,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      total
    });
  } catch (error) {
    console.error('Get committees error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching committees'
    });
  }
});

/**
 * @route   GET /committee/:id/members
 * @desc    Get user objects for members of a committee (by slug or ID)
 * @access  Private (authenticated)
 */
router.get('/committee/:id/members', authenticate, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    // Map committee.members to user ids (supports legacy string ids and new objects)
    const userIds = (committee.members || []).map(m => (typeof m === 'string' || ObjectId.isValid(m)) ? String(m) : String(m.userId)).filter(Boolean);
    const users = userIds.length > 0 ? await User.collection().find({ _id: { $in: userIds.map(id => new ObjectId(id)) } }).toArray() : [];

    // Attach role to each returned user object for convenience
    const out = users.map(u => {
      const memberObj = (committee.members || []).find(m => (typeof m === 'string' || ObjectId.isValid(m)) ? String(m) === String(u._id) : String(m.userId) === String(u._id));
      const role = memberObj && (memberObj.role || (typeof memberObj === 'string' ? 'member' : 'member'));
      return { ...u, committeeRole: role };
    });

    res.json({ success: true, members: out });
  } catch (error) {
    console.error('Get committee members error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching committee members' });
  }
});

/**
 * @route   GET /committee/:id/potential-members
 * @desc    Get users that are not members of this committee (eligible to be added)
 * @access  Private (authenticated)
 */
router.get('/committee/:id/potential-members', authenticate, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const filter = { memberCommittees: { $ne: committee._id } };
    const total = await User.collection().countDocuments(filter);
    const users = await User.collection()
      .find(filter)
      .skip(skip)
      .limit(limit)
      .toArray();

    res.json({ success: true, users, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get potential members error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching potential members' });
  }
});

/**
 * @route   POST /committee/:id/member/add
 * @desc    Add a user to a committee (updates both committee and user documents)
 * @access  Private (Admin or edit_any_committee permission required)
 */
router.post('/committee/:id/member/add', authenticate, requireCommitteeChairOrPermission('edit_any_committee'), async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const { userId, role } = req.body;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'userId is required' });
    }

    // Default behaviour: add as member. Special-case 'chair' and 'guest'.
    if (role === 'chair') {
      // make them chair and ensure chairedCommittees + memberCommittees
      await Committee.addChair(committee._id, userId);
      await User.addChairedCommittee(userId, committee._id);
      // ensure they're in members too
      await Committee.addMemberWithRole(committee._id, userId, 'chair');
      await User.addMemberCommittee(userId, committee._id);

      // If there was a previous chair, remove the chairedCommittee entry for them
      const previousChair = committee.chair;
      if (previousChair && previousChair.toString() !== userId) {
        try {
          await User.removeChairedCommittee(previousChair, committee._id);
        } catch (e) {
          console.warn('Failed to remove previous chairedCommittee entry', e);
        }
      }
    } else if (role === 'guest') {
      // Guests are members but flagged as guests on the user document
      await Committee.addMemberWithRole(committee._id, userId, 'guest');
      await User.addMemberCommittee(userId, committee._id);
      try {
        await User.addGuestCommittee(userId, committee._id);
      } catch (e) {
        // non-fatal if method missing or fails
        console.warn('Failed to add guestCommittees entry for user', e);
      }
    } else {
      // Normal member
      await Committee.addMemberWithRole(committee._id, userId, 'member');
      await User.addMemberCommittee(userId, committee._id);
    }

    res.json({ success: true, message: 'Member added successfully' });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ success: false, message: 'Server error adding member' });
  }
});

/**
 * @route   DELETE /committee/:id/member/:userId
 * @desc    Remove a user from a committee (updates both committee and user documents)
 * @access  Private (Admin or edit_any_committee permission required)
 */
router.delete('/committee/:id/member/:userId', authenticate, requireCommitteeChairOrPermission('edit_any_committee'), async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const { userId } = req.params;
    await Committee.removeMember(committee._id, userId);
    await User.removeMemberCommittee(userId, committee._id);

    res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ success: false, message: 'Server error removing member' });
  }
});

/**
 * @route   GET /committee/:id
 * @desc    Get specific committee details (by slug or ID)
 * @access  Public
 */
router.get('/committee/:id', optionalAuth, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);

    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    // Sanitize committee object for JSON transport: convert ObjectId fields to strings
    const safeCommittee = Object.assign({}, committee);
    try {
      if (safeCommittee._id) safeCommittee._id = safeCommittee._id.toString();
      if (safeCommittee.owner) safeCommittee.owner = safeCommittee.owner.toString();
      if (safeCommittee.chair) safeCommittee.chair = safeCommittee.chair.toString();
    } catch (e) {
      // ignore conversion errors
    }

    // If authenticated, compute myRole for this user
    let myRole = null;
    try {
      if (req.headers && req.headers.authorization && req.user && req.user.userId) {
        // Because this route is public, req.user may not be set. Attempt to compute role.
        const userId = req.user.userId;
        myRole = await Committee.getMemberRole(safeCommittee._id, userId);
      }
    } catch (e) {
      // ignore errors in role computation
    }

    res.json({
      success: true,
      committee: safeCommittee,
      myRole
    });
  } catch (error) {
    console.error('Get committee error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching committee'
    });
  }
});

/**
 * @route   POST /committee/create
 * @desc    Create a new committee
 * @access  Public
 */
router.post('/committee/create',
  authenticate,
  requirePermissionOrAdmin('create_any_committee'),
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('description').notEmpty().withMessage('Description is required')
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

      const { title, description, members, chair } = req.body;

      const committee = await Committee.create({
        title,
        description,
        members: members || [],
        chair: chair || null,
      });

      // Persist user -> committee relationships for selected members and chair
      try {
        const committeeId = committee._id;

        // Normalize member IDs
        const normalizedMembers = Array.isArray(members) ? members.map(m => {
          if (!m) return null;
          if (typeof m === 'string') return { userId: m, role: 'member' };
          return { userId: m._id || m.id || m.userId, role: m.role || 'member' };
        }).filter(Boolean) : [];

        const uniqueMemberIds = [...new Set(normalizedMembers.map(m => String(m.userId)))];

        // Add memberCommittees entry for each selected member and persist guest/membership
        await Promise.all(uniqueMemberIds.map(async (userId) => {
          const mem = normalizedMembers.find(m => String(m.userId) === String(userId));
          await User.addMemberCommittee(userId, committeeId);
          if (mem && mem.role === 'guest') {
            await User.addGuestCommittee(userId, committeeId);
          }
        }));

        // If chair provided, ensure they have chairedCommittees and memberCommittees entries
        const chairId = chair || (committee.chair ? String(committee.chair) : null);
        if (chairId) {
          await User.addChairedCommittee(chairId, committeeId);
          if (!uniqueMemberIds.includes(String(chairId))) {
            await User.addMemberCommittee(chairId, committeeId);
          }
        }
      } catch (e) {
        // Non-fatal: log and continue. Frontend still receives created committee.
        console.warn('Failed to persist user<->committee relations on create:', e);
      }

      res.status(201).json({
        success: true,
        message: 'Committee created successfully',
        committee
      });
    } catch (error) {
      console.error('Create committee error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error creating committee'
      });
    }
  }
);

/**
 * @route   GET /committee/:id/settings
 * @desc    Get committee settings only (faster than full committee)
 * @access  Public
 */
router.get('/committee/:id/settings', async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);

    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    res.json({
      success: true,
      settings: committee.settings || {}
    });
  } catch (error) {
    console.error('Get committee settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching committee settings'
    });
  }
});

/**
 * @route   PATCH /committee/:id/settings
 * @desc    Update only committee settings (partial update)
 * @access  Private (Admin or edit_any_committee permission required)
 */
router.patch('/committee/:id/settings',
  authenticate,
  requirePermissionOrAdmin('edit_any_committee'),
  async (req, res) => {
    try {
      const committee = await Committee.findByIdOrSlug(req.params.id);

      if (!committee) {
        return res.status(404).json({
          success: false,
          message: 'Committee not found'
        });
      }

      const updatedCommittee = await Committee.updateById(committee._id, {
        settings: req.body
      });

      res.json({
        success: true,
        message: 'Committee settings updated successfully',
        settings: updatedCommittee.settings
      });
    } catch (error) {
      console.error('Update committee settings error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error updating committee settings'
      });
    }
  }
);

/**
 * @route   PUT /committee/:id
 * @desc    Update a committee (by slug or ID)
 * @access  Private (Admin or edit_any_committee permission required)
 */
router.put('/committee/:id',
  authenticate,
  requireCommitteeChairOrPermission('edit_any_committee'),
  [
    body('title').optional().notEmpty().withMessage('Title cannot be empty'),
    body('description').optional().notEmpty().withMessage('Description cannot be empty')
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

      const committee = await Committee.findByIdOrSlug(req.params.id);

      if (!committee) {
        return res.status(404).json({
          success: false,
          message: 'Committee not found'
        });
      }

      const updates = {};
      if (req.body.title) updates.title = req.body.title;
      if (req.body.description) updates.description = req.body.description;
      if (req.body.chair !== undefined) updates.chair = req.body.chair;
      if (req.body.settings) updates.settings = req.body.settings;

      const updatedCommittee = await Committee.updateById(committee._id, updates);

      res.json({
        success: true,
        message: 'Committee updated successfully',
        committee: updatedCommittee
      });
    } catch (error) {
      console.error('Update committee error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error updating committee'
      });
    }
  }
);

/**
 * @route   DELETE /committee/:id
 * @desc    Delete a committee (by slug or ID)
 * @access  Private (Admin or delete_any_committee permission required)
 */
router.delete('/committee/:id', authenticate, requirePermissionOrAdmin('delete_any_committee'), async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);

    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    // Delete the committee (this will also delete all embedded motions)
    await Committee.deleteById(committee._id);

    // Cascade delete all related data
    try {
      const committeeId = committee._id;

      // Delete all notifications related to this committee
      await Notification.collection().deleteMany({ committeeId: committeeId });

      // Delete all comments on motions in this committee
      // Comments have committeeId field
      await Comment.collection().deleteMany({ committeeId: committeeId });

      // Delete all votes on motions in this committee
      // Votes have committeeId field
      await Vote.collection().deleteMany({ committeeId: committeeId });

      console.log(`Deleted related notifications, comments, and votes for committee ${committeeId}`);
    } catch (e) {
      console.warn('Failed to delete related data after committee deletion:', e);
    }

    // Remove references from user documents by searching for users that reference this committee.
    // This is more robust than relying on `committee.members` being populated.
    try {
      const committeeId = committee._id;

      // Remove from memberCommittees
      await User.collection().updateMany(
        { memberCommittees: committeeId },
        { $pull: { memberCommittees: committeeId }, $set: { updatedAt: new Date() } }
      );

      // Remove from chairedCommittees
      await User.collection().updateMany(
        { chairedCommittees: committeeId },
        { $pull: { chairedCommittees: committeeId }, $set: { updatedAt: new Date() } }
      );

      // Remove from ownedCommittees
      await User.collection().updateMany(
        { ownedCommittees: committeeId },
        { $pull: { ownedCommittees: committeeId }, $set: { updatedAt: new Date() } }
      );

      // Remove from guestCommittees
      await User.collection().updateMany(
        { guestCommittees: committeeId },
        { $pull: { guestCommittees: committeeId }, $set: { updatedAt: new Date() } }
      );

      console.log(`Cleaned up user references for committee ${committeeId}`);
    } catch (e) {
      console.warn('Failed to clean up user references after committee deletion:', e);
    }

    res.json({
      success: true,
      message: 'Committee deleted successfully'
    });
  } catch (error) {
    console.error('Delete committee error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting committee'
    });
  }
});

module.exports = router;
