const express = require('express');
const { body, validationResult } = require('express-validator');
const Committee = require('../models/Committee');
const User = require('../models/User');
const { authenticate, optionalAuth, requirePermissionOrAdmin, requireCommitteeChairOrPermission } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /committees/my-chairs
 * @desc    Get committees where current user is chair (or all for super-admins)
 * @access  Private
 */
router.get('/committees/my-chairs', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');

    const committees = isSuperAdmin
      ? await Committee.findAll()
      : await Committee.findByChair(userId);

    res.json({ success: true, committees, total: committees.length });
  } catch (error) {
    console.error('Get chair committees error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching chair committees' });
  }
});

/**
 * @route   GET /committees/:page
 * @desc    Get all committees (paginated)
 * @access  Private
 */
router.get('/committees/:page', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const limit = 10;

    const all = await Committee.findAll();
    const total = all.length;
    const committees = all.slice((page - 1) * limit, page * limit);

    res.json({ success: true, committees, page, limit, totalPages: Math.ceil(total / limit), total });
  } catch (error) {
    console.error('Get committees error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching committees' });
  }
});

/**
 * @route   GET /committee/:id/members
 * @desc    Get user objects for members of a committee
 * @access  Private
 */
router.get('/committee/:id/members', authenticate, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const members = committee.members || [];
    const users = await Promise.all(
      members.map(async m => {
        const userId = typeof m === 'string' ? m : m.userId;
        const user = await User.findById(userId);
        if (!user) return null;
        return { ...user, committeeRole: m.role || 'member' };
      })
    );

    res.json({ success: true, members: users.filter(Boolean) });
  } catch (error) {
    console.error('Get committee members error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching committee members' });
  }
});

/**
 * @route   GET /committee/:id/potential-members
 * @desc    Get users not yet in this committee
 * @access  Private
 */
router.get('/committee/:id/potential-members', authenticate, async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const memberIds = new Set((committee.members || []).map(m =>
      String(typeof m === 'string' ? m : m.userId)
    ));

    const allUsers = await User.findAll();
    const eligible = allUsers.filter(u => !memberIds.has(String(u.userId)));
    const total = eligible.length;
    const users = eligible.slice((page - 1) * limit, page * limit);

    res.json({ success: true, users, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (error) {
    console.error('Get potential members error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching potential members' });
  }
});

/**
 * @route   POST /committee/:id/member/add
 * @desc    Add a user to a committee
 * @access  Private (chair or admin)
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

    const committeeId = committee.committeeId;

    if (role === 'chair') {
      await Committee.addChair(committeeId, userId);
      await User.addChairedCommittee(userId, committeeId);
      await User.addMemberCommittee(userId, committeeId);

      const previousChair = committee.chair;
      if (previousChair && String(previousChair) !== String(userId)) {
        await User.removeChairedCommittee(previousChair, committeeId).catch(() => {});
      }
    } else if (role === 'guest') {
      await Committee.addMemberWithRole(committeeId, userId, 'guest');
      await User.addMemberCommittee(userId, committeeId);
      await User.addGuestCommittee(userId, committeeId).catch(() => {});
    } else {
      await Committee.addMemberWithRole(committeeId, userId, 'member');
      await User.addMemberCommittee(userId, committeeId);
    }

    res.json({ success: true, message: 'Member added successfully' });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(500).json({ success: false, message: 'Server error adding member' });
  }
});

/**
 * @route   DELETE /committee/:id/member/:userId
 * @desc    Remove a user from a committee
 * @access  Private (chair or admin)
 */
router.delete('/committee/:id/member/:userId', authenticate, requireCommitteeChairOrPermission('edit_any_committee'), async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const { userId } = req.params;
    const committeeId = committee.committeeId;
    await Committee.removeMember(committeeId, userId);
    await User.removeMemberCommittee(userId, committeeId);

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
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    let myRole = null;
    if (req.user?.userId) {
      myRole = await Committee.getMemberRole(committee.committeeId, req.user.userId);
    }

    res.json({ success: true, committee, myRole });
  } catch (error) {
    console.error('Get committee error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching committee' });
  }
});

/**
 * @route   POST /committee/create
 * @desc    Create a new committee
 * @access  Private (admin or create_any_committee permission)
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
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const { title, description, members, chair } = req.body;

      const committee = await Committee.create({ title, description, members: members || [], chair: chair || null });
      const committeeId = committee.committeeId;

      try {
        const normalizedMembers = (members || []).map(m => {
          if (!m) return null;
          if (typeof m === 'string') return { userId: m, role: 'member' };
          return { userId: m._id || m.id || m.userId, role: m.role || 'member' };
        }).filter(Boolean);

        const uniqueMemberIds = [...new Set(normalizedMembers.map(m => String(m.userId)))];

        await Promise.all(uniqueMemberIds.map(async uid => {
          const mem = normalizedMembers.find(m => String(m.userId) === uid);
          await User.addMemberCommittee(uid, committeeId);
          if (mem?.role === 'guest') await User.addGuestCommittee(uid, committeeId);
        }));

        const chairId = chair ? String(chair) : null;
        if (chairId) {
          await User.addChairedCommittee(chairId, committeeId);
          if (!uniqueMemberIds.includes(chairId)) {
            await User.addMemberCommittee(chairId, committeeId);
          }
        }
      } catch (e) {
        console.warn('Failed to persist user<->committee relations on create:', e);
      }

      res.status(201).json({ success: true, message: 'Committee created successfully', committee });
    } catch (error) {
      console.error('Create committee error:', error);
      res.status(500).json({ success: false, message: 'Server error creating committee' });
    }
  }
);

/**
 * @route   GET /committee/:id/settings
 * @access  Public
 */
router.get('/committee/:id/settings', async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }
    res.json({ success: true, settings: committee.settings || {} });
  } catch (error) {
    console.error('Get committee settings error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching committee settings' });
  }
});

/**
 * @route   PATCH /committee/:id/settings
 * @access  Private (admin or edit_any_committee)
 */
router.patch('/committee/:id/settings',
  authenticate,
  requirePermissionOrAdmin('edit_any_committee'),
  async (req, res) => {
    try {
      const committee = await Committee.findByIdOrSlug(req.params.id);
      if (!committee) {
        return res.status(404).json({ success: false, message: 'Committee not found' });
      }

      const updatedCommittee = await Committee.updateById(committee.committeeId, { settings: req.body });
      res.json({ success: true, message: 'Committee settings updated successfully', settings: updatedCommittee.settings });
    } catch (error) {
      console.error('Update committee settings error:', error);
      res.status(500).json({ success: false, message: 'Server error updating committee settings' });
    }
  }
);

/**
 * @route   PUT /committee/:id
 * @access  Private (chair or admin)
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
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const committee = await Committee.findByIdOrSlug(req.params.id);
      if (!committee) {
        return res.status(404).json({ success: false, message: 'Committee not found' });
      }

      const updates = {};
      if (req.body.title) updates.title = req.body.title;
      if (req.body.description) updates.description = req.body.description;
      if (req.body.chair !== undefined) updates.chair = req.body.chair;
      if (req.body.settings) updates.settings = req.body.settings;

      const updatedCommittee = await Committee.updateById(committee.committeeId, updates);
      res.json({ success: true, message: 'Committee updated successfully', committee: updatedCommittee });
    } catch (error) {
      console.error('Update committee error:', error);
      res.status(500).json({ success: false, message: 'Server error updating committee' });
    }
  }
);

/**
 * @route   DELETE /committee/:id
 * @access  Private (admin or delete_any_committee)
 */
router.delete('/committee/:id', authenticate, requirePermissionOrAdmin('delete_any_committee'), async (req, res) => {
  try {
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }

    const committeeId = committee.committeeId;
    await Committee.deleteById(committeeId);

    // Clean up user references
    try {
      const allUsers = await User.findAll();
      await Promise.all(allUsers.map(async user => {
        const uid = user.userId;
        const inMember = (user.memberCommittees || []).includes(committeeId);
        const inChaired = (user.chairedCommittees || []).includes(committeeId);
        const inOwned = (user.ownedCommittees || []).includes(committeeId);
        const inGuest = (user.guestCommittees || []).includes(committeeId);

        if (inMember) await User.removeMemberCommittee(uid, committeeId);
        if (inChaired) await User.removeChairedCommittee(uid, committeeId);
        if (inOwned) await User.removeOwnedCommittee(uid, committeeId);
        if (inGuest) await User.removeGuestCommittee(uid, committeeId);
      }));
    } catch (e) {
      console.warn('Failed to clean up user references after committee deletion:', e);
    }

    res.json({ success: true, message: 'Committee deleted successfully' });
  } catch (error) {
    console.error('Delete committee error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting committee' });
  }
});

module.exports = router;
