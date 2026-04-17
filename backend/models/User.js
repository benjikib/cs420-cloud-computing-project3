const { ObjectId } = require('mongodb');
const { getDB } = require('../config/database');

class User {
  static collection() {
    return getDB().collection('users');
  }

  static async create(userData) {
    const user = {
      email: userData.email,
      emailVerified: userData.emailVerified || false,

      // Authentication
      password: userData.password || null, // Should be hashed before passing here

      // Basic profile
      name: userData.name,
      nickname: userData.nickname || null,
      picture: userData.picture || userData.profilePicture || null,

      // Community info
      communityCode: userData.communityCode || null,
      bio: userData.bio || '',
      phoneNumber: userData.phoneNumber || '',
      address: userData.address || '',

      // User Settings
      settings: {
        theme: userData.settings?.theme || 'light', // 'light' or 'dark'
        notifications: userData.settings?.notifications !== undefined ? userData.settings.notifications : true,
        displayName: userData.settings?.displayName || userData.name,
      },

      // Roles and Permissions
      roles: userData.roles || ['guest'], // Default role: guest for new signups. Options: admin, member, guest, chair, etc.
      permissions: userData.permissions || [], // Array of permission strings

      // Committee relationships
      ownedCommittees: userData.ownedCommittees || [], // Array of committee IDs this user owns
      chairedCommittees: userData.chairedCommittees || [], // Array of committee IDs this user chairs
      memberCommittees: userData.memberCommittees || [], // Array of committee IDs this user is a member of
      guestCommittees: userData.guestCommittees || [], // Array of committee IDs where the user is a guest

      // Motion relationships
      authoredMotions: userData.authoredMotions || [], // Array of motion IDs this user created

      // Metadata
      lastLogin: userData.lastLogin || null,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await this.collection().insertOne(user);
    return { _id: result.insertedId, ...user };
  }

  static async findByEmail(email) {
    return await this.collection().findOne({ email });
  }

  static async findById(id) {
    return await this.collection().findOne({ _id: new ObjectId(id) });
  }

  static async findAll() {
    return await this.collection().find({}).toArray();
  }

  static async updateById(id, updates) {
    const updateData = {
      ...updates,
      updatedAt: new Date()
    };

    const result = await this.collection().findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return result;
  }

  static async updateLastLogin(id) {
    return await this.updateById(id, { lastLogin: new Date() });
  }

  static async deleteById(id) {
    return await this.collection().deleteOne({ _id: new ObjectId(id) });
  }

  // Role management methods
  static async addRole(userId, role) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { roles: role },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removeRole(userId, role) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $pull: { roles: role },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async hasRole(userId, role) {
    const user = await this.findById(userId);
    return user && user.roles && user.roles.includes(role);
  }

  // Permission management methods
  static async addPermission(userId, permission) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { permissions: permission },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removePermission(userId, permission) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $pull: { permissions: permission },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async hasPermission(userId, permission) {
    const user = await this.findById(userId);
    return user && user.permissions && user.permissions.includes(permission);
  }

  // Committee relationship methods
  static async addOwnedCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { ownedCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removeOwnedCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $pull: { ownedCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async addChairedCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { chairedCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removeChairedCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $pull: { chairedCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async addMemberCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { memberCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async addGuestCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { guestCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removeGuestCommittee(userId, committeeId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $pull: { guestCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removeMemberCommittee(userId, committeeId) {
    const cid = String(committeeId);
    const uid = new ObjectId(userId);
    
    // Remove both ObjectId and string versions to handle legacy data
    await this.collection().updateOne(
      { _id: uid },
      {
        $pull: { memberCommittees: cid },
        $set: { updatedAt: new Date() }
      }
    );
    
    return await this.collection().updateOne(
      { _id: uid },
      {
        $pull: { memberCommittees: new ObjectId(committeeId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  // Motion relationship methods
  static async addAuthoredMotion(userId, motionId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $addToSet: { authoredMotions: new ObjectId(motionId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  static async removeAuthoredMotion(userId, motionId) {
    return await this.collection().updateOne(
      { _id: new ObjectId(userId) },
      {
        $pull: { authoredMotions: new ObjectId(motionId) },
        $set: { updatedAt: new Date() }
      }
    );
  }

  // Get all committees and motions for a user
  static async getUserCommittees(userId) {
    const user = await this.findById(userId);
    if (!user) return null;

    return {
      owned: user.ownedCommittees || [],
      chaired: user.chairedCommittees || [],
      member: user.memberCommittees || [],
      guest: user.guestCommittees || []
    };
  }

  static async getUserMotions(userId) {
    const user = await this.findById(userId);
    if (!user) return null;

    return user.authoredMotions || [];
  }

  // Settings management methods
  static async updateSettings(userId, settings) {
    const updateData = {};

    if (settings.theme !== undefined) {
      updateData['settings.theme'] = settings.theme;
    }
    if (settings.notifications !== undefined) {
      updateData['settings.notifications'] = settings.notifications;
    }
    if (settings.displayName !== undefined) {
      updateData['settings.displayName'] = settings.displayName;
    }
    updateData.updatedAt = new Date();

    const result = await this.collection().findOneAndUpdate(
      { _id: new ObjectId(userId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    return result;
  }

  static async getSettings(userId) {
    const user = await this.findById(userId);
    if (!user) return null;

    return user.settings || {
      theme: 'light',
      notifications: true,
      displayName: user.name
    };
  }
}

module.exports = User;
