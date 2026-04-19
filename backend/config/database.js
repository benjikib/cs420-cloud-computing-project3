const { MongoClient, ServerApiVersion } = require('mongodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');

// ── MongoDB ──────────────────────────────────────────────────────────────────

let mongoClient;
let db;

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI environment variable is not set');
  }

  mongoClient = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
    tls: true,
    tlsAllowInvalidCertificates: false,
    tlsAllowInvalidHostnames: false,
    connectTimeoutMS: 30000,
    socketTimeoutMS: 45000,
  });

  try {
    await mongoClient.connect();
    await mongoClient.db('admin').command({ ping: 1 });
    console.log('Connected to MongoDB');
    db = mongoClient.db('commie');
    return db;
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    throw error;
  }
}

function getDB() {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB first.');
  }
  return db;
}

// ── DynamoDB ─────────────────────────────────────────────────────────────────

const isLocal = process.env.DYNAMODB_LOCAL === 'true';

const dynamoClient = new DynamoDBClient(
  isLocal
    ? {
        region: 'us-east-1', // required but ignored by local
        endpoint: 'http://localhost:8000',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {
        region: process.env.AWS_REGION || 'us-east-1',
        // On EC2 with an instance role, no credentials needed here
      }
);

const dynamo = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: { removeUndefinedValues: true },
});

function getDynamo() {
  return dynamo;
}

module.exports = {
  connectDB,
  getDB,
  getDynamo,
  get client() { return mongoClient; },
};
