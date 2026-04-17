const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { getDynamo } = require('../config/database');

const TABLE = process.env.DYNAMODB_USERS_TABLE || 'commie-users';

class User {
  static dynamo() {
    return getDynamo();
  }

  static async create(userData) {
    const userId = randomUUID();
    const now = new Date().toISOString();

    const user = {
      userId,
      email: userData.email,
      emailVerified: userData.emailVerified || false,
      password: userData.password || null,
      name: userData.name,
      picture: userData.picture || null,
      communityCode: userData.communityCode || null,
      bio: userData.bio || '',
      phoneNumber: userData.phoneNumber || '',
      address: userData.address || '',
      settings: {
        theme: userData.settings?.theme || 'light',
        notifications: userData.settings?.notifications !== undefined
          ? userData.settings.notifications
          : true,
        displayName: userData.settings?.displayName || userData.name,
      },
      roles: userData.roles || ['user'],
      permissions: userData.permissions || [],
      ownedCommittees: userData.ownedCommittees || [],
      chairedCommittees: userData.chairedCommittees || [],
      memberCommittees: userData.memberCommittees || [],
      guestCommittees: userData.guestCommittees || [],
      authoredMotions: userData.authoredMotions || [],
      lastLogin: userData.lastLogin || null,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamo().send(new PutCommand({
      TableName: TABLE,
      Item: user,
      ConditionExpression: 'attribute_not_exists(userId)',
    }));

    return user;
  }

  static async findByEmail(email) {
    const result = await this.dynamo().send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: { ':email': email },
      Limit: 1,
    }));
    return result.Items?.[0] || null;
  }

  static async findById(userId) {
    if (!userId) return null;
    const result = await this.dynamo().send(new GetCommand({
      TableName: TABLE,
      Key: { userId: String(userId) },
    }));
    return result.Item || null;
  }

  static async findAll() {
    const result = await this.dynamo().send(new ScanCommand({ TableName: TABLE }));
    return result.Items || [];
  }

  // Scan + in-process search (fine for demo scale)
  static async search(searchTerm, limit = 50, offset = 0) {
    const result = await this.dynamo().send(new ScanCommand({ TableName: TABLE }));
    let items = result.Items || [];

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      items = items.filter(u =>
        (u.name || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term) ||
        (u.settings?.displayName || '').toLowerCase().includes(term)
      );
    }

    const total = items.length;
    const paginated = items.slice(offset, offset + limit);
    return { users: paginated, total };
  }

  static async updateById(userId, updates) {
    const now = new Date().toISOString();
    const fields = { ...updates, updatedAt: now };

    const exprParts = [];
    const exprNames = {};
    const exprValues = {};

    for (const [key, val] of Object.entries(fields)) {
      exprParts.push(`#${key} = :${key}`);
      exprNames[`#${key}`] = key;
      exprValues[`:${key}`] = val;
    }

    const result = await this.dynamo().send(new UpdateCommand({
      TableName: TABLE,
      Key: { userId: String(userId) },
      UpdateExpression: `SET ${exprParts.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }));

    return result.Attributes || null;
  }

  static async updateLastLogin(userId) {
    return this.updateById(userId, { lastLogin: new Date().toISOString() });
  }

  static async deleteById(userId) {
    return this.dynamo().send(new DeleteCommand({
      TableName: TABLE,
      Key: { userId: String(userId) },
    }));
  }

  // ── Role management ────────────────────────────────────────────────────────

  static async addRole(userId, role) {
    const user = await this.findById(userId);
    if (!user) return;
    const roles = [...new Set([...(user.roles || []), role])];
    return this.updateById(userId, { roles });
  }

  static async removeRole(userId, role) {
    const user = await this.findById(userId);
    if (!user) return;
    const roles = (user.roles || []).filter(r => r !== role);
    return this.updateById(userId, { roles });
  }

  static async hasRole(userId, role) {
    const user = await this.findById(userId);
    return user?.roles?.includes(role) || false;
  }

  // ── Permission management ──────────────────────────────────────────────────

  static async addPermission(userId, permission) {
    const user = await this.findById(userId);
    if (!user) return;
    const permissions = [...new Set([...(user.permissions || []), permission])];
    return this.updateById(userId, { permissions });
  }

  static async removePermission(userId, permission) {
    const user = await this.findById(userId);
    if (!user) return;
    const permissions = (user.permissions || []).filter(p => p !== permission);
    return this.updateById(userId, { permissions });
  }

  static async hasPermission(userId, permission) {
    const user = await this.findById(userId);
    return user?.permissions?.includes(permission) || false;
  }

  // ── Array field helpers ────────────────────────────────────────────────────

  static async _addToList(userId, field, value) {
    const user = await this.findById(userId);
    if (!user) return;
    const current = (user[field] || []).map(String);
    const str = String(value);
    if (current.includes(str)) return;
    return this.updateById(userId, { [field]: [...current, str] });
  }

  static async _removeFromList(userId, field, value) {
    const user = await this.findById(userId);
    if (!user) return;
    const str = String(value);
    const updated = (user[field] || []).filter(v => String(v) !== str);
    return this.updateById(userId, { [field]: updated });
  }

  // ── Committee relationships ────────────────────────────────────────────────

  static async addOwnedCommittee(userId, committeeId) {
    return this._addToList(userId, 'ownedCommittees', committeeId);
  }
  static async removeOwnedCommittee(userId, committeeId) {
    return this._removeFromList(userId, 'ownedCommittees', committeeId);
  }
  static async addChairedCommittee(userId, committeeId) {
    return this._addToList(userId, 'chairedCommittees', committeeId);
  }
  static async removeChairedCommittee(userId, committeeId) {
    return this._removeFromList(userId, 'chairedCommittees', committeeId);
  }
  static async addMemberCommittee(userId, committeeId) {
    return this._addToList(userId, 'memberCommittees', committeeId);
  }
  static async removeMemberCommittee(userId, committeeId) {
    return this._removeFromList(userId, 'memberCommittees', committeeId);
  }
  static async addGuestCommittee(userId, committeeId) {
    return this._addToList(userId, 'guestCommittees', committeeId);
  }
  static async removeGuestCommittee(userId, committeeId) {
    return this._removeFromList(userId, 'guestCommittees', committeeId);
  }

  // ── Motion relationships ───────────────────────────────────────────────────

  static async addAuthoredMotion(userId, motionId) {
    return this._addToList(userId, 'authoredMotions', motionId);
  }
  static async removeAuthoredMotion(userId, motionId) {
    return this._removeFromList(userId, 'authoredMotions', motionId);
  }

  static async getUserCommittees(userId) {
    const user = await this.findById(userId);
    if (!user) return null;
    return {
      owned: user.ownedCommittees || [],
      chaired: user.chairedCommittees || [],
      member: user.memberCommittees || [],
      guest: user.guestCommittees || [],
    };
  }

  static async getUserMotions(userId) {
    const user = await this.findById(userId);
    if (!user) return null;
    return user.authoredMotions || [];
  }

  // ── Settings ───────────────────────────────────────────────────────────────

  static async updateSettings(userId, settings) {
    const user = await this.findById(userId);
    if (!user) return null;
    const merged = { ...(user.settings || {}), ...settings };
    return this.updateById(userId, { settings: merged });
  }

  static async getSettings(userId) {
    const user = await this.findById(userId);
    if (!user) return null;
    return user.settings || { theme: 'light', notifications: true, displayName: user.name };
  }
}

module.exports = User;
