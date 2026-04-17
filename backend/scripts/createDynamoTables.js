/**
 * Creates all DynamoDB tables for local development.
 * Run once after starting DynamoDB Local:
 *
 *   docker compose up -d dynamodb-local
 *   node backend/scripts/createDynamoTables.js
 *
 * Safe to re-run — skips tables that already exist.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { DynamoDBClient, CreateTableCommand, ListTablesCommand } = require('@aws-sdk/client-dynamodb');

const client = new DynamoDBClient({
  region: 'us-east-1',
  endpoint: 'http://localhost:8000',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

const STACK = process.env.DYNAMO_STACK_PREFIX || 'commie';

const tables = [
  {
    TableName: `${STACK}-users`,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'userId', AttributeType: 'S' },
      { AttributeName: 'email',  AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'email-index',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: `${STACK}-committees`,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'committeeId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'committeeId', KeyType: 'HASH' },
    ],
  },
  {
    TableName: `${STACK}-motions`,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'motionId',    AttributeType: 'S' },
      { AttributeName: 'committeeId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'motionId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'committeeId-index',
        KeySchema: [{ AttributeName: 'committeeId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: `${STACK}-votes`,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'motionId', AttributeType: 'S' },
      { AttributeName: 'userId',   AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'motionId', KeyType: 'HASH' },
      { AttributeName: 'userId',   KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: `${STACK}-comments`,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'commentId', AttributeType: 'S' },
      { AttributeName: 'motionId',  AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'commentId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'motionId-index',
        KeySchema: [{ AttributeName: 'motionId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    TableName: `${STACK}-notifications`,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'notificationId', AttributeType: 'S' },
      { AttributeName: 'userId',         AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'notificationId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
];

async function main() {
  const existing = await client.send(new ListTablesCommand({}));
  const existingNames = new Set(existing.TableNames || []);

  for (const def of tables) {
    if (existingNames.has(def.TableName)) {
      console.log(`  skipped  ${def.TableName} (already exists)`);
      continue;
    }
    await client.send(new CreateTableCommand(def));
    console.log(`  created  ${def.TableName}`);
  }

  console.log('\nDone.');
}

main().catch(err => {
  console.error('Error creating tables:', err.message);
  process.exit(1);
});
