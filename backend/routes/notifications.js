const express = require('express');
const { body, validationResult } = require('express-validator');
const Notification = require('../models/Notification');
const Committee = require('../models/Committee');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @route POST /notifications
 * @desc  Create a generic notification (messages, comments, etc.)
 * @access Private
 */
router.post('/notifications', authenticate, [
  body('type').optional().isString(),
  body('targetType').optional().isString(),
  body('targetId').optional().isString(),
  body('committeeId').optional().isString(),
  body('message').optional().isString()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const note = await Notification.create({
      type: req.body.type || 'message',
      committeeId: req.body.committeeId || null,
      committeeTitle: req.body.committeeTitle || null,
      requesterId: user.userId,
      requesterName: user.name,
      message: req.body.message || null,
      targetType: req.body.targetType || null,
      targetId: req.body.targetId || null,
      metadata: req.body.metadata || null,
      status: req.body.status || 'seen'
    });

    res.status(201).json({ success: true, notification: note });
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ success: false, message: 'Server error creating notification' });
  }
});

/**
 * @route GET /notifications/target
 * @desc  Get notifications for a specific target (e.g., motion comments)
 * @access Private
 */
router.get('/notifications/target', authenticate, async (req, res) => {
  try {
    const { targetType, targetId } = req.query;
    if (!targetType || !targetId) return res.status(400).json({ success: false, message: 'targetType and targetId are required' });

    const items = await Notification.findByTarget(targetType, targetId);
    items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({ success: true, notifications: items });
  } catch (error) {
    console.error('Get target notifications error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching notifications for target' });
  }
});

/**
 * @route POST /committee/:id/request-access
 * @desc  Request access to a committee
 * @access Private
 */
router.post('/committee/:id/request-access',
  authenticate,
  [body('message').optional().isString().trim()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

      const committee = await Committee.findByIdOrSlug(req.params.id);
      if (!committee) return res.status(404).json({ success: false, message: 'Committee not found' });

      const requester = await User.findById(req.user.userId);
      if (!requester) return res.status(404).json({ success: false, message: 'User not found' });

      // Prevent duplicate pending requests
      const existing = await Notification.findPendingAccessRequest(committee.committeeId, requester.userId);
      if (existing) {
        return res.status(409).json({ success: false, message: 'Access request already pending' });
      }

      const note = await Notification.create({
        type: 'access_request',
        committeeId: committee.committeeId,
        committeeTitle: committee.title,
        requesterId: requester.userId,
        requesterName: requester.name,
        message: req.body.message || null,
        status: 'pending'
      });

      res.status(201).json({ success: true, message: 'Access request created', notification: note });
    } catch (error) {
      console.error('Request access error:', error);
      res.status(500).json({ success: false, message: 'Server error creating access request' });
    }
  }
);

/**
 * @route GET /notifications
 * @desc  Get notifications relevant to the current user
 *        - Requesters see their own submitted notifications
 *        - Chairs/owners see access requests for their committees
 *        - Admins see everything
 * @access Private
 */
router.get('/notifications', authenticate, async (req, res) => {
  try {
    const userId = req.user.userId;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const isSuperAdmin = req.user.roles && req.user.roles.includes('super-admin');
    const isAdmin = req.user.roles && req.user.roles.includes('admin');

    // Get committees this user chairs
    const chairedCommittees = await Committee.findByChair(userId);
    const chairedIds = new Set(chairedCommittees.map(c => c.committeeId));

    // Also include committees where user has 'chair' or 'owner' role in members list
    const memberCommitteeIds = new Set(user.memberCommittees || []);

    let all;
    if (isSuperAdmin || isAdmin) {
      all = await Notification.findAll();
    } else {
      all = await Notification.findAll();
      all = all.filter(n => {
        // User is the requester
        if (n.requesterId && String(n.requesterId) === userId) return true;
        // User chairs the committee this notification is for
        if (n.committeeId && chairedIds.has(String(n.committeeId))) return true;
        // User is a member of the committee
        if (n.committeeId && memberCommitteeIds.has(String(n.committeeId))) return true;
        return false;
      });
    }

    // Filter expired/resolved notifications
    const now = new Date();
    const threshold = new Date(now.getTime() - 30 * 60 * 1000);

    const filtered = all.filter(item => {
      if (item.type === 'meeting_scheduled') return true;

      if (item.type === 'voting_opened' || item.type === 'voting_deadline_approaching') {
        if (!item.seenAt) return true;
        if (new Date(item.seenAt) >= threshold) return true;
        return false;
      }

      if (item.type === 'access_request') {
        return item.status === 'pending';
      }

      if (item.status === 'pending') return true;
      if (item.seenAt && new Date(item.seenAt) >= threshold) return true;
      if (item.handledAt && new Date(item.handledAt) >= threshold) return true;
      return false;
    });

    filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;
    const paginated = filtered.slice(skip, skip + limit);

    res.json({ success: true, notifications: paginated, page, limit, total: filtered.length, totalPages: Math.ceil(filtered.length / limit) });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching notifications' });
  }
});

/**
 * @route PUT /notifications/:id
 * @desc  Handle a notification: approve, deny, or mark_seen
 * @access Private
 */
router.put('/notifications/:id', authenticate, async (req, res) => {
  try {
    const { action } = req.body;
    if (!action || !['approve', 'deny', 'mark_seen'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action' });
    }

    const note = await Notification.findById(req.params.id);
    if (!note) return res.status(404).json({ success: false, message: 'Notification not found' });

    const user = await User.findById(req.user.userId);
    const isSuperAdmin = user.roles && user.roles.includes('super-admin');
    const isAdmin = user.roles && user.roles.includes('admin');
    const hasAdminPriv = isSuperAdmin || isAdmin;

    let allowed = false;
    if (hasAdminPriv) {
      allowed = true;
    } else if (note.committeeId) {
      const committee = await Committee.findById(note.committeeId);
      if (committee) {
        const role = await Committee.getMemberRole(committee.committeeId, req.user.userId);
        if (role === 'chair' || role === 'owner') allowed = true;
      }
    }

    if (action === 'mark_seen') {
      // Requester can mark their own notifications seen
      if (note.requesterId && String(note.requesterId) === req.user.userId) allowed = true;
      // Any committee member can mark seen
      if (!allowed && note.committeeId) {
        const committee = await Committee.findById(note.committeeId);
        if (committee) {
          const role = await Committee.getMemberRole(committee.committeeId, req.user.userId);
          if (role) allowed = true;
        }
      }
    }

    if (!allowed) return res.status(403).json({ success: false, message: 'Not authorized to handle this notification' });

    if (action === 'approve') {
      try {
        await Committee.addMemberWithRole(note.committeeId, note.requesterId, 'guest');
        await User.addMemberCommittee(note.requesterId, note.committeeId);
        await User.addGuestCommittee(note.requesterId, note.committeeId).catch(() => {});
      } catch (e) {
        console.warn('Failed to add member during approval:', e);
      }
      const updated = await Notification.updateById(note.notificationId, { status: 'approved', handledBy: req.user.userId, handledAt: new Date() });
      return res.json({ success: true, message: 'Request approved', notification: updated });
    }

    if (action === 'deny') {
      const updated = await Notification.updateById(note.notificationId, { status: 'denied', handledBy: req.user.userId, handledAt: new Date() });
      return res.json({ success: true, message: 'Request denied', notification: updated });
    }

    if (action === 'mark_seen') {
      const updated = await Notification.updateById(note.notificationId, { seenAt: new Date() });
      return res.json({ success: true, message: 'Notification marked seen', notification: updated });
    }

    res.status(400).json({ success: false, message: 'Unhandled action' });
  } catch (error) {
    console.error('Handle notification error:', error);
    res.status(500).json({ success: false, message: 'Server error handling notification' });
  }
});

module.exports = router;
