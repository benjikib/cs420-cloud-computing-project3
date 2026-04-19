# CS 420: Cloud Computing — Project 3

> Parliamentary motion management system migrated from Vercel + MongoDB to AWS EC2 + DynamoDB.

**Group members:** Benji Kiblinger, Peter Forsberg

---

## Project Overview

**Commie** is a web application for managing parliamentary motions, voting, and committee governance. For Project 3 we migrated the full stack from a Vercel serverless deployment backed by MongoDB Atlas to a two-instance AWS EC2 deployment backed by DynamoDB.

## Architecture

```
Browser → EC2 Frontend (nginx)
              └─ serves static React/Vite build
              └─ proxies /api/* → EC2 Backend (Express + PM2)
                                      └─ DynamoDB tables (users, committees, votes, comments, notifications)
```

Both instances are provisioned by a single CloudFormation stack (`architecture.yaml`). The backend accesses DynamoDB via the `LabInstanceProfile` IAM role — no hardcoded credentials anywhere.

## Tech Stack

### Frontend
| | |
|---|---|
| Framework | React 19.2.1 |
| Build Tool | Vite 7.1.6 |
| Routing | React Router DOM 7.9.1 |
| Styling | Tailwind CSS 4.1.13 |
| Icons | React Icons 5.5.0 |

### Backend
| | |
|---|---|
| Runtime | Node.js with Express.js 4.18.2 |
| Database | AWS DynamoDB (AWS SDK v3) |
| Authentication | JWT (jsonwebtoken 9.0.2) |
| Password Hashing | bcryptjs 2.4.3 |
| Validation | express-validator 7.0.1 |
| Process Manager | PM2 |

### Infrastructure
| | |
|---|---|
| Compute | 2× AWS EC2 (Amazon Linux 2023) |
| Database | AWS DynamoDB (5 tables, PAY_PER_REQUEST) |
| Artifact Storage | AWS S3 |
| IaC | AWS CloudFormation |
| Web Server | nginx (frontend) |

---

## Deploying to AWS

### 1. Prerequisites

- An S3 bucket in the same region you're deploying to (create it manually in the console)
- The `vockey` EC2 key pair available in your Academy account
- AWS Academy lab session active

### 2. Build and upload artifacts

**Frontend** — run from the project root:
```bash
npm install
npm run build
cd dist
zip -r ../frontend-app.zip .
cd ..
```

**Backend** — run from the project root:
```bash
cd backend
zip -r ../backend-app.zip . \
  --exclude "node_modules/*" \
  --exclude ".env" \
  --exclude "migrations/*" \
  --exclude "scripts/*" \
  --exclude "seed.js"
cd ..
```

Upload both zips to your S3 bucket:
```
s3://<your-bucket>/frontend/frontend-app.zip
s3://<your-bucket>/backend/backend-app.zip
```

### 3. Generate a JWT secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output — you'll paste it as the `JwtSecret` parameter.

### 4. Launch the CloudFormation stack

In the AWS Console → CloudFormation → **Create stack** → upload `architecture.yaml`.

| Parameter | Value |
|---|---|
| Stack Name | `commie-prod` |
| `ArtifactsBucketName` | your S3 bucket name |
| `KeyPairName` | `vockey` |
| `JwtSecret` | output from step 3 |
| `InstanceProfileName` | `LabInstanceProfile` |
| All others | leave as defaults |

CloudFormation will wait up to 20 minutes for both instances to signal success before marking the stack `CREATE_COMPLETE`. The frontend URL is in the **Outputs** tab once the stack finishes.

### 5. Re-deploying

The DynamoDB tables have `DeletionPolicy: Retain`, so deleting the stack **will not** delete your data. If you want a clean slate before re-deploying, delete the tables manually in the DynamoDB console first, then delete and recreate the stack.

---

## Running Locally

**Start DynamoDB Local** (requires Docker):
```bash
docker compose up -d
```

**Start the backend:**
```bash
cd backend
npm install
node server.js
```

**Start the frontend dev server:**
```bash
npm install
npm run dev
```

The frontend dev server proxies `/api` requests to `localhost:3001` automatically.
