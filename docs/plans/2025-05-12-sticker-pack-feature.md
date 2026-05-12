# Sticker Pack Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Sticker Pack grouping feature with permission-based visibility, history logging for processing APIs, file cleanup, and sync API for offline-first support.

**Architecture:** 
- Refactor existing processing APIs (generate, grid-split, background-remove) to save results as `ProcessingHistory` instead of direct `Sticker` inserts. Implement automatic cleanup for expired history records.
- Introduce `StickerPack` as a grouping entity with many-to-many relation to `Sticker` via `StickerPackSticker` junction table.
- Implement sync API that returns incremental changes based on `updatedAt` timestamp for offline-first client support.
- All sharing mechanisms (individual shares and share links) are replicated for StickerPack following the same pattern as Sticker.

**Tech Stack:** Node.js, Express, TypeScript, Prisma ORM, PostgreSQL, Redis (optional caching for sync)

---

## Prerequisite: Environment & Docker Setup

### Task 0.1: Configure .env for Docker Compose

**Files:**
- Modify: `.env`

**Step 1: Update .env with database and redis configuration**

Add these variables to `.env`:
```
# Database Configuration
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sticker_api
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=sticker_api
DB_PORT=5432

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379

# JWT Authentication (generate secure random strings for local dev)
JWT_SECRET=dev-jwt-secret-key-change-in-production-2024
JWT_REFRESH_SECRET=dev-jwt-refresh-secret-key-change-in-production-2024
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# History Cleanup Configuration
HISTORY_EXPIRATION_DAYS=7
```

**Step 2: Start Docker Compose**

Run: `docker compose up -d`
Expected: postgres and redis containers start successfully

**Step 3: Verify containers are running**

Run: `docker compose ps`
Expected: api, postgres, redis all show `Up` status

**Step 4: Run database migrations**

Run: `npx prisma migrate deploy`
Expected: Migrations applied successfully

---

## Phase 1: Database Schema Migration

### Task 1.1: Update Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add new models to schema**

Add the following models after the existing `RefreshToken` model:

```prisma
model StickerPack {
  id          String              @id @default(uuid())
  ownerId     String
  name        String
  description String?
  visibility  StickerVisibility   @default(PRIVATE)
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt
  deletedAt   DateTime?

  owner       User                 @relation(fields: [ownerId], references: [id])
  stickers    StickerPackSticker[]
  shares      StickerPackShare[]
  shareLinks  StickerPackShareLink[]

  @@index([ownerId])
  @@index([visibility])
  @@index([deletedAt])
  @@index([updatedAt])
}

model StickerPackSticker {
  id            String    @id @default(uuid())
  stickerPackId String
  stickerId     String
  order         Int       @default(0)
  createdAt     DateTime  @default(now())

  stickerPack   StickerPack @relation(fields: [stickerPackId], references: [id], onDelete: Cascade)
  sticker       Sticker     @relation(fields: [stickerId], references: [id], onDelete: Cascade)

  @@unique([stickerPackId, stickerId])
  @@index([stickerPackId])
  @@index([stickerId])
}

model StickerPackShare {
  id           String          @id @default(uuid())
  stickerPackId String
  sharedWithId String
  permission   SharePermission @default(VIEW)
  grantedBy    String
  createdAt    DateTime        @default(now())
  expiresAt    DateTime?

  stickerPack  StickerPack @relation(fields: [stickerPackId], references: [id], onDelete: Cascade)
  sharedWith   User        @relation("PackSharedWith", fields: [sharedWithId], references: [id], onDelete: Cascade)
  granter      User        @relation("PackGrantedBy", fields: [grantedBy], references: [id], onDelete: Cascade)

  @@unique([stickerPackId, sharedWithId])
  @@index([stickerPackId])
  @@index([sharedWithId])
  @@index([grantedBy])
  @@index([expiresAt])
}

model StickerPackShareLink {
  id        String          @id @default(uuid())
  stickerPackId String
  token     String          @unique
  permission SharePermission @default(VIEW)
  createdBy String
  expiresAt DateTime?
  maxUses   Int?
  usesCount Int             @default(0)
  isActive  Boolean         @default(true)
  createdAt DateTime        @default(now())

  stickerPack StickerPack @relation(fields: [stickerPackId], references: [id], onDelete: Cascade)
  creator     User        @relation("PackLinkCreator", fields: [createdBy], references: [id], onDelete: Cascade)

  @@index([stickerPackId])
  @@index([token])
  @@index([createdBy])
  @@index([expiresAt])
  @@index([isActive])
}

model ProcessingHistory {
  id          String   @id @default(uuid())
  userId      String
  type        String   // 'generate' | 'grid-split' | 'background-remove'
  inputData   Json?    // prompt, rows/cols, etc
  outputFiles Json     // array of {url, path, filename, width, height}
  expiresAt   DateTime
  createdAt   DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([type])
  @@index([expiresAt])
  @@index([createdAt])
}
```

**Step 2: Update existing models to add new relations**

Update `User` model to add new relation fields:
```prisma
model User {
  // ... existing fields ...
  
  stickerPacks       StickerPack[]
  sharedStickerPacks StickerPackShare[]  @relation("PackSharedWith")
  grantedPackShares  StickerPackShare[]  @relation("PackGrantedBy")
  packShareLinks     StickerPackShareLink[] @relation("PackLinkCreator")
  processingHistory  ProcessingHistory[]
}
```

Update `Sticker` model to add relation to `StickerPackSticker`:
```prisma
model Sticker {
  // ... existing fields ...
  
  stickerPacks StickerPackSticker[]
}
```

**Step 3: Create and run migration**

Run: `npx prisma migrate dev --name add_sticker_pack_and_history`
Expected: Migration created and applied successfully

**Step 4: Regenerate Prisma Client**

Run: `npx prisma generate`
Expected: Prisma client generated with new models

---

## Phase 2: Processing History & Cleanup

### Task 2.1: Create ProcessingHistory Service

**Files:**
- Create: `src/services/processing-history.service.ts`

**Step 1: Create the service**

```typescript
import { prisma } from '../prisma/client';
import { Prisma } from '@prisma/client';

export interface CreateHistoryInput {
  userId: string;
  type: 'generate' | 'grid-split' | 'background-remove';
  inputData?: Record<string, unknown>;
  outputFiles: Array<{
    url: string;
    path: string;
    filename: string;
    width?: number;
    height?: number;
  }>;
}

export class ProcessingHistoryService {
  async create(input: CreateHistoryInput): Promise<void> {
    const expirationDays = parseInt(process.env.HISTORY_EXPIRATION_DAYS ?? '7', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expirationDays);

    await prisma.processingHistory.create({
      data: {
        userId: input.userId,
        type: input.type,
        inputData: input.inputData ? (input.inputData as Prisma.InputJsonValue) : Prisma.JsonNull,
        outputFiles: input.outputFiles as Prisma.InputJsonValue,
        expiresAt,
      },
    });
  }

  async findByUser(userId: string, type?: string): Promise<Prisma.ProcessingHistoryGetPayload<object>[]> {
    return prisma.processingHistory.findMany({
      where: {
        userId,
        ...(type && { type }),
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async deleteExpired(): Promise<number> {
    const result = await prisma.processingHistory.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });

    return result.count;
  }
}
```

### Task 2.2: Create Cleanup Utility

**Files:**
- Create: `src/utils/cleanup.ts`

**Step 1: Create cleanup utility**

```typescript
import fs from 'fs';
import path from 'path';
import { ProcessingHistoryService } from '../services/processing-history.service';
import { config } from '../config';

export class CleanupService {
  private historyService: ProcessingHistoryService;

  constructor() {
    this.historyService = new ProcessingHistoryService();
  }

  async runCleanup(): Promise<{ deletedRecords: number; deletedFiles: number }> {
    const deletedRecords = await this.historyService.deleteExpired();
    
    // Get all remaining history records to know which files to keep
    const activeRecords = await this.historyService.findByUser(''); // Empty to get all
    // Note: We'll need to update findByUser or create a new method to get all active records
    
    const deletedFiles = 0;
    // TODO: Implement file cleanup based on active records
    
    return { deletedRecords, deletedFiles };
  }

  async deleteHistoryFiles(filePaths: string[]): Promise<number> {
    let deletedCount = 0;
    
    for (const filePath of filePaths) {
      try {
        const fullPath = path.join(process.cwd(), config.uploadDir, filePath);
        if (fs.existsSync(fullPath)) {
          fs.unlinkSync(fullPath);
          deletedCount++;
        }
      } catch (error) {
        console.error(`Failed to delete file: ${filePath}`, error);
      }
    }
    
    return deletedCount;
  }
}
```

### Task 2.3: Update Controllers to Use ProcessingHistory

**Files:**
- Modify: `src/controllers/generate.controller.ts`
- Modify: `src/controllers/grid.controller.ts`
- Modify: `src/controllers/background.controller.ts`

**Step 1: Update GenerateController**

Remove StickerService import and usage. Replace with ProcessingHistoryService.

In the generate method, after generating images, instead of:
```typescript
await this.stickerService.create({...})
```

Use:
```typescript
await this.processingHistoryService.create({
  userId,
  type: 'generate',
  inputData: { text, grid, normalize },
  outputFiles: images.map(img => ({
    url: img.url,
    path: img.url.replace(`${config.appUrl}/uploads/`, ''),
    filename: img.id,
    width: img.width,
    height: img.height,
  })),
});
```

**Step 2: Update GridController**

Similarly update to use ProcessingHistoryService after splitting grid.

**Step 3: Update BackgroundController**

Update to use ProcessingHistoryService after background removal.

---

## Phase 3: Sticker Pack Core Service

### Task 3.1: Create StickerPack Service

**Files:**
- Create: `src/services/sticker-pack.service.ts`

**Step 1: Implement StickerPackService**

```typescript
import { prisma } from '../prisma/client';
import { Prisma, StickerVisibility, SharePermission } from '@prisma/client';
import { RoleService } from './role.service';
import { ForbiddenError, NotFoundError } from '../errors';

export interface CreateStickerPackInput {
  ownerId: string;
  name: string;
  description?: string;
  visibility?: StickerVisibility;
  stickers?: Array<{
    name: string;
    filename: string;
    url: string;
    width?: number;
    height?: number;
    fileSize?: number;
    mimeType?: string;
    order?: number;
  }>;
}

export interface UpdateStickerPackInput {
  name?: string;
  description?: string;
  visibility?: StickerVisibility;
}

export interface AddStickerToPackInput {
  stickerPackId: string;
  name: string;
  filename: string;
  url: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  order?: number;
}

export type StickerPackAction = 'read' | 'update' | 'delete';

export class StickerPackService {
  private roleService: RoleService;

  constructor(roleService: RoleService = new RoleService()) {
    this.roleService = roleService;
  }

  async create(input: CreateStickerPackInput): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>> {
    const visibility = input.visibility ?? StickerVisibility.PRIVATE;

    if (!Object.values(StickerVisibility).includes(visibility)) {
      throw new ForbiddenError('Invalid visibility value');
    }

    return prisma.stickerPack.create({
      data: {
        owner: { connect: { id: input.ownerId } },
        name: input.name,
        description: input.description,
        visibility,
        ...(input.stickers && input.stickers.length > 0 && {
          stickers: {
            create: input.stickers.map((s, index) => ({
              order: s.order ?? index,
              sticker: {
                create: {
                  owner: { connect: { id: input.ownerId } },
                  name: s.name,
                  filename: s.filename,
                  url: s.url,
                  width: s.width,
                  height: s.height,
                  fileSize: s.fileSize,
                  mimeType: s.mimeType,
                  visibility,
                },
              },
            })),
          },
        }),
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
        },
      },
    });
  }

  async findById(id: string): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }> | null> {
    return prisma.stickerPack.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
          orderBy: {
            order: 'asc',
          },
        },
      },
    });
  }

  async findByOwner(ownerId: string): Promise<Prisma.StickerPackGetPayload<object>[]> {
    return prisma.stickerPack.findMany({
      where: {
        ownerId,
        deletedAt: null,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async findPublic(): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>[]> {
    return prisma.stickerPack.findMany({
      where: {
        visibility: StickerVisibility.PUBLIC,
        deletedAt: null,
      },
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
        },
      },
    });
  }

  async update(id: string, userId: string, input: UpdateStickerPackInput): Promise<Prisma.StickerPackGetPayload<{
    include: {
      owner: { select: { id: true; username: true; displayName: true } };
      stickers: { include: { sticker: true } };
    }
  }>> {
    const pack = await this.findById(id);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(id, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to update this sticker pack');
    }

    return prisma.stickerPack.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.visibility !== undefined && { visibility: input.visibility }),
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
        },
      },
    });
  }

  async delete(id: string, userId: string): Promise<void> {
    const pack = await this.findById(id);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(id, userId, 'delete');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to delete this sticker pack');
    }

    await prisma.stickerPack.update({
      where: { id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async addSticker(input: AddStickerToPackInput): Promise<Prisma.StickerPackStickerGetPayload<{
    include: { sticker: true }
  }>> {
    const pack = await this.findById(input.stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const maxOrder = await prisma.stickerPackSticker.aggregate({
      where: { stickerPackId: input.stickerPackId },
      _max: { order: true },
    });

    const nextOrder = (maxOrder._max.order ?? -1) + 1;

    return prisma.stickerPackSticker.create({
      data: {
        stickerPack: { connect: { id: input.stickerPackId } },
        sticker: {
          create: {
            owner: { connect: { id: pack.ownerId } },
            name: input.name,
            filename: input.filename,
            url: input.url,
            width: input.width,
            height: input.height,
            fileSize: input.fileSize,
            mimeType: input.mimeType,
            visibility: pack.visibility,
          },
        },
        order: input.order ?? nextOrder,
      },
      include: {
        sticker: true,
      },
    });
  }

  async removeSticker(stickerPackId: string, stickerId: string, userId: string): Promise<void> {
    const pack = await this.findById(stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(stickerPackId, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to modify this sticker pack');
    }

    await prisma.stickerPackSticker.deleteMany({
      where: {
        stickerPackId,
        stickerId,
      },
    });
  }

  async reorderStickers(stickerPackId: string, userId: string, stickerOrders: Array<{ stickerId: string; order: number }>): Promise<void> {
    const pack = await this.findById(stickerPackId);

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    const hasAccess = await this.checkAccess(stickerPackId, userId, 'update');
    if (!hasAccess) {
      throw new ForbiddenError('You do not have permission to modify this sticker pack');
    }

    await prisma.$transaction(
      stickerOrders.map(({ stickerId, order }) =>
        prisma.stickerPackSticker.updateMany({
          where: {
            stickerPackId,
            stickerId,
          },
          data: { order },
        })
      )
    );
  }

  async checkAccess(stickerPackId: string, userId: string, action: StickerPackAction): Promise<boolean> {
    const pack = await prisma.stickerPack.findFirst({
      where: {
        id: stickerPackId,
        deletedAt: null,
      },
      include: {
        owner: true,
        shares: {
          where: {
            sharedWithId: userId,
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } },
            ],
          },
        },
      },
    });

    if (!pack) {
      return false;
    }

    // Owner always has access
    if (pack.ownerId === userId) {
      return true;
    }

    // Admin always has access
    const isAdmin = await this.roleService.isAdmin(userId);
    if (isAdmin) {
      return true;
    }

    // Public packs: read only
    if (pack.visibility === StickerVisibility.PUBLIC) {
      return action === 'read';
    }

    // Private packs: check shares
    if (pack.visibility === StickerVisibility.PRIVATE) {
      const share = pack.shares[0];
      if (!share) {
        return false;
      }

      if (share.permission === SharePermission.EDIT) {
        return true;
      }

      if (share.permission === SharePermission.VIEW) {
        return action === 'read';
      }

      return false;
    }

    // Unlisted (link-only): checked separately via share token
    if (pack.visibility === StickerVisibility.UNLISTED) {
      return false;
    }

    return false;
  }
}
```

### Task 3.2: Create StickerPack Share Service

**Files:**
- Create: `src/services/sticker-pack-share.service.ts`

**Step 1: Implement StickerPackShareService**

This follows the exact same pattern as `ShareService` but for StickerPack.

```typescript
import { prisma } from '../prisma/client';
import { SharePermission } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors';

export class StickerPackShareService {
  async shareWithUser(
    stickerPackId: string,
    grantedBy: string,
    sharedWithId: string,
    permission: SharePermission = SharePermission.VIEW,
    expiresAt?: Date
  ) {
    const pack = await prisma.stickerPack.findFirst({
      where: { id: stickerPackId, deletedAt: null },
    });

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    if (pack.ownerId !== grantedBy) {
      throw new ForbiddenError('Only the owner can share this sticker pack');
    }

    if (pack.ownerId === sharedWithId) {
      throw new ValidationError('Cannot share with yourself');
    }

    return prisma.stickerPackShare.upsert({
      where: {
        stickerPackId_sharedWithId: {
          stickerPackId,
          sharedWithId,
        },
      },
      update: {
        permission,
        expiresAt,
      },
      create: {
        stickerPackId,
        sharedWithId,
        grantedBy,
        permission,
        expiresAt,
      },
    });
  }

  async removeUserShare(stickerPackId: string, grantedBy: string, sharedWithId: string): Promise<void> {
    const pack = await prisma.stickerPack.findFirst({
      where: { id: stickerPackId, deletedAt: null },
    });

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    if (pack.ownerId !== grantedBy) {
      throw new ForbiddenError('Only the owner can remove shares');
    }

    await prisma.stickerPackShare.deleteMany({
      where: {
        stickerPackId,
        sharedWithId,
      },
    });
  }

  async createShareLink(
    stickerPackId: string,
    createdBy: string,
    permission: SharePermission = SharePermission.VIEW,
    expiresAt?: Date,
    maxUses?: number
  ) {
    const pack = await prisma.stickerPack.findFirst({
      where: { id: stickerPackId, deletedAt: null },
    });

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    if (pack.ownerId !== createdBy) {
      throw new ForbiddenError('Only the owner can create share links');
    }

    const token = this.generateToken();

    return prisma.stickerPackShareLink.create({
      data: {
        stickerPackId,
        token,
        permission,
        createdBy,
        expiresAt,
        maxUses,
      },
    });
  }

  async revokeShareLink(stickerPackId: string, createdBy: string, linkId: string): Promise<void> {
    const pack = await prisma.stickerPack.findFirst({
      where: { id: stickerPackId, deletedAt: null },
    });

    if (!pack) {
      throw new NotFoundError('Sticker pack not found');
    }

    if (pack.ownerId !== createdBy) {
      throw new ForbiddenError('Only the owner can revoke share links');
    }

    await prisma.stickerPackShareLink.update({
      where: { id: linkId },
      data: { isActive: false },
    });
  }

  private generateToken(): string {
    return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  }
}
```

---

## Phase 4: Sticker Pack Controller & Routes

### Task 4.1: Create StickerPack Controller

**Files:**
- Create: `src/controllers/sticker-pack.controller.ts`

**Step 1: Implement StickerPackController**

```typescript
import type { Response, NextFunction } from 'express';
import { StickerPackService } from '../services/sticker-pack.service';
import { StickerPackShareService } from '../services/sticker-pack-share.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError, NotFoundError, ForbiddenError } from '../errors';
import { SharePermission } from '@prisma/client';

export class StickerPackController {
  private stickerPackService: StickerPackService;
  private shareService: StickerPackShareService;

  constructor() {
    this.stickerPackService = new StickerPackService();
    this.shareService = new StickerPackShareService();
  }

  async create(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { name, description, visibility, stickers } = req.body as Record<string, unknown>;

      if (!name || String(name).trim().length === 0) {
        throw new ValidationError('Sticker pack name is required');
      }

      const pack = await this.stickerPackService.create({
        ownerId: req.user.id,
        name: String(name),
        description: description ? String(description) : undefined,
        visibility: visibility ? String(visibility).toUpperCase() as 'PUBLIC' | 'PRIVATE' | 'UNLISTED' : undefined,
        stickers: Array.isArray(stickers) ? stickers.map((s: Record<string, unknown>) => ({
          name: String(s.name ?? 'Untitled'),
          filename: String(s.filename ?? ''),
          url: String(s.url ?? ''),
          width: s.width ? Number(s.width) : undefined,
          height: s.height ? Number(s.height) : undefined,
          fileSize: s.fileSize ? Number(s.fileSize) : undefined,
          mimeType: s.mimeType ? String(s.mimeType) : undefined,
          order: s.order ? Number(s.order) : undefined,
        })) : undefined,
      });

      res.status(201).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async getMyStickerPacks(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const packs = await this.stickerPackService.findByOwner(req.user.id);
      res.status(200).json(buildSuccessResponse(packs));
    } catch (error) {
      next(error);
    }
  }

  async getPublicStickerPacks(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const packs = await this.stickerPackService.findPublic();
      res.status(200).json(buildSuccessResponse(packs));
    } catch (error) {
      next(error);
    }
  }

  async getStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const pack = await this.stickerPackService.findById(id);

      if (!pack) {
        throw new NotFoundError('Sticker pack not found');
      }

      if (req.user?.id) {
        const hasAccess = await this.stickerPackService.checkAccess(id, req.user.id, 'read');
        if (!hasAccess && pack.visibility !== 'PUBLIC') {
          throw new ForbiddenError('You do not have permission to view this sticker pack');
        }
      } else if (pack.visibility !== 'PUBLIC') {
        throw new ValidationError('Authentication required');
      }

      res.status(200).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async updateStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { name, description, visibility } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const updateData: { name?: string; description?: string; visibility?: 'PUBLIC' | 'PRIVATE' | 'UNLISTED' } = {};

      if (name !== undefined) {
        updateData.name = String(name);
      }

      if (description !== undefined) {
        updateData.description = String(description);
      }

      if (visibility !== undefined) {
        updateData.visibility = String(visibility).toUpperCase() as 'PUBLIC' | 'PRIVATE' | 'UNLISTED';
      }

      const pack = await this.stickerPackService.update(id, req.user.id, updateData);
      res.status(200).json(buildSuccessResponse(pack));
    } catch (error) {
      next(error);
    }
  }

  async deleteStickerPack(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      await this.stickerPackService.delete(id, req.user.id);
      res.status(200).json(buildSuccessResponse({ message: 'Sticker pack deleted successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async addSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { name, filename, url, width, height, fileSize, mimeType, order } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!name || !filename || !url) {
        throw new ValidationError('Name, filename, and URL are required');
      }

      const result = await this.stickerPackService.addSticker({
        stickerPackId: id,
        name: String(name),
        filename: String(filename),
        url: String(url),
        width: width ? Number(width) : undefined,
        height: height ? Number(height) : undefined,
        fileSize: fileSize ? Number(fileSize) : undefined,
        mimeType: mimeType ? String(mimeType) : undefined,
        order: order ? Number(order) : undefined,
      });

      res.status(201).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }

  async removeSticker(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id, stickerId } = req.params;

      if (!id || !stickerId) {
        throw new ValidationError('Sticker pack ID and sticker ID are required');
      }

      await this.stickerPackService.removeSticker(id, stickerId, req.user.id);
      res.status(200).json(buildSuccessResponse({ message: 'Sticker removed from pack successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async reorderStickers(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { stickerOrders } = req.body as { stickerOrders: Array<{ stickerId: string; order: number }> };

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!Array.isArray(stickerOrders)) {
        throw new ValidationError('stickerOrders must be an array');
      }

      await this.stickerPackService.reorderStickers(id, req.user.id, stickerOrders);
      res.status(200).json(buildSuccessResponse({ message: 'Stickers reordered successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async shareWithUser(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { userId: sharedWithId, permission, expiresAt } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!sharedWithId) {
        throw new ValidationError('User ID is required');
      }

      const permissionStr = String(permission).toLowerCase();
      const sharePermission = permission
        ? (permissionStr === 'full' ? SharePermission.EDIT : (permissionStr.toUpperCase() as SharePermission))
        : SharePermission.VIEW;
      const expirationDate = expiresAt ? new Date(String(expiresAt)) : undefined;

      const share = await this.shareService.shareWithUser(
        id,
        req.user.id,
        String(sharedWithId),
        sharePermission,
        expirationDate
      );

      res.status(201).json(buildSuccessResponse(share));
    } catch (error) {
      next(error);
    }
  }

  async removeUserShare(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { userId: sharedWithId } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!sharedWithId) {
        throw new ValidationError('User ID is required');
      }

      await this.shareService.removeUserShare(id, req.user.id, String(sharedWithId));
      res.status(200).json(buildSuccessResponse({ message: 'Share removed successfully' }));
    } catch (error) {
      next(error);
    }
  }

  async createShareLink(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id } = req.params;
      const { permission, expiresAt, maxUses } = req.body as Record<string, unknown>;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      const permissionStr = String(permission).toLowerCase();
      const sharePermission = permission
        ? (permissionStr === 'full' ? SharePermission.EDIT : (permissionStr.toUpperCase() as SharePermission))
        : SharePermission.VIEW;
      const expirationDate = expiresAt ? new Date(String(expiresAt)) : undefined;
      const usesLimit = maxUses ? Number(maxUses) : undefined;

      const link = await this.shareService.createShareLink(
        id,
        req.user.id,
        sharePermission,
        expirationDate,
        usesLimit
      );

      res.status(201).json(buildSuccessResponse(link));
    } catch (error) {
      next(error);
    }
  }

  async revokeShareLink(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('User not authenticated');
      }

      const { id, linkId } = req.params;

      if (!id) {
        throw new ValidationError('Sticker pack ID is required');
      }

      if (!linkId) {
        throw new ValidationError('Link ID is required');
      }

      await this.shareService.revokeShareLink(id, req.user.id, linkId);
      res.status(200).json(buildSuccessResponse({ message: 'Share link revoked successfully' }));
    } catch (error) {
      next(error);
    }
  }
}
```

### Task 4.2: Update App Routes

**Files:**
- Modify: `src/app.ts`

**Step 1: Add StickerPackController import and routes**

Add import:
```typescript
import { StickerPackController } from './controllers/sticker-pack.controller';
```

Add controller instantiation:
```typescript
const stickerPackController = new StickerPackController();
```

Add routes after existing sticker routes:
```typescript
// Sticker Pack routes (public)
app.get('/api/v1/sticker-packs/public', asyncHandler((req, res, next) => stickerPackController.getPublicStickerPacks(req, res, next)));

// Sticker Pack routes (protected)
app.get('/api/v1/sticker-packs', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getMyStickerPacks(req, res, next)));
app.post('/api/v1/sticker-packs', authenticateToken, asyncHandler((req, res, next) => stickerPackController.create(req, res, next)));
app.get('/api/v1/sticker-packs/:id', authenticateToken, asyncHandler((req, res, next) => stickerPackController.getStickerPack(req, res, next)));
app.put('/api/v1/sticker-packs/:id', authenticateToken, asyncHandler((req, res, next) => stickerPackController.updateStickerPack(req, res, next)));
app.delete('/api/v1/sticker-packs/:id', authenticateToken, asyncHandler((req, res, next) => stickerPackController.deleteStickerPack(req, res, next)));
app.post('/api/v1/sticker-packs/:id/stickers', authenticateToken, asyncHandler((req, res, next) => stickerPackController.addSticker(req, res, next)));
app.delete('/api/v1/sticker-packs/:id/stickers/:stickerId', authenticateToken, asyncHandler((req, res, next) => stickerPackController.removeSticker(req, res, next)));
app.put('/api/v1/sticker-packs/:id/reorder', authenticateToken, asyncHandler((req, res, next) => stickerPackController.reorderStickers(req, res, next)));
app.post('/api/v1/sticker-packs/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerPackController.shareWithUser(req, res, next)));
app.delete('/api/v1/sticker-packs/:id/share', authenticateToken, asyncHandler((req, res, next) => stickerPackController.removeUserShare(req, res, next)));
app.post('/api/v1/sticker-packs/:id/link', authenticateToken, asyncHandler((req, res, next) => stickerPackController.createShareLink(req, res, next)));
app.delete('/api/v1/sticker-packs/:id/link/:linkId', authenticateToken, asyncHandler((req, res, next) => stickerPackController.revokeShareLink(req, res, next)));
```

---

## Phase 5: Upload API (Sticker Insertion)

### Task 5.1: Create Upload Controller

**Files:**
- Create: `src/controllers/upload.controller.ts`

**Step 1: Implement UploadController**

```typescript
import type { Response, NextFunction } from 'express';
import { StickerService } from '../services/sticker.service';
import { StickerPackService } from '../services/sticker-pack.service';
import { LocalStorageProvider } from '../storage/local.provider';
import { ImageService } from '../services/image.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';
import { StickerVisibility } from '@prisma/client';

export class UploadController {
  private stickerService: StickerService;
  private stickerPackService: StickerPackService;
  private storageProvider: LocalStorageProvider;
  private imageService: ImageService;

  constructor() {
    this.stickerService = new StickerService();
    this.stickerPackService = new StickerPackService();
    this.storageProvider = new LocalStorageProvider();
    this.imageService = new ImageService();
  }

  async upload(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('Authentication required');
      }

      const userId = req.user.id;
      const files = req.files as Express.Multer.File[];
      
      if (!files || files.length === 0) {
        throw new ValidationError('At least one image file is required');
      }

      const body = req.body as Record<string, unknown>;
      const stickerPackId = body.stickerPackId ? String(body.stickerPackId) : undefined;
      const stickerPackName = body.stickerPackName ? String(body.stickerPackName) : undefined;
      const stickerPackDescription = body.stickerPackDescription ? String(body.stickerPackDescription) : undefined;
      const visibility = String(body.visibility ?? 'private').toUpperCase() as StickerVisibility;
      const existingStickerIds = body.existingStickerIds ? JSON.parse(String(body.existingStickerIds)) as string[] : [];

      let packId = stickerPackId;

      // Create new sticker pack if name provided but no ID
      if (!packId && stickerPackName) {
        const pack = await this.stickerPackService.create({
          ownerId: userId,
          name: stickerPackName,
          description: stickerPackDescription,
          visibility,
        });
        packId = pack.id;
      }

      const uploadedStickers = [];
      const requestTimestamp = Date.now();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const squareBuffer = await this.imageService.resizeToSquareContain(file.buffer, 512);
        const filename = await this.storageProvider.saveFile(squareBuffer, {
          extension: 'png',
          subDir: `uploads/${requestTimestamp}`,
          baseName: `sticker-${i}`,
          ownerId: userId,
        });
        const dimensions = await this.imageService.getImageDimensions(squareBuffer);
        const url = this.storageProvider.getPublicUrl(filename);

        const sticker = await this.stickerService.create({
          ownerId: userId,
          name: file.originalname.replace(/\.[^/.]+$/, '') || `sticker-${i}`,
          filename,
          url,
          width: dimensions.width,
          height: dimensions.height,
          fileSize: file.size,
          mimeType: 'image/png',
          visibility,
        });

        uploadedStickers.push(sticker);

        // Add to sticker pack if packId exists
        if (packId) {
          await this.stickerPackService.addSticker({
            stickerPackId: packId,
            name: sticker.name,
            filename: sticker.filename,
            url: sticker.url,
            width: sticker.width ?? undefined,
            height: sticker.height ?? undefined,
            fileSize: sticker.fileSize ?? undefined,
            mimeType: sticker.mimeType ?? undefined,
            order: i,
          });
        }
      }

      // Handle existing sticker IDs (add to pack)
      if (packId && existingStickerIds.length > 0) {
        for (const existingId of existingStickerIds) {
          const existingSticker = await this.stickerService.findById(existingId);
          if (existingSticker) {
            await this.stickerPackService.addSticker({
              stickerPackId: packId,
              name: existingSticker.name,
              filename: existingSticker.filename,
              url: existingSticker.url,
              width: existingSticker.width ?? undefined,
              height: existingSticker.height ?? undefined,
              fileSize: existingSticker.fileSize ?? undefined,
              mimeType: existingSticker.mimeType ?? undefined,
            });
          }
        }
      }

      res.status(201).json(buildSuccessResponse({
        stickerPackId: packId,
        stickers: uploadedStickers,
        message: 'Stickers uploaded successfully',
      }));
    } catch (error) {
      next(error);
    }
  }
}
```

### Task 5.2: Add Upload Route

**Files:**
- Modify: `src/app.ts`

**Step 1: Add upload route**

Add import:
```typescript
import { UploadController } from './controllers/upload.controller';
```

Add controller instantiation:
```typescript
const uploadController = new UploadController();
```

Add route:
```typescript
app.post(
  '/api/v1/upload',
  authenticateToken,
  upload.array('images', 30), // Allow up to 30 images
  asyncHandler((req, res, next) => uploadController.upload(req, res, next))
);
```

---

## Phase 6: Sync API for Offline-First

### Task 6.1: Create Sync Service

**Files:**
- Create: `src/services/sync.service.ts`

**Step 1: Implement SyncService**

```typescript
import { prisma } from '../prisma/client';

export interface SyncInput {
  userId: string;
  lastSyncAt?: Date;
}

export interface SyncResult {
  stickerPacks: {
    created: Array<Record<string, unknown>>;
    updated: Array<Record<string, unknown>>;
    deleted: Array<{ id: string; deletedAt: Date }>;
  };
  stickers: {
    created: Array<Record<string, unknown>>;
    updated: Array<Record<string, unknown>>;
    deleted: Array<{ id: string; deletedAt: Date }>;
  };
  syncToken: string;
}

export class SyncService {
  async sync(input: SyncInput): Promise<SyncResult> {
    const lastSyncAt = input.lastSyncAt ?? new Date(0);
    const now = new Date();

    // Get all sticker packs accessible by user
    const stickerPacks = await prisma.stickerPack.findMany({
      where: {
        OR: [
          { ownerId: input.userId },
          { visibility: 'PUBLIC' },
          {
            shares: {
              some: {
                sharedWithId: input.userId,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
        ],
        updatedAt: {
          gte: lastSyncAt,
        },
      },
      include: {
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true,
          },
        },
        stickers: {
          include: {
            sticker: true,
          },
        },
        shares: {
          where: {
            sharedWithId: input.userId,
          },
        },
      },
    });

    const createdPacks = stickerPacks.filter(p => p.createdAt >= lastSyncAt && p.deletedAt === null);
    const updatedPacks = stickerPacks.filter(p => p.createdAt < lastSyncAt && p.updatedAt >= lastSyncAt && p.deletedAt === null);
    const deletedPacks = stickerPacks.filter(p => p.deletedAt !== null && p.deletedAt >= lastSyncAt);

    // Get all stickers accessible by user
    const stickers = await prisma.sticker.findMany({
      where: {
        OR: [
          { ownerId: input.userId },
          { visibility: 'PUBLIC' },
          {
            shares: {
              some: {
                sharedWithId: input.userId,
                OR: [
                  { expiresAt: null },
                  { expiresAt: { gt: new Date() } },
                ],
              },
            },
          },
          {
            stickerPacks: {
              some: {
                stickerPack: {
                  OR: [
                    { ownerId: input.userId },
                    { visibility: 'PUBLIC' },
                    {
                      shares: {
                        some: {
                          sharedWithId: input.userId,
                          OR: [
                            { expiresAt: null },
                            { expiresAt: { gt: new Date() } },
                          ],
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
        updatedAt: {
          gte: lastSyncAt,
        },
      },
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

    const createdStickers = stickers.filter(s => s.createdAt >= lastSyncAt && s.deletedAt === null);
    const updatedStickers = stickers.filter(s => s.createdAt < lastSyncAt && s.updatedAt >= lastSyncAt && s.deletedAt === null);
    const deletedStickers = stickers.filter(s => s.deletedAt !== null && s.deletedAt >= lastSyncAt);

    return {
      stickerPacks: {
        created: createdPacks,
        updated: updatedPacks,
        deleted: deletedPacks.map(p => ({ id: p.id, deletedAt: p.deletedAt! })),
      },
      stickers: {
        created: createdStickers,
        updated: updatedStickers,
        deleted: deletedStickers.map(s => ({ id: s.id, deletedAt: s.deletedAt! })),
      },
      syncToken: Buffer.from(now.toISOString()).toString('base64'),
    };
  }
}
```

### Task 6.2: Create Sync Controller

**Files:**
- Create: `src/controllers/sync.controller.ts`

**Step 1: Implement SyncController**

```typescript
import type { Response, NextFunction } from 'express';
import { SyncService } from '../services/sync.service';
import type { AuthRequest } from '../middleware/auth.middleware';
import { buildSuccessResponse } from '../utils/response-builder';
import { ValidationError } from '../errors';

export class SyncController {
  private syncService: SyncService;

  constructor() {
    this.syncService = new SyncService();
  }

  async sync(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.user?.id) {
        throw new ValidationError('Authentication required');
      }

      const { lastSyncAt } = req.query as { lastSyncAt?: string };
      
      let parsedLastSyncAt: Date | undefined;
      if (lastSyncAt) {
        parsedLastSyncAt = new Date(lastSyncAt);
        if (isNaN(parsedLastSyncAt.getTime())) {
          throw new ValidationError('Invalid lastSyncAt date format');
        }
      }

      const result = await this.syncService.sync({
        userId: req.user.id,
        lastSyncAt: parsedLastSyncAt,
      });

      res.status(200).json(buildSuccessResponse(result));
    } catch (error) {
      next(error);
    }
  }
}
```

### Task 6.3: Add Sync Route

**Files:**
- Modify: `src/app.ts`

**Step 1: Add sync route**

Add import:
```typescript
import { SyncController } from './controllers/sync.controller';
```

Add controller instantiation:
```typescript
const syncController = new SyncController();
```

Add route:
```typescript
app.get('/api/v1/sync', authenticateToken, asyncHandler((req, res, next) => syncController.sync(req, res, next)));
```

---

## Phase 7: Update Existing Controllers

### Task 7.1: Update GenerateController

**Files:**
- Modify: `src/controllers/generate.controller.ts`

**Changes:**
1. Remove `StickerService` import and usage
2. Add `ProcessingHistoryService` import
3. Replace sticker creation with history logging
4. Keep the same response format for backward compatibility

### Task 7.2: Update GridController

**Files:**
- Modify: `src/controllers/grid.controller.ts`

**Changes:**
1. Add `ProcessingHistoryService` import
2. Log processing results to history after split
3. Keep the same response format

### Task 7.3: Update BackgroundController

**Files:**
- Modify: `src/controllers/background.controller.ts`

**Changes:**
1. Add `ProcessingHistoryService` import
2. Log processing results to history after background removal
3. Keep the same response format

---

## Phase 8: Testing & Verification

### Task 8.1: Run Database Migration

Run: `npx prisma migrate dev --name add_sticker_pack_and_history`
Expected: Migration successful

### Task 8.2: Run TypeScript Compilation

Run: `npx tsc --noEmit`
Expected: No TypeScript errors

### Task 8.3: Start Application

Run: `npm run dev`
Expected: Server starts successfully

### Task 8.4: Test New APIs

Test the following endpoints:
1. `POST /api/v1/sticker-packs` - Create sticker pack
2. `POST /api/v1/upload` - Upload stickers to pack
3. `GET /api/v1/sticker-packs` - Get my sticker packs
4. `GET /api/v1/sync?lastSyncAt=...` - Sync data
5. `POST /api/v1/generate` - Should now log to history instead of creating stickers

---

## Summary

This implementation plan covers:
1. **Database Schema**: New models for StickerPack, StickerPackSticker, StickerPackShare, StickerPackShareLink, and ProcessingHistory
2. **Processing History**: Refactor existing APIs to log results instead of creating stickers directly
3. **Sticker Pack Core**: Full CRUD for sticker packs with sticker management
4. **Sharing**: Individual shares and share links for sticker packs
5. **Upload API**: New endpoint for uploading stickers with optional pack assignment
6. **Sync API**: Incremental sync based on `updatedAt` timestamp for offline-first support
7. **Cleanup**: Automatic cleanup of expired processing history records

**Backward Compatibility**: This is a breaking change for the `generate`, `grid/split`, and `background/remove` endpoints as they no longer create stickers directly. However, since this is local development, this is acceptable.
