const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { randomUUID } = require('crypto');
const { getDynamo } = require('../config/database');

const TABLE = process.env.DYNAMODB_NOTIFICATIONS_TABLE || 'commie-notifications';

class Notification {
  static dynamo() {
    return getDynamo();
  }

  static async create(data) {
    const notificationId = randomUUID();
    const now = new Date().toISOString();

    const item = {
      notificationId,
      type: data.type || 'access_request',
      committeeId: data.committeeId ? String(data.committeeId) : null,
      committeeTitle: data.committeeTitle || null,
      requesterId: data.requesterId ? String(data.requesterId) : null,
      requesterName: data.requesterName || null,
      message: data.message || null,
      targetType: data.targetType || null,
      targetId: data.targetId ? String(data.targetId) : null,
      metadata: data.metadata || null,
      status: data.status || 'pending',
      handledBy: data.handledBy ? String(data.handledBy) : null,
      handledAt: data.handledAt ? new Date(data.handledAt).toISOString() : null,
      seenAt: data.seenAt ? new Date(data.seenAt).toISOString() : null,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamo().send(new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(notificationId)',
    }));

    return item;
  }

  static async findById(id) {
    if (!id) return null;
    const result = await this.dynamo().send(new GetCommand({
      TableName: TABLE,
      Key: { notificationId: String(id) },
    }));
    return result.Item || null;
  }

  // Find notifications where requesterId matches (via userId-index GSI)
  static async findByRequesterId(requesterId) {
    const result = await this.dynamo().send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'userId-index',
      KeyConditionExpression: 'requesterId = :uid',
      ExpressionAttributeValues: { ':uid': String(requesterId) },
    }));
    return result.Items || [];
  }

  // Scan all notifications (used for chair-visible notifications)
  static async findAll() {
    const result = await this.dynamo().send(new ScanCommand({ TableName: TABLE }));
    return result.Items || [];
  }

  // Find by targetType + targetId (for comment/motion notifications)
  static async findByTarget(targetType, targetId) {
    const result = await this.dynamo().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#tt = :tt AND #tid = :tid',
      ExpressionAttributeNames: { '#tt': 'targetType', '#tid': 'targetId' },
      ExpressionAttributeValues: { ':tt': targetType, ':tid': String(targetId) },
    }));
    return result.Items || [];
  }

  // Find pending access request from a specific user for a specific committee
  static async findPendingAccessRequest(committeeId, requesterId) {
    const result = await this.dynamo().send(new ScanCommand({
      TableName: TABLE,
      FilterExpression: '#type = :type AND committeeId = :cid AND requesterId = :rid AND #status = :status',
      ExpressionAttributeNames: { '#type': 'type', '#status': 'status' },
      ExpressionAttributeValues: {
        ':type': 'access_request',
        ':cid': String(committeeId),
        ':rid': String(requesterId),
        ':status': 'pending',
      },
    }));
    return result.Items?.[0] || null;
  }

  static async updateById(id, updates) {
    const now = new Date().toISOString();
    const fields = { ...updates, updatedAt: now };

    // Normalize date fields to ISO strings
    if (fields.handledAt instanceof Date) fields.handledAt = fields.handledAt.toISOString();
    if (fields.seenAt instanceof Date) fields.seenAt = fields.seenAt.toISOString();

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
      Key: { notificationId: String(id) },
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
      Key: { notificationId: String(id) },
    }));
  }
}

module.exports = Notification;
