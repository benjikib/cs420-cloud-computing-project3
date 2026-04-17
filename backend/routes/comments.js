const express = require('express');
const { body, validationResult } = require('express-validator');
const Comment = require('../models/Comment');
const Committee = require('../models/Committee');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /committee/:id/motion/:motionId/comments/:page
 * @desc    Get all comments (paginated)
 * @access  Private
 */
router.get('/committee/:id/motion/:motionId/comments/:page', authenticate, async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const limit = 20;

    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({ success: false, message: 'Committee not found' });
    }
    const motion = await Committee.findMotionById(committee.committeeId, req.params.motionId);
    if (!motion) {
      return res.status(404).json({ success: false, message: 'Motion not found' });
    }

    const result = await Comment.findByMotion(req.params.motionId, page, limit);

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({ success: false, message: 'Server error fetching comments' });
  }
});

/**
 * @route   POST /committee/:id/motion/:motionId/comment/create
 * @desc    Create a comment
 * @access  Private
 */
router.post('/committee/:id/motion/:motionId/comment/create',
  authenticate,
  [
    body('content').notEmpty().withMessage('Comment content is required'),
    body('stance').optional().isIn(['pro', 'con', 'neutral']).withMessage('Invalid stance value')
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
      const motion = await Committee.findMotionById(committee.committeeId, req.params.motionId);
      if (!motion) {
        return res.status(404).json({ success: false, message: 'Motion not found' });
      }

      const role = await Committee.getMemberRole(committee.committeeId, req.user.userId);
      if (!role || role === 'guest') {
        return res.status(403).json({ success: false, message: 'You must be a member of this committee to comment' });
      }

      const { content, stance } = req.body;

      const comment = await Comment.create({
        motionId: req.params.motionId,
        committeeId: committee.committeeId,
        author: req.user.userId,
        content,
        stance: stance || 'neutral'
      });

      res.status(201).json({ success: true, message: 'Comment created successfully', comment });
    } catch (error) {
      console.error('Create comment error:', error);
      res.status(500).json({ success: false, message: 'Server error creating comment' });
    }
  }
);

/**
 * @route   PUT /committee/:id/motion/:motionId/comment/:commentId
 * @desc    Update a comment (author only)
 * @access  Private
 */
router.put('/committee/:id/motion/:motionId/comment/:commentId',
  authenticate,
  [
    body('content').optional().notEmpty().withMessage('Comment content cannot be empty'),
    body('stance').optional().isIn(['pro', 'con', 'neutral']).withMessage('Invalid stance value')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const comment = await Comment.findById(req.params.commentId);
      if (!comment) {
        return res.status(404).json({ success: false, message: 'Comment not found' });
      }

      if (comment.author !== req.user.userId) {
        return res.status(403).json({ success: false, message: 'Not authorized to update this comment' });
      }

      const updates = {};
      if (req.body.content) updates.content = req.body.content;
      if (req.body.stance) updates.stance = req.body.stance;

      const updatedComment = await Comment.updateById(req.params.commentId, updates);

      res.json({ success: true, message: 'Comment updated successfully', comment: updatedComment });
    } catch (error) {
      console.error('Update comment error:', error);
      res.status(500).json({ success: false, message: 'Server error updating comment' });
    }
  }
);

/**
 * @route   DELETE /committee/:id/motion/:motionId/comment/:commentId
 * @desc    Delete a comment (author or chair)
 * @access  Private
 */
router.delete('/committee/:id/motion/:motionId/comment/:commentId', authenticate, async (req, res) => {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (comment.author !== req.user.userId && committee?.chair !== req.user.userId) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this comment' });
    }

    await Comment.deleteById(req.params.commentId);

    res.json({ success: true, message: 'Comment deleted successfully' });
  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ success: false, message: 'Server error deleting comment' });
  }
});

module.exports = router;
