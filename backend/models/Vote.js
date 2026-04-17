const {
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { getDynamo } = require('../config/database');

const TABLE = process.env.DYNAMODB_VOTES_TABLE || 'commie-votes';

// DynamoDB table key design:
//   PK: motionId (string)
//   SK: userId (string)
// This composite key allows direct lookup of a user's vote on a motion,
// and querying all votes for a motion via Query on PK alone.

class Vote {
  static dynamo() {
    return getDynamo();
  }

  static async create(voteData) {
    const now = new Date().toISOString();
    const item = {
      motionId: String(voteData.motionId),
      userId: String(voteData.userId),
      committeeId: voteData.committeeId ? String(voteData.committeeId) : null,
      vote: voteData.vote,
      isAnonymous: voteData.isAnonymous || false,
      createdAt: now,
      updatedAt: now,
    };

    await this.dynamo().send(new PutCommand({
      TableName: TABLE,
      Item: item,
    }));

    return item;
  }

  static async findByMotion(motionId) {
    const result = await this.dynamo().send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'motionId = :mid',
      ExpressionAttributeValues: { ':mid': String(motionId) },
    }));
    return result.Items || [];
  }

  static async findByUserAndMotion(userId, motionId) {
    const result = await this.dynamo().send(new GetCommand({
      TableName: TABLE,
      Key: { motionId: String(motionId), userId: String(userId) },
    }));
    return result.Item || null;
  }

  static async updateOrCreate(userId, motionId, committeeId, voteValue, isAnonymous = false) {
    const now = new Date().toISOString();

    // Upsert via UpdateCommand — creates or overwrites the item
    const result = await this.dynamo().send(new UpdateCommand({
      TableName: TABLE,
      Key: { motionId: String(motionId), userId: String(userId) },
      UpdateExpression: 'SET #vote = :vote, isAnonymous = :anon, committeeId = :cid, updatedAt = :now, createdAt = if_not_exists(createdAt, :now)',
      ExpressionAttributeNames: { '#vote': 'vote' },
      ExpressionAttributeValues: {
        ':vote': voteValue,
        ':anon': isAnonymous,
        ':cid': committeeId ? String(committeeId) : null,
        ':now': now,
      },
      ReturnValues: 'ALL_NEW',
    }));

    return result.Attributes || null;
  }

  static async deleteByUserAndMotion(userId, motionId) {
    await this.dynamo().send(new DeleteCommand({
      TableName: TABLE,
      Key: { motionId: String(motionId), userId: String(userId) },
    }));
    return { deletedCount: 1 };
  }

  static async deleteByMotion(motionId) {
    const votes = await this.findByMotion(motionId);
    await Promise.all(votes.map(v =>
      this.dynamo().send(new DeleteCommand({
        TableName: TABLE,
        Key: { motionId: String(motionId), userId: String(v.userId) },
      }))
    ));
    return { deletedCount: votes.length };
  }

  static async getVoteSummary(motionId) {
    const votes = await this.findByMotion(motionId);

    const summary = votes.reduce((acc, v) => {
      acc[v.vote] = (acc[v.vote] || 0) + 1;
      acc.total += 1;
      return acc;
    }, { yes: 0, no: 0, abstain: 0, total: 0 });

    return summary;
  }
}

module.exports = Vote;
