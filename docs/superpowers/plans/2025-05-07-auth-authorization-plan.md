# Sticker API - Auth, Authorization & Permission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive JWT authentication, RBAC+Permissions authorization, sticker ownership/visibility/sharing, user-scoped storage, and Docker development environment to the existing WhatsApp Sticker API.

**Architecture:** Layered Express API with Prisma ORM + PostgreSQL for persistence, JWT for auth, Redis for token blacklisting and rate limiting, and an abstracted storage provider pattern for cloud-ready file storage.

**Tech Stack:** Node.js 20+, Express 4, TypeScript 5.4, Prisma 5, PostgreSQL 16, Redis 7, JWT (jsonwebtoken), bcrypt, Docker

---

## File Structure

```
stiker-api/
├── prisma/
│   ├── schema.prisma                 # Database schema
│   ├── migrations/                   # Migration files
│   └── seed.ts                       # Seed script
├── src/
│   ├── config/
│   │   └── index.ts                  # Updated with auth/redis config
│   ├── types/
│   │   └── index.ts                  # Updated with new types
│   ├── errors/
│   │   └── index.ts                  # Updated with new errors
│   ├── prisma/
│   │   └── client.ts                 # Prisma singleton
│   ├── storage/
│   │   ├── interface.ts              # IStorageProvider
│   │   └── local.provider.ts         # Local storage implementation
│   ├── services/
│   │   ├── auth.service.ts           # JWT auth logic
│   │   ├── user.service.ts           # User CRUD
│   │   ├── role.service.ts           # Role/permission management
│   │   ├── sticker.service.ts        # Sticker CRUD + visibility
│   │   └── share.service.ts          # Sharing logic
│   ├── middleware/
│   │   ├── auth.middleware.ts        # JWT verification
│   │   ├── role.middleware.ts        # Role checking
│   │   ├── permission.middleware.ts  # Permission checking
│   │   └── rate-limit.middleware.ts  # Rate limiting
│   ├── controllers/
│   │   ├── auth.controller.ts        # Auth endpoints
│   │   ├── user.controller.ts        # User endpoints
│   │   ├── sticker.controller.ts     # Sticker endpoints
│   │   ├── share.controller.ts       # Share endpoints
│   │   ├── admin.controller.ts       # Admin endpoints
│   │   ├── generate.controller.ts    # Updated with auth
│   │   ├── grid.controller.ts        # Updated with auth
│   │   └── background.controller.ts  # Updated with auth
│   ├── utils/
│   │   └── password.ts               # Password hashing
│   └── app.ts                        # Updated routes
├── docker-compose.yml
├── Dockerfile
├── .env.example                      # Updated
└── tests/
    ├── unit/
    │   ├── services/
    │   │   ├── auth.service.test.ts
    │   │   ├── user.service.test.ts
    │   │   └── role.service.test.ts
    │   └── middleware/
    │       └── auth.middleware.test.ts
    └── integration/
        └── auth.routes.test.ts
```

---

## Phase 1: Foundation - Database, Docker, Storage

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Prisma and database dependencies**

Run: `npm install @prisma/client bcrypt jsonwebtoken express-rate-limit ioredis`
Run: `npm install -D prisma @types/bcrypt @types/jsonwebtoken @faker-js/faker`

Expected: packages installed successfully

- [ ] **Step 2: Commit dependency changes**

```bash
git add package.json package-lock.json
git commit -m "deps: add prisma, bcrypt, jwt, rate-limit, redis"
```

---

### Task 2: Setup Prisma Schema

**Files:**
- Create: `prisma/schema.prisma`
- Create: `prisma/seed.ts`

- [ ] **Step 1: Create Prisma schema file**

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Role {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  createdAt   DateTime @default(now())
  
  users       User[]
  permissions RolePermission[]
}

model Permission {
  id          String   @id @default(uuid())
  name        String   @unique
  description String?
  resource    String
  action      String
  createdAt   DateTime @default(now())
  
  roles RolePermission[]
}

model RolePermission {
  roleId       String
  permissionId String
  
  role       Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  
  @@id([roleId, permissionId])
}

model User {
  id            String   @id @default(uuid())
  email         String   @unique
  passwordHash  String
  username      String?  @unique
  displayName   String?
  roleId        String
  isActive      Boolean  @default(true)
  emailVerified Boolean  @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  
  role         Role            @relation(fields: [roleId], references: [id])
  stickers     Sticker[]
  shares       StickerShare[]  @relation("SharedWith")
  sharesGiven  StickerShare[]  @relation("GrantedBy")
  shareLinks   StickerShareLink[] @relation("CreatedBy")
  refreshTokens RefreshToken[]
}

model Sticker {
  id          String   @id @default(uuid())
  ownerId     String
  name        String?
  filename    String
  url         String?
  visibility  String   // 'public', 'private', 'link_only'
  width       Int?
  height      Int?
  fileSize    Int?
  mimeType    String?
  metadata    Json?    @default("{}")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  deletedAt   DateTime?
  
  owner       User             @relation(fields: [ownerId], references: [id])
  shares      StickerShare[]
  shareLinks  StickerShareLink[]
  
  @@index([ownerId])
  @@index([visibility])
}

model StickerShare {
  id           String   @id @default(uuid())
  stickerId    String
  sharedWithId String
  permission   String   @default("view") // 'view', 'full'
  grantedBy    String
  createdAt    DateTime @default(now())
  expiresAt    DateTime?
  
  sticker    Sticker @relation(fields: [stickerId], references: [id], onDelete: Cascade)
  sharedWith User    @relation("SharedWith", fields: [sharedWithId], references: [id])
  grantor    User    @relation("GrantedBy", fields: [grantedBy], references: [id])
  
  @@index([stickerId])
  @@index([sharedWithId])
}

model StickerShareLink {
  id        String   @id @default(uuid())
  stickerId String
  token     String   @unique
  permission String  @default("view") // 'view', 'full'
  createdBy String
  expiresAt DateTime?
  maxUses   Int?
  usesCount Int      @default(0)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  
  sticker Sticker @relation(fields: [stickerId], references: [id], onDelete: Cascade)
  creator User    @relation("CreatedBy", fields: [createdBy], references: [id])
  
  @@index([stickerId])
  @@index([token])
}

model RefreshToken {
  id        String   @id @default(uuid())
  userId    String
  token     String
  expiresAt DateTime
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  
  @@index([userId])
  @@index([token])
}
```

- [ ] **Step 2: Create Prisma seed file**

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create roles
  const userRole = await prisma.role.upsert({
    where: { name: 'user' },
    update: {},
    create: {
      name: 'user',
      description: 'Standard user with basic permissions',
    },
  });

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Administrator with full access',
    },
  });

  // Create permissions
  const permissions = [
    { name: 'sticker:read', resource: 'sticker', action: 'read', description: 'View stickers' },
    { name: 'sticker:write', resource: 'sticker', action: 'write', description: 'Create/update stickers' },
    { name: 'sticker:delete', resource: 'sticker', action: 'delete', description: 'Delete stickers' },
    { name: 'sticker:share', resource: 'sticker', action: 'share', description: 'Share stickers' },
    { name: 'user:read', resource: 'user', action: 'read', description: 'View user profiles' },
    { name: 'user:write', resource: 'user', action: 'write', description: 'Update user profiles' },
    { name: 'user:delete', resource: 'user', action: 'delete', description: 'Delete users' },
    { name: 'admin:access', resource: 'admin', action: 'read', description: 'Access admin features' },
  ];

  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  // Assign permissions to roles
  const userPermissions = ['sticker:read', 'sticker:write', 'sticker:delete', 'sticker:share', 'user:read', 'user:write'];
  for (const permName of userPermissions) {
    const perm = await prisma.permission.findUnique({ where: { name: permName } });
    if (perm) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: userRole.id, permissionId: perm.id } },
        update: {},
        create: { roleId: userRole.id, permissionId: perm.id },
      });
    }
  }

  // Admin gets all permissions
  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id } },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // Create default admin user
  const adminPassword = await bcrypt.hash('Admin123!', 12);
  await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      passwordHash: adminPassword,
      username: 'admin',
      displayName: 'Administrator',
      roleId: adminRole.id,
    },
  });

  console.log('✅ Seed completed successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

- [ ] **Step 3: Add seed script to package.json**

```json
{
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/seed.ts package.json
git commit -m "feat: add prisma schema with auth and sticker models"
```

---

### Task 3: Update Configuration

**Files:**
- Modify: `src/config/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update config with auth and database settings**

```typescript
// src/config/index.ts
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const imglyBgModelRaw = process.env.IMGLY_BG_MODEL;
const imglyBgModel: 'small' | 'medium' | 'large' =
  imglyBgModelRaw === 'small' || imglyBgModelRaw === 'large' ? imglyBgModelRaw : 'medium';

const defaultImglyAssetsDir = path.join(
  process.cwd(),
  'node_modules',
  '@imgly',
  'background-removal-node',
  'dist'
);

const animatedGifMaxFrames = Math.max(1, parseInt(process.env.ANIMATED_GIF_MAX_FRAMES ?? '120', 10));
const animatedGifMaxMegapixelsPerFrame = Math.max(
  0.25,
  parseFloat(process.env.ANIMATED_GIF_MAX_MEGAPIXELS_PER_FRAME ?? '12')
);

const animatedGifDitherRaw = parseFloat(process.env.ANIMATED_GIF_DITHER ?? '0');
const animatedGifDither =
  Number.isFinite(animatedGifDitherRaw) ? Math.min(1, Math.max(0, animatedGifDitherRaw)) : 0.4;

const animatedGifReusePalette = process.env.ANIMATED_GIF_REUSE_PALETTE === 'true';

const animatedGifAlphaBoostRaw = parseFloat(process.env.ANIMATED_GIF_ALPHA_BOOST_DIVISOR ?? '0.76');
const animatedGifAlphaBoostDivisor =
  Number.isFinite(animatedGifAlphaBoostRaw) && animatedGifAlphaBoostRaw > 0.5 && animatedGifAlphaBoostRaw < 1
    ? animatedGifAlphaBoostRaw
    : 0.76;

let animatedGifAlphaCloseKernel = parseInt(process.env.ANIMATED_GIF_ALPHA_CLOSE_KERNEL ?? '5', 10);
if (!Number.isFinite(animatedGifAlphaCloseKernel) || animatedGifAlphaCloseKernel <= 0) {
  animatedGifAlphaCloseKernel = 0;
} else {
  animatedGifAlphaCloseKernel = Math.min(7, animatedGifAlphaCloseKernel);
  if (animatedGifAlphaCloseKernel % 2 === 0) {
    animatedGifAlphaCloseKernel += 1;
  }
}

const cornerBgStripRaw = parseFloat(process.env.ANIMATED_GIF_CORNER_BG_STRIP_DIST ?? '64');
const animatedGifCornerBgStripDist =
  Number.isFinite(cornerBgStripRaw) && cornerBgStripRaw > 5 && cornerBgStripRaw < 120
    ? cornerBgStripRaw
    : 64;

const temporalAlphaHalf = Math.min(
  10,
  Math.max(0, parseInt(process.env.ANIMATED_GIF_TEMPORAL_ALPHA_MAX_HALF ?? '3', 10))
);
const temporalAlphaPasses = Math.min(
  5,
  Math.max(1, parseInt(process.env.ANIMATED_GIF_TEMPORAL_ALPHA_PASSES ?? '3', 10))
);

let temporalDilateAlphaKernel = parseInt(process.env.ANIMATED_GIF_TEMPORAL_DILATE_ALPHA ?? '5', 10);
if (!Number.isFinite(temporalDilateAlphaKernel) || temporalDilateAlphaKernel <= 0) {
  temporalDilateAlphaKernel = 0;
} else {
  temporalDilateAlphaKernel = Math.min(7, temporalDilateAlphaKernel);
  if (temporalDilateAlphaKernel % 2 === 0) {
    temporalDilateAlphaKernel += 1;
  }
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10),
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  
  // Database
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://stickeruser:stickerpass@localhost:5432/stickerdb?schema=public',
  
  // Redis
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  
  // JWT
  jwtSecret: process.env.JWT_SECRET ?? 'your-secret-key-change-in-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'your-refresh-secret-change-in-production',
  jwtAccessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
  jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
  
  // Storage
  storageProvider: process.env.STORAGE_PROVIDER ?? 'local',
  
  imglyBackgroundRemoval: {
    publicPath: process.env.IMGLY_BG_PUBLIC_PATH ?? defaultImglyAssetsDir,
    model: imglyBgModel,
    maxConcurrency: Math.max(1, parseInt(process.env.IMGLY_BG_MAX_CONCURRENCY ?? '2', 10)),
  },
  animatedGif: {
    maxFrames: animatedGifMaxFrames,
    maxMegapixelsPerFrame: animatedGifMaxMegapixelsPerFrame,
    gifDither: animatedGifDither,
    reusePalette: animatedGifReusePalette,
    alphaBoostDivisor: animatedGifAlphaBoostDivisor,
    alphaCloseKernel: animatedGifAlphaCloseKernel,
    cornerBackgroundStripDistance: animatedGifCornerBgStripDist,
    temporalAlphaMaxHalf: temporalAlphaHalf,
    temporalAlphaPasses: temporalAlphaPasses,
    temporalDilateAlphaKernel: temporalDilateAlphaKernel,
  },
  models: {
    imageGeneration: 'google/gemini-2.5-flash-image',
    agent: 'google/gemini-2.5-flash-lite',
  },
} as const;

export type Config = typeof config;
```

- [ ] **Step 2: Update .env.example**

```
# Server
PORT=3000
NODE_ENV=development
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://stickeruser:stickerpass@localhost:5432/stickerdb?schema=public
DB_USER=stickeruser
DB_PASSWORD=stickerpass
DB_NAME=stickerdb
DB_PORT=5432

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379

# JWT
JWT_SECRET=your_jwt_secret_min_32_chars_long
JWT_REFRESH_SECRET=your_refresh_secret_min_32_chars_long
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# API Keys
OPENROUTER_API_KEY=your_openrouter_api_key_here

# App
APP_URL=http://localhost:3000
MAX_FILE_SIZE=10485760
UPLOAD_DIR=uploads
CORS_ORIGIN=*

# Storage
STORAGE_PROVIDER=local
# AWS_S3_BUCKET=your-bucket
# AWS_S3_REGION=us-east-1
# AWS_ACCESS_KEY_ID=your-key
# AWS_SECRET_ACCESS_KEY=your-secret
```

- [ ] **Step 3: Commit**

```bash
git add src/config/index.ts .env.example
git commit -m "feat: update config with auth, database, and redis settings"
```

---

### Task 4: Create Prisma Client Singleton

**Files:**
- Create: `src/prisma/client.ts`

- [ ] **Step 1: Create Prisma client singleton**

```typescript
// src/prisma/client.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
```

- [ ] **Step 2: Commit**

```bash
git add src/prisma/client.ts
git commit -m "feat: add prisma client singleton"
```

---

### Task 5: Create Storage Provider Pattern

**Files:**
- Create: `src/storage/interface.ts`
- Create: `src/storage/local.provider.ts`

- [ ] **Step 1: Create storage interface**

```typescript
// src/storage/interface.ts
export interface SaveFileOptions {
  extension?: string;
  subDir?: string;
  baseName?: string;
  ownerId?: string;
}

export interface IStorageProvider {
  saveFile(buffer: Buffer, options: SaveFileOptions): Promise<string>;
  getFilePath(filename: string): string;
  fileExists(filename: string): Promise<boolean>;
  deleteFile(filename: string): Promise<void>;
  getPublicUrl(filename: string): string;
}
```

- [ ] **Step 2: Create local storage provider**

```typescript
// src/storage/local.provider.ts
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { IStorageProvider, SaveFileOptions } from './interface';

export class LocalStorageProvider implements IStorageProvider {
  private uploadDir: string;

  constructor(uploadDir: string = config.uploadDir) {
    this.uploadDir = uploadDir;
  }

  async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  async saveFile(buffer: Buffer, options: SaveFileOptions = {}): Promise<string> {
    const extension = options.extension ?? 'png';
    const subDir = options.subDir ? options.subDir.trim() : '';
    const baseName = options.baseName?.trim();
    const ownerId = options.ownerId;

    // Build user-scoped path if ownerId provided
    let targetDir = this.uploadDir;
    if (ownerId) {
      targetDir = path.join(targetDir, 'users', ownerId, 'stickers');
    }
    if (subDir) {
      targetDir = path.join(targetDir, subDir);
    }

    await this.ensureDir(targetDir);

    const safeBaseName = baseName
      ? baseName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
      : uuidv4();
    const filename = `${safeBaseName}.${extension}`;
    const filepath = path.join(targetDir, filename);
    await fs.writeFile(filepath, buffer);

    // Calculate relative path from uploadDir
    const relativePath = path.relative(this.uploadDir, filepath);
    return relativePath.split(path.sep).join('/');
  }

  getFilePath(filename: string): string {
    return path.join(this.uploadDir, filename);
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.uploadDir, filename));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(filename: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.uploadDir, filename));
    } catch {
      // Ignore deletion errors
    }
  }

  getPublicUrl(filename: string): string {
    const normalized = filename.split('\\').join('/');
    return `/uploads/${normalized}`;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/storage/
git commit -m "feat: add storage provider abstraction with user-scoped local storage"
```

---

### Task 6: Setup Docker Environment

**Files:**
- Create: `docker-compose.yml`
- Create: `Dockerfile`

- [ ] **Step 1: Create docker-compose.yml**

```yaml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "${PORT:-3000}:3000"
    environment:
      - NODE_ENV=${NODE_ENV:-development}
      - PORT=3000
      - DATABASE_URL=postgresql://${DB_USER:-stickeruser}:${DB_PASSWORD:-stickerpass}@postgres:5432/${DB_NAME:-stickerdb}?schema=public
      - OPENROUTER_API_KEY=${OPENROUTER_API_KEY}
      - APP_URL=${APP_URL:-http://localhost:3000}
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - MAX_FILE_SIZE=${MAX_FILE_SIZE:-10485760}
      - UPLOAD_DIR=/app/uploads
      - CORS_ORIGIN=${CORS_ORIGIN:-*}
      - REDIS_URL=redis://redis:6379
    volumes:
      - uploads:/app/uploads
      - ./.env:/app/.env:ro
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    networks:
      - sticker-network

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=${DB_USER:-stickeruser}
      - POSTGRES_PASSWORD=${DB_PASSWORD:-stickerpass}
      - POSTGRES_DB=${DB_NAME:-stickerdb}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "${DB_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-stickeruser} -d ${DB_NAME:-stickerdb}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - sticker-network

  redis:
    image: redis:7-alpine
    ports:
      - "${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    networks:
      - sticker-network

volumes:
  postgres_data:
  redis_data:
  uploads:

networks:
  sticker-network:
    driver: bridge
```

- [ ] **Step 2: Create Dockerfile**

```dockerfile
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN npx prisma generate
RUN mkdir -p uploads && chown -R node:node uploads

EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml Dockerfile
git commit -m "feat: add docker compose and dockerfile for development"
```

---

## Phase 2: Authentication

### Task 7: Create Password Utilities

**Files:**
- Create: `src/utils/password.ts`

- [ ] **Step 1: Create password hashing utilities**

```typescript
// src/utils/password.ts
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/password.ts
git commit -m "feat: add password hashing utilities"
```

---

### Task 8: Create New Error Types

**Files:**
- Modify: `src/errors/index.ts`

- [ ] **Step 1: Add authentication and authorization errors**

```typescript
// src/errors/index.ts

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string = 'Request validation failed') {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class InvalidFileTypeError extends AppError {
  constructor(message: string = 'Only PNG, JPG, JPEG, WebP, and GIF are allowed') {
    super(message, 415, 'INVALID_FILE_TYPE');
  }
}

export class FileTooLargeError extends AppError {
  constructor(message: string = 'File size exceeds the maximum allowed size') {
    super(message, 413, 'FILE_TOO_LARGE');
  }
}

export class AIGenerationError extends AppError {
  constructor(message: string = 'AI generation failed') {
    super(message, 502, 'AI_GENERATION_FAILED');
  }
}

export class GridDetectionError extends AppError {
  constructor(message: string = 'Grid detection failed') {
    super(message, 422, 'GRID_DETECTION_FAILED');
  }
}

export class BackgroundRemovalError extends AppError {
  constructor(message: string = 'Background removal failed') {
    super(message, 500, 'BACKGROUND_REMOVAL_FAILED');
  }
}

export class ProviderError extends AppError {
  constructor(message: string = 'AI provider returned an error') {
    super(message, 502, 'PROVIDER_ERROR');
  }
}

export class TimeoutError extends AppError {
  constructor(message: string = 'Request timed out') {
    super(message, 504, 'TIMEOUT_ERROR');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/errors/index.ts
git commit -m "feat: add auth and authorization error types"
```

---

### Task 9: Create Auth Service

**Files:**
- Create: `src/services/auth.service.ts`

- [ ] **Step 1: Create JWT auth service**

```typescript
// src/services/auth.service.ts
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { hashPassword, comparePassword } from '../utils/password';
import { ValidationError, UnauthorizedError, ConflictError } from '../errors';

export interface RegisterInput {
  email: string;
  password: string;
  username?: string;
  displayName?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  async register(input: RegisterInput): Promise<{ user: { id: string; email: string; username: string | null; displayName: string | null }; tokens: AuthTokens }> {
    // Validate password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(input.password)) {
      throw new ValidationError(
        'Password must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special character'
      );
    }

    // Check if email exists
    const existingEmail = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existingEmail) {
      throw new ConflictError('Email already registered');
    }

    // Check if username exists
    if (input.username) {
      const existingUsername = await prisma.user.findUnique({
        where: { username: input.username },
      });
      if (existingUsername) {
        throw new ConflictError('Username already taken');
      }
    }

    // Get default user role
    const userRole = await prisma.role.findUnique({
      where: { name: 'user' },
    });
    if (!userRole) {
      throw new Error('Default user role not found. Please run database seed.');
    }

    // Hash password
    const passwordHash = await hashPassword(input.password);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        username: input.username,
        displayName: input.displayName,
        roleId: userRole.id,
      },
      select: {
        id: true,
        email: true,
        username: true,
        displayName: true,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokenPair(user.id, user.email, 'user');

    return { user, tokens };
  }

  async login(input: LoginInput): Promise<{ user: { id: string; email: string; username: string | null; displayName: string | null; role: string }; tokens: AuthTokens }> {
    // Find user
    const user = await prisma.user.findUnique({
      where: { email: input.email },
      include: { role: true },
    });
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    // Verify password
    const isValid = await comparePassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Generate tokens
    const tokens = await this.generateTokenPair(user.id, user.email, user.role.name);

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        displayName: user.displayName,
        role: user.role.name,
      },
      tokens,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    // Delete refresh token from DB
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, config.jwtRefreshSecret) as TokenPayload;

    // Check if token exists in DB
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        userId: decoded.userId,
      },
    });

    if (!storedToken) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Check if token is expired
    if (storedToken.expiresAt < new Date()) {
      await prisma.refreshToken.delete({ where: { id: storedToken.id } });
      throw new UnauthorizedError('Refresh token expired');
    }

    // Delete old refresh token
    await prisma.refreshToken.delete({ where: { id: storedToken.id } });

    // Generate new token pair
    return this.generateTokenPair(decoded.userId, decoded.email, decoded.role);
  }

  async getCurrentUser(userId: string): Promise<{ id: string; email: string; username: string | null; displayName: string | null; role: string } | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      role: user.role.name,
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    // Verify current password
    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Current password is incorrect');
    }

    // Validate new password
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      throw new ValidationError(
        'Password must be at least 8 characters with 1 uppercase, 1 lowercase, 1 number, and 1 special character'
      );
    }

    // Hash and update new password
    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newHash },
    });

    // Delete all refresh tokens for this user
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  private async generateTokenPair(userId: string, email: string, role: string): Promise<AuthTokens> {
    const payload: TokenPayload = { userId, email, role };

    // Generate access token
    const accessToken = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.jwtAccessExpiration,
    });

    // Generate refresh token
    const refreshToken = jwt.sign(payload, config.jwtRefreshSecret, {
      expiresIn: config.jwtRefreshExpiration,
    });

    // Store refresh token in DB
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/auth.service.ts
git commit -m "feat: add auth service with jwt token management"
```

---

### Task 10: Create Auth Middleware

**Files:**
- Create: `src/middleware/auth.middleware.ts`

- [ ] **Step 1: Create JWT verification middleware**

```typescript
// src/middleware/auth.middleware.ts
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../prisma/client';
import { UnauthorizedError } from '../errors';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedError('Access token required');
    }

    const token = authHeader.substring(7);

    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret) as {
      userId: string;
      email: string;
      role: string;
    };

    // Check if user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { role: true },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!user.isActive) {
      throw new UnauthorizedError('Account is deactivated');
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role.name,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      next(new UnauthorizedError('Invalid access token'));
    } else if (error instanceof jwt.TokenExpiredError) {
      next(new UnauthorizedError('Access token expired'));
    } else {
      next(error);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/middleware/auth.middleware.ts
git commit -m "feat: add jwt authentication middleware"
```

---

### Task 11: Create Auth Controller

**Files:**
- Create: `src/controllers/auth.controller.ts`

- [ ] **Step 1: Create auth controller with endpoints**

```typescript
// src/controllers/auth.controller.ts
import type { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class AuthController {
  private authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  async register(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      
      if (!body.email || !body.password) {
        throw new ValidationError('Email and password are required');
      }

      const result = await this.authService.register({
        email: String(body.email),
        password: String(body.password),
        username: body.username ? String(body.username) : undefined,
        displayName: body.displayName ? String(body.displayName) : undefined,
      });

      // Set refresh token as httpOnly cookie
      res.cookie('refresh_token', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(201).json(
        buildSuccessResponse({
          user: result.user,
          accessToken: result.tokens.accessToken,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const body = req.body as Record<string, unknown>;
      
      if (!body.email || !body.password) {
        throw new ValidationError('Email and password are required');
      }

      const result = await this.authService.login({
        email: String(body.email),
        password: String(body.password),
      });

      // Set refresh token as httpOnly cookie
      res.cookie('refresh_token', result.tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json(
        buildSuccessResponse({
          user: result.user,
          accessToken: result.tokens.accessToken,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async logout(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies?.refresh_token;
      
      if (refreshToken) {
        await this.authService.logout(refreshToken);
      }

      // Clear refresh token cookie
      res.clearCookie('refresh_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      res.status(200).json(buildSuccessResponse({ message: 'Logged out successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async refresh(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies?.refresh_token;
      
      if (!refreshToken) {
        throw new ValidationError('Refresh token required');
      }

      const tokens = await this.authService.refreshAccessToken(refreshToken);

      // Set new refresh token as httpOnly cookie
      res.cookie('refresh_token', tokens.refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      res.status(200).json(
        buildSuccessResponse({
          accessToken: tokens.accessToken,
        })
      );
    } catch (error) {
      next(error);
    }
  }

  async getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('User not authenticated');
      }

      const user = await this.authService.getCurrentUser(req.user.id);
      
      if (!user) {
        throw new ValidationError('User not found');
      }

      res.status(200).json(buildSuccessResponse({ user }));
    } catch (error) {
      next(error);
    }
  }

  async updateMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('User not authenticated');
      }

      const body = req.body as Record<string, unknown>;
      
      // TODO: Implement user update logic
      res.status(200).json(buildSuccessResponse({ message: 'User updated' }));
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('User not authenticated');
      }

      const body = req.body as Record<string, unknown>;
      
      if (!body.currentPassword || !body.newPassword) {
        throw new ValidationError('Current password and new password are required');
      }

      await this.authService.changePassword(
        req.user.id,
        String(body.currentPassword),
        String(body.newPassword)
      );

      // Clear refresh token cookie after password change
      res.clearCookie('refresh_token', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
      });

      res.status(200).json(buildSuccessResponse({ message: 'Password changed successfully' }));
    } catch (error) {
      next(error);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/auth.controller.ts
git commit -m "feat: add auth controller with register, login, logout, refresh endpoints"
```

---

## Phase 3: Authorization

### Task 12: Create Role Service

**Files:**
- Create: `src/services/role.service.ts`

- [ ] **Step 1: Create role and permission service**

```typescript
// src/services/role.service.ts
import { prisma } from '../prisma/client';

export class RoleService {
  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user) return [];

    return user.role.permissions.map((rp) => rp.permission.name);
  }

  async hasPermission(userId: string, permissionName: string): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissions.includes(permissionName) || permissions.includes('*');
  }

  async hasAnyPermission(userId: string, permissionNames: string[]): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissionNames.some((name) => permissions.includes(name) || permissions.includes('*'));
  }

  async hasAllPermissions(userId: string, permissionNames: string[]): Promise<boolean> {
    const permissions = await this.getUserPermissions(userId);
    return permissionNames.every((name) => permissions.includes(name) || permissions.includes('*'));
  }

  async isAdmin(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true },
    });

    return user?.role.name === 'admin';
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/role.service.ts
git commit -m "feat: add role service for permission checking"
```

---

### Task 13: Create Authorization Middleware

**Files:**
- Create: `src/middleware/role.middleware.ts`
- Create: `src/middleware/permission.middleware.ts`

- [ ] **Step 1: Create role middleware**

```typescript
// src/middleware/role.middleware.ts
import type { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { ForbiddenError } from '../errors';

export function requireRole(...allowedRoles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ForbiddenError('Authentication required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(new ForbiddenError(`Required role: ${allowedRoles.join(' or ')}`));
      return;
    }

    next();
  };
}
```

- [ ] **Step 2: Create permission middleware**

```typescript
// src/middleware/permission.middleware.ts
import type { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { RoleService } from '../services/role.service';
import { ForbiddenError } from '../errors';

const roleService = new RoleService();

export function requirePermission(...requiredPermissions: string[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      next(new ForbiddenError('Authentication required'));
      return;
    }

    const hasPermissions = await roleService.hasAllPermissions(req.user.id, requiredPermissions);
    
    if (!hasPermissions) {
      next(new ForbiddenError('Insufficient permissions'));
      return;
    }

    next();
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/middleware/role.middleware.ts src/middleware/permission.middleware.ts
git commit -m "feat: add role and permission middleware"
```

---

## Phase 4: Sticker Management

### Task 14: Create Sticker Service

**Files:**
- Create: `src/services/sticker.service.ts`

- [ ] **Step 1: Create sticker service with visibility logic**

```typescript
// src/services/sticker.service.ts
import { prisma } from '../prisma/client';
import { RoleService } from './role.service';
import { ValidationError, ForbiddenError, NotFoundError } from '../errors';

export interface CreateStickerInput {
  ownerId: string;
  name?: string;
  filename: string;
  url?: string;
  visibility?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateStickerInput {
  name?: string;
  visibility?: string;
}

export class StickerService {
  private roleService: RoleService;

  constructor() {
    this.roleService = new RoleService();
  }

  async create(input: CreateStickerInput) {
    const visibility = input.visibility ?? 'private';
    
    if (!['public', 'private', 'link_only'].includes(visibility)) {
      throw new ValidationError('Visibility must be public, private, or link_only');
    }

    return prisma.sticker.create({
      data: {
        ownerId: input.ownerId,
        name: input.name,
        filename: input.filename,
        url: input.url,
        visibility,
        width: input.width,
        height: input.height,
        fileSize: input.fileSize,
        mimeType: input.mimeType,
        metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : {},
      },
    });
  }

  async findById(id: string) {
    return prisma.sticker.findUnique({
      where: { id, deletedAt: null },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });
  }

  async findByOwner(ownerId: string) {
    return prisma.sticker.findMany({
      where: { ownerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findPublic() {
    return prisma.sticker.findMany({
      where: { visibility: 'public', deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
      },
    });
  }

  async update(id: string, userId: string, input: UpdateStickerInput) {
    const sticker = await this.findById(id);
    
    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    // Check ownership or admin
    const isAdmin = await this.roleService.isAdmin(userId);
    if (sticker.ownerId !== userId && !isAdmin) {
      throw new ForbiddenError('Not authorized to update this sticker');
    }

    if (input.visibility && !['public', 'private', 'link_only'].includes(input.visibility)) {
      throw new ValidationError('Visibility must be public, private, or link_only');
    }

    return prisma.sticker.update({
      where: { id },
      data: {
        name: input.name,
        visibility: input.visibility,
        updatedAt: new Date(),
      },
    });
  }

  async delete(id: string, userId: string) {
    const sticker = await this.findById(id);
    
    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    // Check ownership or admin
    const isAdmin = await this.roleService.isAdmin(userId);
    if (sticker.ownerId !== userId && !isAdmin) {
      throw new ForbiddenError('Not authorized to delete this sticker');
    }

    // Soft delete
    return prisma.sticker.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async checkAccess(stickerId: string, userId: string | null, action: 'read' | 'write' | 'delete' | 'share' = 'read'): Promise<boolean> {
    const sticker = await prisma.sticker.findUnique({
      where: { id: stickerId, deletedAt: null },
      include: {
        shares: userId ? {
          where: { sharedWithId: userId },
        } : false,
      },
    });

    if (!sticker) return false;

    // Owner or admin always has access
    if (userId && (sticker.ownerId === userId || await this.roleService.isAdmin(userId))) {
      return true;
    }

    switch (sticker.visibility) {
      case 'public':
        return action === 'read';

      case 'private':
        if (userId && sticker.shares && sticker.shares.length > 0) {
          const share = sticker.shares[0];
          if (share.expiresAt && share.expiresAt < new Date()) return false;
          if (share.permission === 'full') return true;
          return action === 'read';
        }
        return false;

      case 'link_only':
        // Link-only access is checked via token in the controller
        return false;

      default:
        return false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/sticker.service.ts
git commit -m "feat: add sticker service with visibility and access control"
```

---

### Task 15: Create Share Service

**Files:**
- Create: `src/services/share.service.ts`

- [ ] **Step 1: Create share service for user and link sharing**

```typescript
// src/services/share.service.ts
import { prisma } from '../prisma/client';
import crypto from 'crypto';
import { ValidationError, ForbiddenError, NotFoundError } from '../errors';
import { RoleService } from './role.service';

export class ShareService {
  private roleService: RoleService;

  constructor() {
    this.roleService = new RoleService();
  }

  // Share with specific user
  async shareWithUser(stickerId: string, ownerId: string, sharedWithId: string, permission: 'view' | 'full' = 'view', expiresAt?: Date) {
    // Verify sticker ownership
    const sticker = await prisma.sticker.findUnique({
      where: { id: stickerId, deletedAt: null },
    });

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    const isAdmin = await this.roleService.isAdmin(ownerId);
    if (sticker.ownerId !== ownerId && !isAdmin) {
      throw new ForbiddenError('Not authorized to share this sticker');
    }

    // Check if user exists
    const sharedWithUser = await prisma.user.findUnique({
      where: { id: sharedWithId },
    });

    if (!sharedWithUser) {
      throw new NotFoundError('User not found');
    }

    // Create or update share
    const share = await prisma.stickerShare.upsert({
      where: {
        stickerId_sharedWithId: {
          stickerId,
          sharedWithId,
        },
      },
      update: {
        permission,
        expiresAt,
      },
      create: {
        stickerId,
        sharedWithId,
        permission,
        grantedBy: ownerId,
        expiresAt,
      },
    });

    return share;
  }

  async removeUserShare(stickerId: string, ownerId: string, sharedWithId: string) {
    const sticker = await prisma.sticker.findUnique({
      where: { id: stickerId, deletedAt: null },
    });

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    const isAdmin = await this.roleService.isAdmin(ownerId);
    if (sticker.ownerId !== ownerId && !isAdmin) {
      throw new ForbiddenError('Not authorized to modify shares');
    }

    await prisma.stickerShare.deleteMany({
      where: {
        stickerId,
        sharedWithId,
      },
    });
  }

  // Generate share link
  async createShareLink(stickerId: string, ownerId: string, permission: 'view' | 'full' = 'view', expiresAt?: Date, maxUses?: number) {
    const sticker = await prisma.sticker.findUnique({
      where: { id: stickerId, deletedAt: null },
    });

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    const isAdmin = await this.roleService.isAdmin(ownerId);
    if (sticker.ownerId !== ownerId && !isAdmin) {
      throw new ForbiddenError('Not authorized to create share links');
    }

    const token = crypto.randomBytes(32).toString('hex');

    const link = await prisma.stickerShareLink.create({
      data: {
        stickerId,
        token,
        permission,
        createdBy: ownerId,
        expiresAt,
        maxUses,
      },
    });

    return link;
  }

  async revokeShareLink(stickerId: string, ownerId: string, linkId: string) {
    const sticker = await prisma.sticker.findUnique({
      where: { id: stickerId, deletedAt: null },
    });

    if (!sticker) {
      throw new NotFoundError('Sticker not found');
    }

    const isAdmin = await this.roleService.isAdmin(ownerId);
    if (sticker.ownerId !== ownerId && !isAdmin) {
      throw new ForbiddenError('Not authorized to revoke share links');
    }

    await prisma.stickerShareLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });
  }

  async validateShareLink(token: string) {
    const link = await prisma.stickerShareLink.findUnique({
      where: { token },
      include: { sticker: true },
    });

    if (!link || !link.isActive) {
      return null;
    }

    if (link.expiresAt && link.expiresAt < new Date()) {
      return null;
    }

    if (link.maxUses && link.usesCount >= link.maxUses) {
      return null;
    }

    // Increment use count
    await prisma.stickerShareLink.update({
      where: { id: link.id },
      data: { usesCount: { increment: 1 } },
    });

    return link;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/share.service.ts
git commit -m "feat: add share service for user and link sharing"
```

---

### Task 16: Create Sticker Controller

**Files:**
- Create: `src/controllers/sticker.controller.ts`

- [ ] **Step 1: Create sticker controller**

```typescript
// src/controllers/sticker.controller.ts
import type { Response, NextFunction } from 'express';
import { StickerService } from '../services/sticker.service';
import { ShareService } from '../services/share.service';
import { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class StickerController {
  private stickerService: StickerService;
  private shareService: ShareService;

  constructor() {
    this.stickerService = new StickerService();
    this.shareService = new ShareService();
  }

  async getMyStickers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const stickers = await this.stickerService.findByOwner(req.user.id);
      
      res.status(200).json(buildSuccessResponse({ stickers }));
    } catch (error) {
      next(error);
    }
  }

  async getPublicStickers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const stickers = await this.stickerService.findPublic();
      
      res.status(200).json(buildSuccessResponse({ stickers }));
    } catch (error) {
      next(error);
    }
  }

  async getSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const shareToken = req.query.shareToken as string | undefined;

      const sticker = await this.stickerService.findById(id);
      
      if (!sticker) {
        throw new ValidationError('Sticker not found');
      }

      // Check access
      const userId = req.user?.id ?? null;
      let hasAccess = await this.stickerService.checkAccess(id, userId, 'read');

      // If no access and sticker is link-only, check share token
      if (!hasAccess && sticker.visibility === 'link_only' && shareToken) {
        const link = await this.shareService.validateShareLink(shareToken);
        if (link && link.stickerId === id) {
          hasAccess = true;
        }
      }

      if (!hasAccess) {
        throw new ValidationError('Access denied');
      }

      res.status(200).json(buildSuccessResponse({ sticker }));
    } catch (error) {
      next(error);
    }
  }

  async updateSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      const input: { name?: string; visibility?: string } = {};
      if (body.name) input.name = String(body.name);
      if (body.visibility) input.visibility = String(body.visibility);

      const sticker = await this.stickerService.update(id, req.user.id, input);
      
      res.status(200).json(buildSuccessResponse({ sticker }));
    } catch (error) {
      next(error);
    }
  }

  async deleteSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const { id } = req.params;

      await this.stickerService.delete(id, req.user.id);
      
      res.status(200).json(buildSuccessResponse({ message: 'Sticker deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async shareWithUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      if (!body.userId) {
        throw new ValidationError('userId is required');
      }

      const permission = body.permission === 'full' ? 'full' : 'view';
      const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : undefined;

      const share = await this.shareService.shareWithUser(
        id,
        req.user.id,
        String(body.userId),
        permission,
        expiresAt
      );

      res.status(201).json(buildSuccessResponse({ share }));
    } catch (error) {
      next(error);
    }
  }

  async removeUserShare(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      if (!body.userId) {
        throw new ValidationError('userId is required');
      }

      await this.shareService.removeUserShare(id, req.user.id, String(body.userId));

      res.status(200).json(buildSuccessResponse({ message: 'Share removed successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async createShareLink(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      const permission = body.permission === 'full' ? 'full' : 'view';
      const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : undefined;
      const maxUses = body.maxUses ? parseInt(String(body.maxUses), 10) : undefined;

      const link = await this.shareService.createShareLink(
        id,
        req.user.id,
        permission,
        expiresAt,
        maxUses
      );

      // Generate full share URL
      const shareUrl = `${req.protocol}://${req.get('host')}/api/v1/stickers/${id}?shareToken=${link.token}`;

      res.status(201).json(buildSuccessResponse({ 
        link: {
          ...link,
          shareUrl,
        }
      }));
    } catch (error) {
      next(error);
    }
  }

  async revokeShareLink(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user) {
        throw new ValidationError('Authentication required');
      }

      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      if (!body.linkId) {
        throw new ValidationError('linkId is required');
      }

      await this.shareService.revokeShareLink(id, req.user.id, String(body.linkId));

      res.status(200).json(buildSuccessResponse({ message: 'Share link revoked successfully' }));
    } catch (error) {
      next(error);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/sticker.controller.ts
git commit -m "feat: add sticker controller with crud and sharing"
```

---

### Task 17: Create Admin Controller

**Files:**
- Create: `src/controllers/admin.controller.ts`

- [ ] **Step 1: Create admin controller for user management**

```typescript
// src/controllers/admin.controller.ts
import type { Response, NextFunction } from 'express';
import { prisma } from '../prisma/client';
import { RoleService } from '../services/role.service';
import { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, ForbiddenError } from '../errors';

export class AdminController {
  private roleService: RoleService;

  constructor() {
    this.roleService = new RoleService();
  }

  async getUsers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      res.status(200).json(buildSuccessResponse({ users }));
    } catch (error) {
      next(error);
    }
  }

  async getUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!user) {
        throw new ValidationError('User not found');
      }

      res.status(200).json(buildSuccessResponse({ user }));
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        throw new ValidationError('User not found');
      }

      const updateData: Record<string, unknown> = {};
      if (body.displayName !== undefined) updateData.displayName = String(body.displayName);
      if (body.isActive !== undefined) updateData.isActive = Boolean(body.isActive);

      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          isActive: true,
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      res.status(200).json(buildSuccessResponse({ user: updatedUser }));
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // Prevent admin from deleting themselves
      if (id === req.user?.id) {
        throw new ForbiddenError('Cannot delete your own account');
      }

      await prisma.user.delete({
        where: { id },
      });

      res.status(200).json(buildSuccessResponse({ message: 'User deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async changeUserRole(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const body = req.body as Record<string, unknown>;

      if (!body.roleId) {
        throw new ValidationError('roleId is required');
      }

      const role = await prisma.role.findUnique({
        where: { id: String(body.roleId) },
      });

      if (!role) {
        throw new ValidationError('Role not found');
      }

      const updatedUser = await prisma.user.update({
        where: { id },
        data: { roleId: role.id },
        select: {
          id: true,
          email: true,
          username: true,
          displayName: true,
          role: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      res.status(200).json(buildSuccessResponse({ user: updatedUser }));
    } catch (error) {
      next(error);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/admin.controller.ts
git commit -m "feat: add admin controller for user management"
```

---

## Phase 5: Update Application Routes

### Task 18: Update App.ts with New Routes

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Update app.ts with authentication and new routes**

```typescript
// src/app.ts
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { apiReference } from '@scalar/express-api-reference';
import { config } from './config';
import { upload } from './middleware/upload-handler';
import { validateRequest } from './middleware/validate-request';
import { errorHandler } from './middleware/error-handler';
import { authenticate } from './middleware/auth.middleware';
import { requireRole } from './middleware/role.middleware';
import { generateImageSchema } from './utils/validators';
import { GenerateController } from './controllers/generate.controller';
import { GridController } from './controllers/grid.controller';
import { BackgroundController } from './controllers/background.controller';
import { AuthController } from './controllers/auth.controller';
import { StickerController } from './controllers/sticker.controller';
import { AdminController } from './controllers/admin.controller';

const app = express();

const openApiSpecPath = path.join(process.cwd(), 'docs', 'openapi.json');
const openApiSpec: Record<string, unknown> = JSON.parse(
  fs.readFileSync(openApiSpecPath, 'utf-8')
) as Record<string, unknown>;

app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net", "data:"],
        imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net"],
        connectSrc: ["'self'", "https://cdn.jsdelivr.net"],
      },
    },
  })
);
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use('/uploads', express.static(config.uploadDir));

// Controllers
const generateController = new GenerateController();
const gridController = new GridController();
const backgroundController = new BackgroundController();
const authController = new AuthController();
const stickerController = new StickerController();
const adminController = new AdminController();

// Auth routes (public)
app.post('/api/v1/auth/register', (req, res, next) => {
  authController.register(req, res, next).catch(next);
});

app.post('/api/v1/auth/login', (req, res, next) => {
  authController.login(req, res, next).catch(next);
});

app.post('/api/v1/auth/refresh', (req, res, next) => {
  authController.refresh(req, res, next).catch(next);
});

// Auth routes (protected)
app.post('/api/v1/auth/logout', authenticate, (req, res, next) => {
  authController.logout(req, res, next).catch(next);
});

app.get('/api/v1/auth/me', authenticate, (req, res, next) => {
  authController.getMe(req, res, next).catch(next);
});

app.put('/api/v1/auth/me', authenticate, (req, res, next) => {
  authController.updateMe(req, res, next).catch(next);
});

app.post('/api/v1/auth/change-password', authenticate, (req, res, next) => {
  authController.changePassword(req, res, next).catch(next);
});

// Sticker routes
app.get('/api/v1/stickers', authenticate, (req, res, next) => {
  stickerController.getMyStickers(req, res, next).catch(next);
});

app.get('/api/v1/stickers/public', (req, res, next) => {
  stickerController.getPublicStickers(req, res, next).catch(next);
});

app.get('/api/v1/stickers/:id', authenticate, (req, res, next) => {
  stickerController.getSticker(req, res, next).catch(next);
});

app.put('/api/v1/stickers/:id', authenticate, (req, res, next) => {
  stickerController.updateSticker(req, res, next).catch(next);
});

app.delete('/api/v1/stickers/:id', authenticate, (req, res, next) => {
  stickerController.deleteSticker(req, res, next).catch(next);
});

// Sharing routes
app.post('/api/v1/stickers/:id/share', authenticate, (req, res, next) => {
  stickerController.shareWithUser(req, res, next).catch(next);
});

app.delete('/api/v1/stickers/:id/share', authenticate, (req, res, next) => {
  stickerController.removeUserShare(req, res, next).catch(next);
});

app.post('/api/v1/stickers/:id/link', authenticate, (req, res, next) => {
  stickerController.createShareLink(req, res, next).catch(next);
});

app.delete('/api/v1/stickers/:id/link', authenticate, (req, res, next) => {
  stickerController.revokeShareLink(req, res, next).catch(next);
});

// Admin routes (admin only)
app.get('/api/v1/users', authenticate, requireRole('admin'), (req, res, next) => {
  adminController.getUsers(req, res, next).catch(next);
});

app.get('/api/v1/users/:id', authenticate, requireRole('admin'), (req, res, next) => {
  adminController.getUser(req, res, next).catch(next);
});

app.put('/api/v1/users/:id', authenticate, requireRole('admin'), (req, res, next) => {
  adminController.updateUser(req, res, next).catch(next);
});

app.delete('/api/v1/users/:id', authenticate, requireRole('admin'), (req, res, next) => {
  adminController.deleteUser(req, res, next).catch(next);
});

app.put('/api/v1/users/:id/role', authenticate, requireRole('admin'), (req, res, next) => {
  adminController.changeUserRole(req, res, next).catch(next);
});

// Existing routes (now protected)
app.post(
  '/api/v1/generate',
  authenticate,
  upload.single('image'),
  validateRequest(generateImageSchema),
  (req, res, next) => {
    generateController.generate(req, res, next).catch(next);
  }
);

app.post(
  '/api/v1/grid/split',
  authenticate,
  upload.single('image'),
  (req, res, next) => {
    gridController.split(req, res, next).catch(next);
  }
);

app.post(
  '/api/v1/background/remove',
  authenticate,
  upload.single('image'),
  (req, res, next) => {
    backgroundController.remove(req, res, next).catch(next);
  }
);

// Docs
app.get('/docs', apiReference({ spec: { content: openApiSpec } }));
app.get('/openapi.json', (_req, res) => {
  res.sendFile('openapi.json', { root: './docs' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

export default app;
```

- [ ] **Step 2: Commit**

```bash
git add src/app.ts
git commit -m "feat: add auth routes and protect existing endpoints"
```

---

## Phase 6: Update Existing Controllers

### Task 19: Update Generate Controller

**Files:**
- Modify: `src/controllers/generate.controller.ts`

- [ ] **Step 1: Update generate controller to save stickers with owner**

```typescript
// src/controllers/generate.controller.ts
import type { Request, Response, NextFunction } from 'express';
import { OpenRouterService } from '../services/openrouter.service';
import { ImageService } from '../services/image.service';
import { LocalStorageProvider } from '../storage/local.provider';
import { GridSplitService } from '../services/grid-split.service';
import { StickerService } from '../services/sticker.service';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import { resolveGridRowsCols } from '../utils/grid-layout';
import { config } from '../config';
import type { ImageResult, GenerationMetadata } from '../types';
import { AuthRequest } from '../middleware/auth.middleware';

const PROMPT_TRANSPARENT_STICKER_BG = `
Visual requirements (critical):
- The sticker subject must have NO rectangular backdrop: use real transparency (alpha) in all areas outside the subject outline.
- Do not paste the artwork on a white, gray, or full-bleed colored panel or "card".
- The PNG must have meaningful alpha: flat white fills behind the whole image are not acceptable.`;

function buildPromptSingle(text: string): string {
  return `Create a WhatsApp sticker: ${text}
${PROMPT_TRANSPARENT_STICKER_BG}`;
}

function buildPromptGrid(text: string, rows: number, cols: number): string {
  return `Create a WhatsApp sticker GRID SHEET: ${text}

Layout (critical):
- Exactly ${rows} rows and ${cols} columns (${rows * cols} cells total).
- Use straight horizontal and vertical separators (lines or clear gutters) so each cell can be cropped automatically.
- Every cell must contain BOTH:
  1) a clear visual subject (photo-style portrait/object/character), and
  2) a short readable caption text inside the same cell.
- Do not leave any cell without text. Do not place text outside the cell boundaries.
- One distinct sticker per cell; keep all artwork and caption text fully inside its cell with safe margins.

${PROMPT_TRANSPARENT_STICKER_BG}`;
}

export class GenerateController {
  private openRouterService: OpenRouterService;
  private imageService: ImageService;
  private storageService: LocalStorageProvider;
  private gridSplitService: GridSplitService;
  private stickerService: StickerService;

  constructor() {
    this.openRouterService = new OpenRouterService();
    this.imageService = new ImageService();
    this.storageService = new LocalStorageProvider();
    this.gridSplitService = new GridSplitService(
      this.openRouterService,
      this.imageService,
      this.storageService
    );
    this.stickerService = new StickerService();
  }

  async generate(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw new ValidationError('Authentication required');
      }

      const body = req.body as Record<string, unknown>;
      const text = String(body.text ?? '');
      const grid = Boolean(body.grid);
      const normalize = Boolean(body.normalize);
      const file = req.file;

      if (!text || text.trim().length === 0) {
        throw new ValidationError('Text prompt is required');
      }

      let base64Image: string | undefined;
      let imageMimeType = 'image/png';
      if (file) {
        base64Image = file.buffer.toString('base64');
        if (file.mimetype && /^image\/[a-z0-9.+-]+$/i.test(file.mimetype)) {
          imageMimeType = file.mimetype;
        }
      }

      let prompt: string;
      let gridDims: { rows: number; cols: number } | null = null;

      if (grid) {
        gridDims = resolveGridRowsCols({
          rows: body.rows as number | undefined,
          cols: body.cols as number | undefined,
          layout: body.layout as string | undefined,
        });
        prompt = buildPromptGrid(text, gridDims.rows, gridDims.cols);
      } else {
        prompt = buildPromptSingle(text);
      }

      const { imageBuffer, metadata: aiMetadata } = await this.openRouterService.generateImage(
        prompt,
        base64Image,
        imageMimeType
      );

      let images: ImageResult[] = [];
      const requestTimestamp = Date.now();

      if (grid && gridDims) {
        const { images: gridImages, metadata: gridMeta } = await this.gridSplitService.split(
          imageBuffer,
          {
            rows: gridDims.rows,
            cols: gridDims.cols,
            normalize,
            outputSubDir: `generate-grid/${requestTimestamp}`,
          }
        );
        images = gridImages;

        // Save stickers to database
        for (const image of images) {
          const filename = image.url.replace('/uploads/', '');
          await this.stickerService.create({
            ownerId: userId,
            name: `${text} - Grid Cell`,
            filename,
            url: image.url,
            visibility: 'private',
            width: image.width,
            height: image.height,
            metadata: {
              model: config.models.imageGeneration,
              ...aiMetadata,
              gridLayout: gridMeta.gridLayout,
            },
          });
        }

        const metadata: GenerationMetadata = {
          model: config.models.imageGeneration,
          ...aiMetadata,
          gridLayout: gridMeta.gridLayout,
          cellCount: gridMeta.cellCount,
          normalizedImageUrl: gridMeta.normalizedImageUrl,
          outputSize: gridMeta.outputSize,
          normalized: gridMeta.normalized,
          backgroundRemoved: gridMeta.backgroundRemoved,
          backgroundRemovalMethod: gridMeta.backgroundRemovalMethod ?? 'none',
        };

        res.status(200).json(
          buildSuccessResponse({
            images,
            metadata,
          })
        );
        return;
      }

      // Single sticker generation
      const squareBuffer = await this.imageService.resizeToSquareContain(imageBuffer, 512);
      const filename = await this.storageService.saveFile(squareBuffer, {
        extension: 'png',
        subDir: `generate/${requestTimestamp}`,
        baseName: 'generated-sticker',
        ownerId: userId,
      });
      const dimensions = await this.imageService.getImageDimensions(squareBuffer);
      
      const publicUrl = this.storageService.getPublicUrl(filename);
      
      images.push({
        id: filename.split('/').pop()?.replace('.png', '') ?? `generated-sticker-${requestTimestamp}`,
        url: publicUrl,
        width: dimensions.width,
        height: dimensions.height,
      });

      // Save to database
      await this.stickerService.create({
        ownerId: userId,
        name: text,
        filename,
        url: publicUrl,
        visibility: 'private',
        width: dimensions.width,
        height: dimensions.height,
        metadata: {
          model: config.models.imageGeneration,
          ...aiMetadata,
        },
      });

      const metadata: GenerationMetadata = {
        model: config.models.imageGeneration,
        ...aiMetadata,
        outputSize: '512x512',
        backgroundRemoved: false,
        backgroundRemovalMethod: 'none',
      };

      res.status(200).json(
        buildSuccessResponse({
          images,
          metadata,
        })
      );
    } catch (error) {
      next(error);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/controllers/generate.controller.ts
git commit -m "feat: update generate controller to save stickers with owner"
```

---

## Phase 7: Run Migrations and Seed

### Task 20: Initialize Database

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Run Prisma migration**

Run: `npx prisma migrate dev --name init`

Expected: Migration created and applied

- [ ] **Step 2: Run seed script**

Run: `npx prisma db seed`

Expected: Default roles, permissions, and admin user created

- [ ] **Step 3: Verify database**

Run: `npx prisma studio`

Expected: Prisma Studio opens showing all tables with seed data

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/ package.json
git commit -m "feat: add database migrations and seed data"
```

---

## Phase 8: Testing

### Task 21: Create Unit Tests

**Files:**
- Create: `tests/unit/services/auth.service.test.ts`
- Create: `tests/unit/middleware/auth.middleware.test.ts`

- [ ] **Step 1: Create auth service tests**

```typescript
// tests/unit/services/auth.service.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthService } from '../../../src/services/auth.service';
import { prisma } from '../../../src/prisma/client';
import { ValidationError, UnauthorizedError, ConflictError } from '../../../src/errors';

vi.mock('../../../src/prisma/client', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    authService = new AuthService();
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('should register a new user successfully', async () => {
      const mockRole = { id: 'role-1', name: 'user' };
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
      };

      vi.mocked(prisma.role.findUnique).mockResolvedValue(mockRole as never);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
      vi.mocked(prisma.user.create).mockResolvedValue(mockUser as never);

      const result = await authService.register({
        email: 'test@example.com',
        password: 'SecurePass123!',
        username: 'testuser',
        displayName: 'Test User',
      });

      expect(result.user).toEqual(mockUser);
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('should throw error for weak password', async () => {
      await expect(
        authService.register({
          email: 'test@example.com',
          password: 'weak',
        })
      ).rejects.toThrow(ValidationError);
    });

    it('should throw error for duplicate email', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: '1' } as never);

      await expect(
        authService.register({
          email: 'existing@example.com',
          password: 'SecurePass123!',
        })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('login', () => {
    it('should login with valid credentials', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        username: 'testuser',
        displayName: 'Test User',
        passwordHash: '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/X4.VTtYA.qGZvKG6G',
        isActive: true,
        role: { name: 'user' },
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

      const result = await authService.login({
        email: 'test@example.com',
        password: 'SecurePass123!',
      });

      expect(result.user.email).toBe('test@example.com');
      expect(result.tokens.accessToken).toBeDefined();
    });

    it('should throw error for invalid credentials', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'password',
        })
      ).rejects.toThrow(UnauthorizedError);
    });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/unit/services/auth.service.test.ts tests/unit/middleware/auth.middleware.test.ts
git commit -m "test: add auth service and middleware unit tests"
```

---

### Task 22: Create Integration Tests

**Files:**
- Create: `tests/integration/auth.routes.test.ts`

- [ ] **Step 1: Create auth routes integration test**

```typescript
// tests/integration/auth.routes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import { prisma } from '../../src/prisma/client';

describe('Auth Routes', () => {
  beforeAll(async () => {
    // Clean up test data
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany({ where: { email: { contains: 'test' } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123!',
          username: 'testuser',
          displayName: 'Test User',
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.user.email).toBe('test@example.com');
      expect(response.body.data.accessToken).toBeDefined();
      expect(response.headers['set-cookie']).toBeDefined();
    });

    it('should reject weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: 'test2@example.com',
          password: 'weak',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'SecurePass123!',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.accessToken).toBeDefined();
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'test@example.com',
          password: 'wrongpassword',
        });

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/integration/auth.routes.test.ts
git commit -m "test: add auth routes integration tests"
```

---

## Phase 9: Verification

### Task 23: Run Lint and Type Check

- [ ] **Step 1: Run linter**

Run: `npm run lint`

Expected: No linting errors

- [ ] **Step 2: Run type check**

Run: `npm run typecheck`

Expected: No TypeScript errors

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: All tests pass

- [ ] **Step 4: Commit final changes**

```bash
git add .
git commit -m "feat: complete auth and authorization implementation"
```

---

## Implementation Complete

Plan complete and saved to `docs/superpowers/plans/2025-05-07-auth-authorization-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach do you prefer?
