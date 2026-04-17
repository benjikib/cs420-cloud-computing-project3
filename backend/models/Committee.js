const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
} = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { getDynamo } = require('../config/database');
const { slugify } = require('../utils/slugify');

const TABLE = process.env.DYNAMODB_COMMITTEES_TABLE || 'commie-committees';

class Committee {
  static dynamo() {
    return getDynamo();
  }

  static normalizeMembers(members) {
    if (!Array.isArray(members)) return [];
    return members.map(m => {
      if (!m) return null;
      if (typeof m === 'string') {
        return { userId: m, role: 'member', joinedAt: new Date().toISOString() };
      }
      const userId = m.userId || m._id || m.id;
      return { userId: String(userId), role: m.role || 'member', joinedAt: m.joinedAt || new Date().toISOString() };
    }).filter(Boolean);
  }

  static async create(committeeData) {
    const committeeId = randomUUID();
    const now = new Date().toISOString();

    const committee = {
      committeeId,
      title: committeeData.title,
      slug: committeeData.slug || slugify(committeeData.title),
      description: committeeData.description,
      members: this.normalizeMembers(committeeData.members || []),
      owner: committeeData.owner || null,
      chair: committeeData.chair ? String(committeeData.chair) : null,
      settings: committeeData.settings || {},
      motions: [],
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamo().send(new PutCommand({
      TableName: TABLE,
      Item: committee,
      ConditionExpression: 'attribute_not_exists(committeeId)',
    }));

    return committee;
  }

  static async findById(id) {
    if (!id) return null;
    const result = await this.dynamo().send(new GetCommand({
      TableName: TABLE,
      Key: { committeeId: String(id) },
    }));
    return result.Item || null;
  }

  static async findBySlug(slug) {
    const result = await this.dynamo().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#slug = :slug',
      ExpressionAttributeNames: { '#slug': 'slug' },
      ExpressionAttributeValues: { ':slug': slug },
      Limit: 1,
    }));
    return result.Items?.[0] || null;
  }

  // Try UUID lookup first, then fall back to slug scan
  static async findByIdOrSlug(identifier) {
    if (!identifier) return null;

    // Looks like a UUID — try direct GetItem first
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidPattern.test(identifier)) {
      const byId = await this.findById(identifier);
      if (byId) return byId;
    }

    // Fall back to slug scan
    return this.findBySlug(identifier);
  }

  static async findAll() {
    const result = await this.dynamo().send(new ScanCommand({ TableName: TABLE }));
    return result.Items || [];
  }

  static async findByChair(userId) {
    const result = await this.dynamo().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#chair = :userId',
      ExpressionAttributeNames: { '#chair': 'chair' },
      ExpressionAttributeValues: { ':userId': String(userId) },
    }));
    return result.Items || [];
  }

  static async updateById(id, updates) {
    const now = new Date().toISOString();

    // Regenerate slug if title changed
    if (updates.title) {
      updates.slug = slugify(updates.title);
    }

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
      Key: { committeeId: String(id) },
      UpdateExpression: `SET ${exprParts.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }));

    return result.Attributes || null;
  }

  static async deleteById(id) {
    return this.dynamo().send(new DeleteCommand({
      TableName: TABLE,
      Key: { committeeId: String(id) },
    }));
  }

  // ── Member management ──────────────────────────────────────────────────────

  static async addMember(committeeId, userId) {
    return this.addMemberWithRole(committeeId, userId, 'member');
  }

  static async addMemberWithRole(committeeId, userId, role = 'member') {
    const committee = await this.findById(committeeId);
    if (!committee) return null;

    const uid = String(userId);
    const members = (committee.members || []).filter(m => String(m.userId) !== uid);
    members.push({ userId: uid, role, joinedAt: new Date().toISOString() });

    return this.updateById(committeeId, { members });
  }

  static async removeMember(committeeId, userId) {
    const committee = await this.findById(committeeId);
    if (!committee) return null;

    const uid = String(userId);
    const members = (committee.members || []).filter(m => String(m.userId) !== uid);
    return this.updateById(committeeId, { members });
  }

  static async getMemberRole(committeeId, userId) {
    const committee = await this.findById(committeeId);
    if (!committee) return null;

    const uid = String(userId);
    if (committee.chair && String(committee.chair) === uid) return 'chair';
    if (committee.owner && String(committee.owner) === uid) return 'owner';

    const member = (committee.members || []).find(m => String(m.userId) === uid);
    return member?.role || null;
  }

  static async isGuest(committeeId, userId) {
    return (await this.getMemberRole(committeeId, userId)) === 'guest';
  }

  static async isMember(committeeId, userId) {
    const role = await this.getMemberRole(committeeId, userId);
    return role != null && role !== 'guest';
  }

  static async isChair(committeeId, userId) {
    const role = await this.getMemberRole(committeeId, userId);
    return role === 'chair' || role === 'owner';
  }

  static async addChair(committeeId, userId) {
    await this.updateById(committeeId, { chair: String(userId) });
    return this.addMemberWithRole(committeeId, userId, 'chair');
  }

  // ── Embedded motion methods ────────────────────────────────────────────────
  // Motions are stored as a List attribute inside the committee item.
  // All operations use read-modify-write on the motions array.

  static async createMotion(committeeId, motionData) {
    const committee = await this.findById(committeeId);
    if (!committee) return null;

    const motionId = randomUUID();
    const now = new Date().toISOString();

    const motion = {
      motionId,
      title: motionData.title,
      description: motionData.description,
      fullDescription: motionData.fullDescription || motionData.description,
      author: motionData.author ? String(motionData.author) : null,
      motionType: motionData.motionType || 'main',
      motionTypeLabel: motionData.motionTypeLabel || 'Main Motion',
      debatable: motionData.debatable !== undefined ? motionData.debatable : true,
      amendable: motionData.amendable !== undefined ? motionData.amendable : true,
      voteRequired: motionData.voteRequired || 'majority',
      targetMotionId: motionData.targetMotionId ? String(motionData.targetMotionId) : null,
      status: motionData.status || 'active',
      votes: { yes: 0, no: 0, abstain: 0 },
      isAnonymous: motionData.isAnonymous || false,
      secondedBy: motionData.secondedBy ? String(motionData.secondedBy) : null,
      votingStatus: motionData.votingStatus || 'not-started',
      votingOpenedAt: motionData.votingOpenedAt || null,
      votingClosedAt: motionData.votingClosedAt || null,
      createdAt: now,
      updatedAt: now,
    };

    const motions = [...(committee.motions || []), motion];
    await this.updateById(committeeId, { motions });
    return motion;
  }

  static async findMotions(committeeId, page = 1, limit = 10, options = {}) {
    const committee = await this.findById(committeeId);
    if (!committee?.motions?.length) {
      return { motions: [], page, limit, totalPages: 0, total: 0 };
    }

    const { type, status, targetMotion, includeSubsidiaries } = options;

    let motions = [...committee.motions].sort(
      (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
    );

    // Build child map for subsidiaries
    const childMap = {};
    for (const m of motions) {
      if (m.targetMotionId) {
        childMap[m.targetMotionId] = childMap[m.targetMotionId] || [];
        childMap[m.targetMotionId].push(m);
      }
    }

    // Filter to top-level unless includeSubsidiaries requested
    const subsidiaryTypes = ['amend', 'refer_to_committee', 'postpone', 'limit_debate', 'previous_question', 'table'];
    if (!includeSubsidiaries) {
      motions = motions.filter(m =>
        !m.targetMotionId || m.motionType === 'reconsider'
      );
    }

    if (type) motions = motions.filter(m => m.motionType === type);
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      motions = motions.filter(m => statuses.includes(m.status) || (m.status === 'past' && (statuses.includes('passed') || statuses.includes('failed'))));
    }
    if (targetMotion) {
      motions = motions.filter(m => m.targetMotionId && String(m.targetMotionId) === String(targetMotion));
    }

    const total = motions.length;
    const skip = (page - 1) * limit;
    const paginated = motions.slice(skip, skip + limit).map(m => ({
      ...m,
      subsidiaries: childMap[m.motionId] || [],
    }));

    return { motions: paginated, page, limit, totalPages: Math.ceil(total / limit), total };
  }

  static async findMotionById(committeeId, motionId) {
    const committee = await this.findById(committeeId);
    if (!committee?.motions) return null;
    return committee.motions.find(m => String(m.motionId) === String(motionId)) || null;
  }

  static async updateMotion(committeeId, motionId, updates) {
    const committee = await this.findById(committeeId);
    if (!committee) return null;

    const motions = (committee.motions || []).map(m => {
      if (String(m.motionId) !== String(motionId)) return m;
      return { ...m, ...updates, motionId: m.motionId, updatedAt: new Date().toISOString() };
    });

    await this.updateById(committeeId, { motions });
    return motions.find(m => String(m.motionId) === String(motionId)) || null;
  }

  static async deleteMotion(committeeId, motionId) {
    const committee = await this.findById(committeeId);
    if (!committee) return null;

    const motions = (committee.motions || []).filter(
      m => String(m.motionId) !== String(motionId)
    );
    return this.updateById(committeeId, { motions });
  }

  static async updateMotionVoteCounts(committeeId, motionId, voteCounts) {
    return this.updateMotion(committeeId, motionId, { votes: voteCounts });
  }
}

module.exports = Committee;
