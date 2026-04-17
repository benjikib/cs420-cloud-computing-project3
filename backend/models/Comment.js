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
const User = require('./User');

const TABLE = process.env.DYNAMODB_COMMENTS_TABLE || 'commie-comments';

class Comment {
  static dynamo() {
    return getDynamo();
  }

  static async create(commentData) {
    const commentId = randomUUID();
    const now = new Date().toISOString();

    const item = {
      commentId,
      motionId: commentData.motionId ? String(commentData.motionId) : null,
      committeeId: commentData.committeeId ? String(commentData.committeeId) : null,
      author: commentData.author ? String(commentData.author) : null,
      content: commentData.content,
      stance: commentData.stance || 'neutral',
      isSystemMessage: commentData.isSystemMessage || false,
      messageType: commentData.messageType || null,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamo().send(new PutCommand({
      TableName: TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(commentId)',
    }));

    return item;
  }

  static async findByMotion(motionId, page = 1, limit = 20) {
    const result = await this.dynamo().send(new QueryCommand({
      TableName: TABLE,
      IndexName: 'motionId-index',
      KeyConditionExpression: 'motionId = :mid',
      ExpressionAttributeValues: { ':mid': String(motionId) },
    }));

    const all = result.Items || [];
    all.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const total = all.length;
    const skip = (page - 1) * limit;
    const comments = all.slice(skip, skip + limit);

    // Populate author information
    const commentsWithAuthors = await Promise.all(
      comments.map(async (comment) => {
        if (comment.author) {
          try {
            const user = await User.findById(comment.author);
            return {
              ...comment,
              authorName: user ? (user.settings?.displayName || user.name || 'Unknown User') : 'Unknown User',
              authorInfo: user ? { name: user.settings?.displayName || user.name, email: user.email, picture: user.picture } : null,
            };
          } catch (e) {
            return { ...comment, authorName: 'Unknown User', authorInfo: null };
          }
        }
        return { ...comment, authorName: 'Unknown User', authorInfo: null };
      })
    );

    return {
      comments: commentsWithAuthors,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      total,
    };
  }

  static async findById(id) {
    const result = await this.dynamo().send(new GetCommand({
      TableName: TABLE,
      Key: { commentId: String(id) },
    }));
    return result.Item || null;
  }

  static async updateById(id, updates) {
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
      Key: { commentId: String(id) },
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
      Key: { commentId: String(id) },
    }));
  }
}

module.exports = Comment;
