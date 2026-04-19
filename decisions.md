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

## Step 4 — DynamoDB model migration

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

**Migration order:**
1. `User` ✅ — complete (see 4a)
2. `Committee` ✅ — complete (see 4b)
3. `Motion`
4. `Vote`
5. `Comment`
6. `Notification`

---

### 4a — User model migrated to DynamoDB

**What changed:**

- `backend/models/User.js` fully rewritten — all MongoDB native driver calls replaced with
  AWS SDK v3 (`GetCommand`, `PutCommand`, `UpdateCommand`, `DeleteCommand`, `QueryCommand`,
  `ScanCommand`) via `DynamoDBDocumentClient`.

- Primary key changed from MongoDB `_id` (ObjectId) to `userId` (UUID string via
  `crypto.randomUUID()`). This is a breaking change from the MongoDB schema but consistent
  with DynamoDB's string key model.

- Array mutation methods (`addMemberCommittee`, `removeRole`, etc.) use a read-modify-write
  pattern (fetch item → modify array in JS → update item). Simpler than DynamoDB expression
  syntax for lists, acceptable for demo scale.

- `search()` method added (replaces direct `.collection().find()` calls in routes) — uses
  `ScanCommand` + in-process JS filtering. Not efficient at scale but appropriate here.

- `updateById()` builds `UpdateExpression` dynamically from an updates object, mirroring
  the MongoDB `$set` pattern.

**`middleware/auth.js` updated:**
- `req.user.userId` now comes from `user.userId` instead of `user._id.toString()`
- Removed `organizationId` and `organizationRole` from `req.user`
- Removed `requireOrgAdmin`, `isOrgAdmin` (no longer meaningful without org model)
- `requirePermissionOrAdmin` and `requireCommitteeChairOrPermission` simplified to check
  `super-admin` and `admin` roles only

**`routes/auth.js` updated:**
- All `user._id` references replaced with `user.userId`
- `User.collection().find()` / `.countDocuments()` replaced with `User.findAll()` /
  `User.search()`
- `new ObjectId(userId)` removed from cascade delete — IDs are now plain strings
- `ObjectId` import removed entirely

**`backend/scripts/createDynamoTables.js` added:**
- Creates all 6 DynamoDB tables for local development
- Safe to re-run (skips existing tables)
- Run after `docker compose up -d dynamodb-local`

**`.env.example` updated** with `DYNAMODB_LOCAL`, `DYNAMO_STACK_PREFIX`, and per-table
name variables.

---

### 4b — Committee model migrated to DynamoDB

**Key design decision — motions stay embedded:**
The CloudFormation template puts motions in their own table with a `committeeId` GSI. However,
migrating Committee and Motion simultaneously would require rewriting both models and all
motion/vote/comment routes at once. Instead, motions are kept as an embedded List attribute
inside each committee DynamoDB item. This is a known trade-off (400KB item limit, can't query
motions independently via GSI) that is acceptable at demo scale. Motions will be separated in a
future step.

**What changed:**

- `backend/models/Committee.js` fully rewritten. Primary key is now `committeeId` (UUID) instead
  of MongoDB `_id` (ObjectId).

- `findBySlug()` uses a `ScanCommand` with a `FilterExpression` (no slug GSI defined). Acceptable
  for demo scale.

- `findByIdOrSlug()` checks UUID format first (direct `GetItem`), then falls back to slug scan.

- All member management methods (`addMember`, `removeMember`, `addMemberWithRole`,
  `getMemberRole`) use read-modify-write on the members list.

- All motion methods (`createMotion`, `findMotions`, `updateMotion`, `deleteMotion`) operate on
  the embedded `motions` list via read-modify-write. Motion IDs are now UUIDs (`motionId` field)
  instead of MongoDB ObjectIds (`_id`).

- `normalizeMembers()` no longer accepts ObjectIds — all userId values are plain strings.

**`routes/committees.js` rewritten:**
- All `Committee.collection()` calls removed.
- All `committee._id` → `committee.committeeId`.
- `/committee/:id/members` now fetches each member user via `User.findById()` in parallel.
- `/committee/:id/potential-members` uses `User.findAll()` + JS filter.
- Cascade delete on `DELETE /committee/:id` iterates all users via `User.findAll()` and calls
  individual `User.remove*Committee()` methods.
- `ObjectId` import removed.

**`routes/motions.js` updated:**
- `committee._id` → `committee.committeeId` throughout.
- `author._id` → `author.userId`.
- `targetMotion._id` → `targetMotion.motionId`.
- `ObjectId` import removed.
- `isOrgAdmin` check removed from motion update authorization.

---

### 4c — Vote model migrated to DynamoDB

**Key design:** `motionId` (HASH) + `userId` (RANGE) composite key. This lets a single `GetItem` fetch a user's specific vote, and a `Query` on `motionId` alone retrieves all votes for a motion. No UUID PK needed.

**What changed:**

- `backend/models/Vote.js` fully rewritten. All MongoDB ObjectId casting removed. `updateOrCreate` uses `UpdateCommand` with `if_not_exists(createdAt, :now)` to be truly idempotent.
- Added `deleteByMotion(motionId)` for the reconsider-motion flow (previously used `Vote.collection().deleteMany()`).
- `backend/routes/votes.js` rewritten: all `committee._id` → `committee.committeeId`, `Motion` import removed, `Vote.collection()` call replaced with `Vote.deleteByMotion()`.

---

### 4d — Comment model migrated to DynamoDB

**Key design:** `commentId` (UUID, HASH) with `motionId-index` GSI to query all comments for a motion.

**What changed:**

- `backend/models/Comment.js` fully rewritten. `findByMotion` uses `QueryCommand` on the `motionId-index` GSI. Author hydration uses `User.findById()` instead of a direct MongoDB users collection query.
- `backend/routes/comments.js` cleaned up: `Motion` import removed, all `committee._id` → `committee.committeeId`.

---

### 4e — Notification model migrated to DynamoDB

**Key design:** `notificationId` (UUID, HASH). Added `findPendingAccessRequest()` and `findByTarget()` helpers using `ScanCommand` with filter expressions.

**What changed:**

- `backend/models/Notification.js` fully rewritten.
- `backend/routes/notifications.js` rewritten: removed all `Committee.collection()`, `Notification.collection()`, `ObjectId`, `user._id`, `committee._id`, `user.organizationId`/`organizationRole` references. Super-admin org notification filtering removed (no org model). `GET /notifications` now uses JS-side filtering on results from `Notification.findAll()`.

---

### 4f — All remaining MongoDB references cleaned from active routes

**What changed:**

- `backend/utils/votingEligibility.js`: `Comment.collection().find()` and `ObjectId` replaced with `Comment.findByMotion()`. `committee._id` → `committee.committeeId` (using `??` fallback for safety). `motion._id` → `motion.motionId`.
- `backend/routes/motionControl.js` rewritten: all `committee._id` → `committee.committeeId`, `new ObjectId(userId)` removed (secondedBy stored as plain string UUID).
- `backend/middleware/auth.js`: `committee._id` → `committee.committeeId` in `requireCommitteeChairOrPermission`.
- `backend/routes/auth.js`: `updatedUser._id` → `updatedUser.userId` in profile/admin update responses. Cascade delete in `DELETE /auth/user/:userId` replaced MongoDB `updateMany`/`deleteMany` calls with `Committee.removeMember()` iteration.

**Files left with MongoDB code (not in active use):**
- `backend/models/Motion.js` — superseded by embedded motions in Committee
- `backend/models/Organization.js` — org model removed in Step 2
- `backend/routes/organizations.js` — not registered in server.js
- `backend/migrations/` — one-time migration scripts, not run at startup

The migration order table is now complete:

| Model | Status |
|---|---|
| User | ✅ complete |
| Committee (+ embedded Motions) | ✅ complete |
| Vote | ✅ complete |
| Comment | ✅ complete |
| Notification | ✅ complete |
