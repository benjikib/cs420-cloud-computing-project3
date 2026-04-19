const express = require('express');
const { body, validationResult } = require('express-validator');
const Committee = require('../models/Committee');
const User = require('../models/User');
const { authenticate, requirePermissionOrAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /committee/:id/motions/:page
 * @desc    Get all motions in committee (paginated, by slug or ID)
 * @query   ?type=motionType&status=active&targetMotion=motionId
 * @access  Public
 */
router.get('/committee/:id/motions/:page', async (req, res) => {
  try {
    const page = parseInt(req.params.page) || 1;
    const limit = 10;
    const { type, status, targetMotion } = req.query;

    // Verify committee exists
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    // Define subsidiary motion types (per CreateMotionPage list)
    const subsidiaryTypes = ['amend', 'refer_to_committee', 'postpone', 'limit_debate', 'previous_question', 'table'];
    const includeSubsidiaries = req.query.includeSubsidiaries === 'true' || !!targetMotion || (type && subsidiaryTypes.includes(type));
    let result = await Committee.findMotions(committee.committeeId, page, limit, { includeSubsidiaries, type, status, targetMotion });

    // Filters handled in Committee.findMotions; result is already paginated and filtered

    // Populate author information for each motion
    const motionsWithAuthors = await Promise.all(
      result.motions.map(async (motion) => {
        if (motion.author) {
          try {
            const authorId = typeof motion.author === 'string' ? motion.author : motion.author.toString();
            const author = await User.findById(authorId);

            return {
              ...motion,
              authorInfo: author ? {
                id: author.userId,
                name: author.settings?.displayName || author.name,
                email: author.email,
                picture: author.picture
              } : null
            };
          } catch (err) {
            console.error('Error fetching author for motion:', motion.title, err);
            return motion;
          }
        }
        return motion;
      })
    );

    res.json({
      success: true,
      ...result,
      motions: motionsWithAuthors,
      filters: { type, status, targetMotion } // Include applied filters in response
    });
  } catch (error) {
    console.error('Get motions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching motions'
    });
  }
});

/**
 * @route   GET /committee/:id/motion/:motionId
 * @desc    Get specific motion details (committee by slug or ID)
 * @access  Public
 */
router.get('/committee/:id/motion/:motionId', async (req, res) => {
  try {
    // Verify committee exists and get its ID
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    const motion = await Committee.findMotionById(committee.committeeId, req.params.motionId);

    if (!motion) {
      return res.status(404).json({
        success: false,
        message: 'Motion not found'
      });
    }

    // Populate author information
    let motionWithAuthor = motion;
    if (motion.author) {
      try {
        const authorId = typeof motion.author === 'string' ? motion.author : motion.author.toString();
        const author = await User.findById(authorId);
        motionWithAuthor = {
          ...motion,
          authorInfo: author ? {
            id: author.userId,
            name: author.settings?.displayName || author.name,
            email: author.email,
            picture: author.picture
          } : null
        };
      } catch (err) {
        console.error('Error fetching author:', err);
      }
    }

    res.json({
      success: true,
      motion: motionWithAuthor
    });
  } catch (error) {
    console.error('Get motion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching motion'
    });
  }
});

/**
 * @route   POST /committee/:id/motion/create
 * @desc    Create a new motion (committee by slug or ID)
 * @access  Private (requires authentication)
 */
router.post('/committee/:id/motion/create',
  authenticate,
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

      // Verify committee exists
      const committee = await Committee.findByIdOrSlug(req.params.id);
      if (!committee) {
        return res.status(404).json({
          success: false,
          message: 'Committee not found'
        });
      }

      const { title, description, fullDescription, amendTargetMotionId, targetMotionId, motionType, motionTypeLabel, debatable, amendable, voteRequired, isAnonymous } = req.body;

      // Create motion with userId reference
      // Disallow guest users from creating motions in this committee
      try {
        const role = await Committee.getMemberRole(committee.committeeId, req.user.userId);
        if (role === 'guest') {
          return res.status(403).json({ success: false, message: 'Guest members are not allowed to create motions in this committee' });
        }
      } catch (e) {
        console.warn('Failed to verify member role for user:', e);
      }

      // Get committee settings
      const settings = committee.settings || {};

      // Check if multiple active motions are allowed
      const isMainMotion = (motionType || 'main') === 'main' && !targetMotionId && !amendTargetMotionId;
      if (isMainMotion && settings.allowMultipleActiveMotions === false) {
        // Check if there's already an active main motion
        const existingActiveMotions = committee.motions?.filter(m => 
          m.status === 'active' && 
          (m.motionType === 'main' || !m.motionType) &&
          !m.targetMotionId &&
          !m.amendTargetMotionId
        ) || [];
        
        if (existingActiveMotions.length > 0) {
          return res.status(400).json({
            success: false,
            message: 'Only one active main motion is allowed at a time. Please wait for the current motion to be resolved.',
            activeMotion: existingActiveMotions[0]
          });
        }
      }

      // Check if anonymous motions are allowed
      if (isAnonymous && !settings.allowAnonymousMotions) {
        return res.status(400).json({
          success: false,
          message: 'Anonymous motions are not allowed in this committee'
        });
      }

      const motion = await Committee.createMotion(committee.committeeId, {
        title,
        description,
        fullDescription: fullDescription || description,
        author: req.user ? req.user.userId : null,
        motionType: motionType || 'main',
        motionTypeLabel: motionTypeLabel || 'Main Motion',
        debatable: typeof debatable === 'boolean' ? debatable : true,
        amendable: typeof amendable === 'boolean' ? amendable : true,
        voteRequired: voteRequired || 'majority',
        targetMotionId: targetMotionId || amendTargetMotionId || null,
        amendTargetMotionId: amendTargetMotionId || null,
        isAnonymous: isAnonymous || false
      });

      // Populate author information for response
      let motionWithAuthor = motion;
      if (motion.author) {
        try {
          const author = await User.findById(motion.author);
          if (author) {
            motionWithAuthor = {
              ...motion,
              authorInfo: {
                id: author.userId,
                name: author.settings?.displayName || author.name,
                email: author.email,
                picture: author.picture
              }
            };
          }
        } catch (err) {
          console.error('Error fetching author for new motion:', err);
        }
      }

      res.status(201).json({
        success: true,
        message: 'Motion created successfully',
        motion: motionWithAuthor
      });
    } catch (error) {
      console.error('Create motion error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error creating motion'
      });
    }
  }
);

/**
 * @route   PUT /committee/:id/motion/:motionId
 * @desc    Update a motion (committee by slug or ID)
 * @access  Private (Admin or edit_any_motion permission required)
 */
router.put('/committee/:id/motion/:motionId',
  authenticate,
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

      // Verify committee exists
      const committee = await Committee.findByIdOrSlug(req.params.id);
      if (!committee) {
        return res.status(404).json({
          success: false,
          message: 'Committee not found'
        });
      }

      const motion = await Committee.findMotionById(committee.committeeId, req.params.motionId);

      if (!motion) {
        return res.status(404).json({
          success: false,
          message: 'Motion not found'
        });
      }

      // Authorization: allow admin, chair, users with edit_any_motion permission, or the motion author.
      let currentUser = null;
      try {
        currentUser = await User.findById(req.user.userId);
      } catch (e) {
        currentUser = null;
      }

      const isSuperAdmin = currentUser && currentUser.roles && currentUser.roles.includes('super-admin');
      const isAdmin = currentUser && currentUser.roles && currentUser.roles.includes('admin');
      const hasAdminPriv = isSuperAdmin || isAdmin;
      const canEditAny = currentUser && currentUser.permissions && currentUser.permissions.includes('edit_any_motion');
      const isAuthor = motion.author && String(motion.author) === String(req.user.userId);
      const isChair = await Committee.isChair(committee.committeeId, req.user.userId);

      if (!hasAdminPriv && !canEditAny && !isAuthor && !isChair) {
        return res.status(403).json({ success: false, message: 'You are not authorized to edit this motion' });
      }

      const updates = {};
      if (req.body.title) updates.title = req.body.title;
      if (req.body.description) updates.description = req.body.description;
      if (req.body.fullDescription) updates.fullDescription = req.body.fullDescription;
      if (req.body.status) updates.status = req.body.status;
      if (req.body.votingStatus !== undefined) updates.votingStatus = req.body.votingStatus;
      if (req.body.votingClosedAt !== undefined) updates.votingClosedAt = req.body.votingClosedAt;
      if (req.body.motionType) updates.motionType = req.body.motionType;
      if (req.body.motionTypeLabel) updates.motionTypeLabel = req.body.motionTypeLabel;
      if (req.body.debatable !== undefined) updates.debatable = req.body.debatable;
      if (req.body.amendable !== undefined) updates.amendable = req.body.amendable;
      if (req.body.voteRequired) updates.voteRequired = req.body.voteRequired;
      // Support new canonical targetMotionId and legacy amendTargetMotionId
      if (req.body.targetMotionId !== undefined) updates.targetMotionId = req.body.targetMotionId;
      if (req.body.amendTargetMotionId !== undefined) updates.amendTargetMotionId = req.body.amendTargetMotionId;

      const updatedMotion = await Committee.updateMotion(committee.committeeId, req.params.motionId, updates);

      res.json({
        success: true,
        message: 'Motion updated successfully',
        motion: updatedMotion
      });
    } catch (error) {
      console.error('Update motion error:', error);
      res.status(500).json({
        success: false,
        message: 'Server error updating motion'
      });
    }
  }
);

/**
 * @route   DELETE /committee/:id/motion/:motionId
 * @desc    Delete a motion (committee by slug or ID)
 * @access  Private (Admin or delete_any_motion permission required)
 */
router.delete('/committee/:id/motion/:motionId', authenticate, async (req, res) => {
  try {
    // Verify committee exists
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    const motion = await Committee.findMotionById(committee.committeeId, req.params.motionId);

    if (!motion) {
      return res.status(404).json({
        success: false,
        message: 'Motion not found'
      });
    }

    // Authorization: allow admin, users with delete_any_motion permission, or the motion author.
    let currentUser = null;
    try {
      currentUser = await User.findById(req.user.userId);
    } catch (e) {
      currentUser = null;
    }

    const isAdmin = currentUser && currentUser.roles && currentUser.roles.includes('admin');
    const canDeleteAny = currentUser && currentUser.permissions && currentUser.permissions.includes('delete_any_motion');
    const isAuthor = motion.author && String(motion.author) === String(req.user.userId);

    if (!isAdmin && !canDeleteAny && !isAuthor) {
      return res.status(403).json({ success: false, message: 'You are not authorized to delete this motion' });
    }

    await Committee.deleteMotion(committee.committeeId, req.params.motionId);

    res.json({
      success: true,
      message: 'Motion deleted successfully'
    });
  } catch (error) {
    console.error('Delete motion error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error deleting motion'
    });
  }
});

/**
 * @route   GET /committee/:id/motion/:motionId/subsidiaries
 * @desc    Get all subsidiary motions affecting a specific motion
 * @access  Public
 */
router.get('/committee/:id/motion/:motionId/subsidiaries', async (req, res) => {
  try {
    // Verify committee exists
    const committee = await Committee.findByIdOrSlug(req.params.id);
    if (!committee) {
      return res.status(404).json({
        success: false,
        message: 'Committee not found'
      });
    }

    // Verify target motion exists
    const targetMotion = await Committee.findMotionById(committee.committeeId, req.params.motionId);
    if (!targetMotion) {
      return res.status(404).json({
        success: false,
        message: 'Target motion not found'
      });
    }

    // Find all motions where targetMotionId (or legacy amendTargetMotionId) matches this motion
    const allMotions = await Committee.findMotions(committee.committeeId, 1, 1000, { includeSubsidiaries: true }); // Get all motions
    const subsidiaryMotions = allMotions.motions.filter(m => {
      const targetId = m.targetMotionId || m.amendTargetMotionId;
      return targetId && targetId.toString && targetId.toString() === req.params.motionId.toString();
    });

    // Populate author information
    const motionsWithAuthors = await Promise.all(
      subsidiaryMotions.map(async (motion) => {
        if (motion.author) {
          try {
            const authorId = typeof motion.author === 'string' ? motion.author : motion.author.toString();
            const author = await User.findById(authorId);

            return {
              ...motion,
              authorInfo: author ? {
                id: author.userId,
                name: author.settings?.displayName || author.name,
                email: author.email,
                picture: author.picture
              } : null
            };
          } catch (err) {
            console.error('Error fetching author:', err);
            return motion;
          }
        }
        return motion;
      })
    );

    res.json({
      success: true,
      targetMotion: {
        id: targetMotion.motionId,
        title: targetMotion.title
      },
      subsidiaryMotions: motionsWithAuthors,
      total: motionsWithAuthors.length
    });
  } catch (error) {
    console.error('Get subsidiary motions error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error fetching subsidiary motions'
    });
  }
});

module.exports = router;
