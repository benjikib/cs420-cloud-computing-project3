# AWS Migration — Decisions & Process Log

## Overview

This document records the decisions made while migrating the Commie app from its original
Vercel + MongoDB deployment to AWS (EC2 + DynamoDB), as part of CS420 Cloud Computing Project 3.

The original app was a parliamentary motion management system (based on Robert's Rules of Order)
built with React/Vite on the frontend and Express.js/MongoDB on the backend.

---

## Branch

All migration work is done on the `aws-rewrite` branch, branched from `main`.

---

## Step 1 — Strip Vercel-specific code from the backend

**Problem:** The original `server.js` and `config/database.js` were written for Vercel's
serverless environment. This introduced several patterns that are unnecessary and
counterproductive on a long-running EC2 server:

- A lazy `dbConnected` flag and per-request `ensureDbConnection()` middleware, because
  serverless functions can't hold persistent connections between invocations.
- A `VERCEL !== '1'` guard around `startServer()`, so the file could be `require()`'d as a
  serverless handler while also being runnable locally.
- `module.exports = app` at the bottom for the Vercel function adapter.
- CORS config that whitelisted all `*.vercel.app` domains.
- `database.js` constructing a `MongoClient` at module load time (before env vars were loaded),
  causing a crash when `MONGODB_URI` was undefined.

**Decisions:**
- Removed all `VERCEL !== '1'` guards. The server always starts normally.
- Moved `MongoClient` construction inside `connectDB()` so it only runs after dotenv has loaded.
- Simplified CORS to only allow `localhost` (dev) and a `CORS_ORIGIN` env var (production).
  Set `CORS_ORIGIN` to the EC2 frontend IP in `.env` when deploying.
- Removed the `/test` debug route.
- Removed `module.exports = app`.

---

## Step 2 — Scope reduction: remove organization logic

**Problem:** The full app had a multi-tenant organization model where:
- Users had to register with an organization invite code.
- All committees, users, and data were scoped to an organization.
- Admins could create organizations, manage members, handle payments, etc.

This added significant complexity to the migration (org-scoped queries, invite code flows,
org-deletion cascades, payment pages) without adding demonstrable value for the class project.

**Decision:** Reduce to a single flat community — one implicit organization that everyone belongs
to. Users can register freely with just email, name, and password.

**What was removed:**
- `backend/models/Organization.js` — model no longer used
- `backend/routes/organizations.js` — route no longer registered
- `organizationId` and `organizationRole` fields from the User model
- Invite code requirement from `POST /auth/register`
- Organization filtering from `GET /committees/:page` (all users now see all committees)
- Organization filtering from `GET /committees/my-chairs`
- `organizationId` from committee creation
- Org-deletion cascade from `DELETE /auth/user/:userId`
- `enabledNotificationOrgs` from user settings
- Frontend: `OrganizationSetupPage`, `OrganizationPaymentPage`, `OrganizationDeletedPage`
  components and their routes in `App.jsx`
- Frontend: invite code field and "isAdmin" checkbox from `LoginPage.jsx`
- Frontend: org-deleted redirect logic from `ProtectedRoute.jsx`
- Frontend: `organizationRole` checks replaced with `roles` array checks in
  `SideBar.jsx` and `HeaderNav.jsx`

---

## Step 3 — Set up DynamoDB Local for development

**Problem:** Developing and testing against real AWS DynamoDB requires credentials and incurs
cost. It also means every test run hits the network.

**Decision:** Use `amazon/dynamodb-local` via Docker Compose (running under OrbStack) for local
development. The DynamoDB client is configured to point at `http://localhost:8000` when
`DYNAMODB_LOCAL=true` is set in `.env`, and falls back to real AWS (using the EC2 instance role)
when that variable is absent.

**What was added:**
- `dynamodb-local` service in `docker-compose.yml`
- `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` installed in `backend/`
- `getDynamo()` export in `config/database.js` returning a `DynamoDBDocumentClient`
- Local client uses dummy credentials (`local`/`local`) since DynamoDB Local doesn't validate them

**To start the local instance:**
```
docker compose up -d dynamodb-local
```

**`.env` variable:**
```
DYNAMODB_LOCAL=true
```

---

## Step 4 — DynamoDB model migration (in progress)

**Plan:** Migrate the backend data layer from MongoDB (native driver) to DynamoDB one model at
a time, keeping MongoDB running in parallel until all models are ported. The CloudFormation
template (`architecture.yaml`) already defines the table schemas and GSIs.

**Tables and key design (from `architecture.yaml`):**

| Table | PK | SK | GSIs |
|---|---|---|---|
| users | `userId` | — | `email-index` |
| committees | `committeeId` | — | `organizationId-index` |
| motions | `motionId` | — | `committeeId-index` |
| votes | `motionId` | `userId` | `userId-index` |
| comments | `commentId` | — | `motionId-index` |
| notifications | `notificationId` | — | `userId-index` |

**Key migration considerations:**
- MongoDB `_id` (ObjectId) → DynamoDB string UUID (using `crypto.randomUUID()`)
- MongoDB `.skip()/.limit()` pagination → DynamoDB cursor-based pagination
  (`LastEvaluatedKey`), or simplified to return first N items for demo purposes
- MongoDB `$in` queries → DynamoDB `BatchGetItem` (100-item limit, unordered)
- MongoDB `$set`/`$push`/`$pull` → DynamoDB `UpdateExpression` syntax
- No aggregation pipelines in the original code — simplifies migration significantly

**Migration order (planned):**
1. `User` — most referenced model, unblocks everything else
2. `Committee` — second most complex
3. `Motion`
4. `Vote`
5. `Comment`
6. `Notification`
