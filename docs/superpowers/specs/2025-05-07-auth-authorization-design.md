# WhatsApp Sticker API - Auth, Authorization & Permission Design

> **Date:** 2025-05-07  
> **Status:** Approved  
> **Author:** AI Assistant  
> **Scope:** Authentication, Authorization, Role-Based Access Control, Sticker Visibility & Sharing, Storage Abstraction, Docker Setup

---

## 1. Overview

This design document adds comprehensive user management, authentication, authorization, and permission control to the existing WhatsApp Sticker API. Every sticker will have an owner and visibility settings (public, private, link-only). The system supports RBAC+Permissions with JWT authentication, user-scoped local storage, and PostgreSQL via Docker.

### Goals

1. **User Authentication** - JWT-based auth with access/refresh tokens
2. **Role-Based Access Control (RBAC)** - Users and Admins roles with granular permissions
3. **Sticker Ownership & Visibility** - Each sticker has owner + visibility (public/private/link-only)
4. **User Sharing** - Owner can invite specific users to access private stickers (view-only or full access)
5. **Link Sharing** - Generate shareable links with optional expiration and permission levels
6. **Cloud-Ready Storage** - Abstracted storage provider (local now, S3-ready for future)
7. **User-Scoped File Storage** - Organized folder structure per user
8. **Docker Development Environment** - Easy setup with docker-compose
9. **Security** - SQL injection prevention, XSS protection, rate limiting, secure cookies

### Non-Goals

1. OAuth/Social login (future enhancement)
2. Real-time notifications
3. Payment/billing system
4. CDN integration (future)
5. Email verification (future)

---

## 2. Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Express API Layer                         │
│  AuthMiddleware → RoleMiddleware → PermissionMiddleware      │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────────┐
│   Controllers │    │   Services   │    │  Storage Layer   │
│               │    │              │    │  (IStorageProvider)│
│ AuthController│    │ AuthService  │    │                  │
│ UserController│    │ UserService  │    │ ┌──────────────┐ │
│ StickerCtrl   │    │ StickerSvc   │    │ │LocalStorage  │ │
│ ShareCtrl     │    │ ShareService │    │ ├──────────────┤ │
│ AdminCtrl     │    │ RoleService  │    │ │S3Storage     │ │
│               │    │              │    │ │(future)      │ │
└──────────────┘    └──────────────┘    └──────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Prisma ORM + PostgreSQL                   │
│  Users │ Roles │ Permissions │ Stickers │ StickerShares    │
│  StickerShareLinks │ RefreshTokens                          │
└─────────────────────────────────────────────────────────────┘
```

### Tech Stack Updates

- **ORM:** Prisma 5.x with PostgreSQL 16
- **Auth:** JWT (jsonwebtoken), bcrypt
- **Validation:** Zod (already in use)
- **Cache:** Redis 7 (token blacklisting, rate limiting)
- **Container:** Docker + docker-compose
- **Testing:** Vitest + Supertest + @faker-js/faker

---

## 3. Database Schema

### 3.1 Users Table

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
email           VARCHAR(255) UNIQUE NOT NULL
passwordHash    VARCHAR(255) NOT NULL
username        VARCHAR(50) UNIQUE
displayName     VARCHAR(100)
roleId          UUID NOT NULL REFERENCES Roles(id)
isActive        BOOLEAN DEFAULT true
emailVerified   BOOLEAN DEFAULT false
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updatedAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### 3.2 Roles Table

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
name            VARCHAR(50) UNIQUE NOT NULL
description     TEXT
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

**Default Roles:**
- `user` - Standard user with basic permissions
- `admin` - Full system access

### 3.3 Permissions Table

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
name            VARCHAR(100) UNIQUE NOT NULL
description     TEXT
resource        VARCHAR(50) NOT NULL
action          VARCHAR(50) NOT NULL
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

**Default Permissions:**

| Name | Resource | Action | Description |
|------|----------|--------|-------------|
| sticker:read | sticker | read | View/download stickers |
| sticker:write | sticker | write | Create/update stickers |
| sticker:delete | sticker | delete | Delete stickers |
| sticker:share | sticker | share | Share stickers with others |
| user:read | user | read | View user profiles |
| user:write | user | write | Update user profiles |
| user:delete | user | delete | Delete user accounts |
| admin:access | admin | read | Access admin endpoints |

### 3.4 RolePermissions Table (Many-to-Many)

```sql
roleId          UUID REFERENCES Roles(id)
permissionId    UUID REFERENCES Permissions(id)
PRIMARY KEY (roleId, permissionId)
```

**Default Role-Permission Mapping:**

**User Role:** sticker:read, sticker:write, sticker:delete, sticker:share, user:read, user:write
**Admin Role:** All permissions (*)

### 3.5 Stickers Table

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
ownerId         UUID NOT NULL REFERENCES Users(id)
name            VARCHAR(255)
filename        VARCHAR(500) NOT NULL
url             VARCHAR(500)
visibility      VARCHAR(20) NOT NULL CHECK (visibility IN ('public', 'private', 'link_only'))
width           INTEGER
height          INTEGER
fileSize        INTEGER
mimeType        VARCHAR(50)
metadata        JSONB DEFAULT '{}'
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updatedAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
deletedAt       TIMESTAMP NULL
```

**Visibility Values:**
- `public` - Visible to everyone, no auth required
- `private` - Only owner and explicitly shared users can access
- `link_only` - Accessible via share link token

### 3.6 StickerShares Table (User-to-User Sharing)

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
stickerId       UUID NOT NULL REFERENCES Stickers(id) ON DELETE CASCADE
sharedWithId    UUID NOT NULL REFERENCES Users(id)
permission      VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'full'))
grantedBy       UUID NOT NULL REFERENCES Users(id)
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
expiresAt       TIMESTAMP NULL
```

**Permission Values:**
- `view` - Read-only access (default)
- `full` - Read, update, and delete access

### 3.7 StickerShareLinks Table (Link-Based Sharing)

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
stickerId       UUID NOT NULL REFERENCES Stickers(id) ON DELETE CASCADE
token           VARCHAR(255) UNIQUE NOT NULL
permission      VARCHAR(20) NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'full'))
createdBy       UUID NOT NULL REFERENCES Users(id)
expiresAt       TIMESTAMP NULL
maxUses         INTEGER NULL
usesCount       INTEGER DEFAULT 0
isActive        BOOLEAN DEFAULT true
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### 3.8 RefreshTokens Table (Token Blacklisting)

```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
userId          UUID NOT NULL REFERENCES Users(id) ON DELETE CASCADE
token           TEXT NOT NULL
expiresAt       TIMESTAMP NOT NULL
createdAt       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

---

## 4. Authentication Flow

### 4.1 JWT Token Strategy

- **Access Token:** 15 minutes, sent in `Authorization: Bearer <token>` header
- **Refresh Token:** 7 days, stored in httpOnly cookie
- **Token Algorithm:** HS256 with secrets min 32 characters
- **Token Rotation:** New refresh token issued on every refresh (security best practice)
- **Token Blacklisting:** Refresh tokens stored in DB, deleted on logout

### 4.2 Registration

```
POST /api/v1/auth/register
Content-Type: application/json

Body:
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "username": "johndoe",
  "displayName": "John Doe"
}

Validation Rules:
- Email: valid format, unique
- Password: min 8 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char
- Username: alphanumeric + underscore, 3-50 chars, unique
- Display name: 1-100 chars

Process:
1. Validate input with Zod schema
2. Check email/username uniqueness
3. Hash password with bcrypt (salt rounds: 12)
4. Create user with default 'user' role
5. Generate access token + refresh token
6. Store refresh token in DB
7. Set refresh token as httpOnly cookie
8. Return access token + user info
```

### 4.3 Login

```
POST /api/v1/auth/login
Content-Type: application/json

Body:
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}

Process:
1. Find user by email
2. Verify user is active
3. Compare password with bcrypt
4. Generate new token pair
5. Store refresh token in DB
6. Set refresh token as httpOnly cookie
7. Return access token + user info
```

### 4.4 Refresh Token

```
POST /api/v1/auth/refresh
Cookie: refresh_token=<token>

Process:
1. Extract refresh token from cookie
2. Verify token signature and expiration
3. Check token exists in DB (not blacklisted)
4. Generate new access token
5. Rotate refresh token (generate new one, delete old)
6. Update cookie with new refresh token
7. Return new access token
```

### 4.5 Logout

```
POST /api/v1/auth/logout
Cookie: refresh_token=<token>
Authorization: Bearer <access_token>

Process:
1. Extract refresh token from cookie
2. Delete refresh token from DB (blacklist)
3. Clear httpOnly cookie
4. Return success
```

---

## 5. Authorization & Permission Model

### 5.1 Middleware Stack

```typescript
// 1. Authentication Middleware
authenticate(req, res, next)
  - Extract Bearer token from Authorization header
  - Verify JWT signature
  - Attach decoded user to req.user
  - 401 if missing/invalid

// 2. Role Middleware  
requireRole('admin', 'moderator')
  - Check req.user.role.name against allowed roles
  - 403 if not authorized

// 3. Permission Middleware
requirePermission('sticker:write', 'sticker:delete')
  - Load user permissions from DB or cache
  - Check intersection with required permissions
  - 403 if missing any required permission
```

### 5.2 Sticker Access Control Logic

```typescript
async function checkStickerAccess(
  userId: string | null,
  stickerId: string,
  action: 'read' | 'write' | 'delete' | 'share'
): Promise<{ allowed: boolean; sticker?: Sticker }> {
  
  const sticker = await prisma.sticker.findUnique({
    where: { id: stickerId, deletedAt: null },
    include: {
      owner: true,
      shares: { where: { sharedWithId: userId } },
      shareLinks: { where: { isActive: true } }
    }
  });
  
  if (!sticker) return { allowed: false };
  
  // Owner or Admin always has full access
  if (userId && (sticker.ownerId === userId || await isAdmin(userId))) {
    return { allowed: true, sticker };
  }
  
  switch (sticker.visibility) {
    case 'public':
      // Anyone can read, only owner/admin can write/delete/share
      return { allowed: action === 'read', sticker };
      
    case 'private':
      // Check user-specific share
      if (userId) {
        const share = sticker.shares[0];
        if (share) {
          // Check expiration
          if (share.expiresAt && share.expiresAt < new Date()) {
            return { allowed: false, sticker };
          }
          // Full permission = all actions, View = read only
          if (share.permission === 'full') return { allowed: true, sticker };
          return { allowed: action === 'read', sticker };
        }
      }
      return { allowed: false, sticker };
      
    case 'link_only':
      // Check via share link token (from query param)
      const linkToken = req.query.shareToken as string;
      if (linkToken) {
        const link = sticker.shareLinks.find(l => l.token === linkToken);
        if (link && link.isActive) {
          // Check expiration
          if (link.expiresAt && link.expiresAt < new Date()) {
            return { allowed: false, sticker };
          }
          // Check max uses
          if (link.maxUses && link.usesCount >= link.maxUses) {
            return { allowed: false, sticker };
          }
          // Full permission = all actions, View = read only
          if (link.permission === 'full') return { allowed: true, sticker };
          return { allowed: action === 'read', sticker };
        }
      }
      return { allowed: false, sticker };
  }
}
```

### 5.3 Access Decision Matrix

| User Type | Public Sticker | Private Sticker | Link-Only Sticker |
|-----------|---------------|-----------------|-------------------|
| **Owner** | Full access | Full access | Full access |
| **Admin** | Full access | Full access | Full access |
| **Shared User (view)** | Read only | Read only (if invited) | Read only (via link) |
| **Shared User (full)** | Read/Write | Read/Write (if invited) | Read/Write (via link) |
| **Anonymous** | Read only | 403 Forbidden | Read only (via valid link) |

---

## 6. Storage Provider Pattern

### 6.1 Interface

```typescript
interface SaveFileOptions {
  extension?: string;
  subDir?: string;
  baseName?: string;
  ownerId?: string;  // NEW: user-scoped storage
}

interface IStorageProvider {
  saveFile(buffer: Buffer, options: SaveFileOptions): Promise<string>;
  getFilePath(filename: string): string;
  fileExists(filename: string): Promise<boolean>;
  deleteFile(filename: string): Promise<void>;
  getPublicUrl(filename: string): string;
}
```

### 6.2 Local Storage Provider

```
uploads/
├── users/
│   ├── {userId}/
│   │   ├── stickers/
│   │   │   ├── {stickerId}/
│   │   │   │   ├── original.png
│   │   │   │   └── processed.png
│   │   │   └── ...
│   │   └── temp/
│   └── ...
└── .gitkeep
```

**Benefits of User-Scoped Storage:**
- Easy migration to cloud (move entire user folder)
- Simple cleanup on account deletion
- Quota tracking per user
- Filesystem-level isolation

### 6.3 Future S3 Provider

```typescript
class S3StorageProvider implements IStorageProvider {
  private s3Client: S3Client;
  private bucket: string;
  
  async saveFile(buffer: Buffer, options: SaveFileOptions): Promise<string> {
    const key = `users/${options.ownerId}/stickers/${options.subDir}/${filename}`;
    // Upload to S3
    return key;
  }
  
  getPublicUrl(filename: string): string {
    return `https://${this.bucket}.s3.amazonaws.com/${filename}`;
  }
}
```

---

## 7. Docker Setup

### 7.1 docker-compose.yml

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

### 7.2 Dockerfile

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

### 7.3 Development Commands

```bash
# Start all services
docker-compose up -d

# Run migrations
docker-compose exec api npx prisma migrate dev

# Seed initial data
docker-compose exec api npx prisma db seed

# View logs
docker-compose logs -f api

# Stop all
docker-compose down

# Reset database
docker-compose down -v && docker-compose up -d
```

---

## 8. API Endpoints

### 8.1 Authentication Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/auth/register` | No | Register new user |
| POST | `/api/v1/auth/login` | No | Login |
| POST | `/api/v1/auth/logout` | Yes | Logout |
| POST | `/api/v1/auth/refresh` | Cookie | Refresh access token |
| GET | `/api/v1/auth/me` | Yes | Get current user |
| PUT | `/api/v1/auth/me` | Yes | Update current user |
| DELETE | `/api/v1/auth/me` | Yes | Delete own account |
| POST | `/api/v1/auth/change-password` | Yes | Change password |

### 8.2 User Management Endpoints (Admin Only)

| Method | Endpoint | Auth | Role | Description |
|--------|----------|------|------|-------------|
| GET | `/api/v1/users` | Yes | admin | List all users |
| GET | `/api/v1/users/:id` | Yes | admin | Get user details |
| PUT | `/api/v1/users/:id` | Yes | admin | Update user |
| DELETE | `/api/v1/users/:id` | Yes | admin | Delete user |
| PUT | `/api/v1/users/:id/role` | Yes | admin | Change user role |

### 8.3 Sticker Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/stickers` | Yes | Upload new sticker |
| GET | `/api/v1/stickers` | Yes | List user's stickers |
| GET | `/api/v1/stickers/:id` | Yes/Link | Get sticker details |
| PUT | `/api/v1/stickers/:id` | Yes | Update sticker |
| DELETE | `/api/v1/stickers/:id` | Yes | Delete sticker |
| GET | `/api/v1/stickers/:id/download` | Yes/Link | Download sticker file |
| POST | `/api/v1/stickers/:id/share` | Yes | Share with user |
| DELETE | `/api/v1/stickers/:id/share` | Yes | Remove user share |
| POST | `/api/v1/stickers/:id/link` | Yes | Generate share link |
| DELETE | `/api/v1/stickers/:id/link` | Yes | Revoke share link |

### 8.4 Modified Existing Endpoints

All existing endpoints now require authentication and automatically associate results with the authenticated user:

| Method | Endpoint | Auth | Changes |
|--------|----------|------|---------|
| POST | `/api/v1/generate` | Yes | Saves sticker with ownerId, returns stickerId |
| POST | `/api/v1/grid/split` | Yes | Saves results with ownerId |
| POST | `/api/v1/background/remove` | Yes | Saves result with ownerId |

---

## 9. Security Measures

### 9.1 SQL Injection Prevention

- Use Prisma ORM with parameterized queries (auto-sanitized)
- No raw SQL queries in application code
- Input validation with Zod schemas before DB operations

### 9.2 XSS Prevention

- Helmet CSP headers already configured
- Validate and sanitize all user inputs
- No HTML rendering of user content in API responses

### 9.3 Rate Limiting

```typescript
const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  store: new RedisStore({ client: redis }),
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    res.status(429).json(
      buildErrorResponse('RATE_LIMITED', 'Too many requests')
    );
  }
});
```

### 9.4 File Upload Security

- Max file size: 10MB (configurable)
- Whitelist MIME types: PNG, JPG, JPEG, WebP, GIF
- Filename sanitization via UUID
- User-scoped storage for isolation
- Storage quota per user (configurable)

### 9.5 Authentication Security

- bcrypt with salt rounds 12
- JWT secrets minimum 32 characters
- Refresh token rotation on every use
- Token blacklisting in Redis
- Secure cookie flags: httpOnly, secure, sameSite=strict
- Password requirements: min 8 chars, mixed case, numbers, special chars

### 9.6 HTTPS/TLS

- Enforce HTTPS in production
- HSTS header via Helmet
- Secure cookies with `secure` flag

---

## 10. Error Handling

### 10.1 New Error Types

```typescript
class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429, 'RATE_LIMITED');
  }
}
```

### 10.2 HTTP Status Codes

| Code | Meaning | Usage |
|------|---------|-------|
| 200 | OK | Successful operations |
| 201 | Created | Resource created |
| 400 | Bad Request | Validation errors |
| 401 | Unauthorized | Missing/invalid auth |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource doesn't exist |
| 409 | Conflict | Duplicate resource |
| 413 | Payload Too Large | File too large |
| 415 | Unsupported Media | Invalid file type |
| 429 | Too Many Requests | Rate limited |
| 500 | Internal Error | Server errors |
| 502 | Bad Gateway | External service error |

---

## 11. Testing Strategy

### 11.1 Unit Tests

```
tests/unit/
├── services/
│   ├── auth.service.test.ts
│   ├── user.service.test.ts
│   ├── sticker.service.test.ts
│   ├── share.service.test.ts
│   └── role.service.test.ts
├── middleware/
│   ├── auth.middleware.test.ts
│   ├── permission.middleware.test.ts
│   └── rate-limit.middleware.test.ts
├── utils/
│   ├── password.test.ts
│   └── jwt.test.ts
└── storage/
    └── local-storage.test.ts
```

### 11.2 Integration Tests

```
tests/integration/
├── auth.routes.test.ts        # Register, login, refresh, logout
├── sticker.routes.test.ts     # CRUD, visibility, sharing
├── admin.routes.test.ts       # Admin-only endpoints
├── generate.routes.test.ts    # Modified with auth
├── grid.routes.test.ts        # Modified with auth
└── background.routes.test.ts  # Modified with auth
```

### 11.3 Test Database Setup

- Separate test database: `stickerdb_test`
- Run migrations before each test suite
- Seed with test data
- Clean up after each test
- Use transaction rollback for isolation

---

## 12. Environment Variables

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

---

## 13. Database Migration Plan

### Migration Sequence

1. **Migration 001: Auth Foundation**
   - Create Roles, Permissions, RolePermissions tables
   - Create Users table
   - Seed default roles and permissions

2. **Migration 002: Stickers**
   - Create Stickers table
   - Add ownerId foreign key
   - Create indexes on ownerId and visibility

3. **Migration 003: Sharing**
   - Create StickerShares table
   - Create StickerShareLinks table
   - Add foreign keys and indexes

4. **Migration 004: Token Management**
   - Create RefreshTokens table
   - Add indexes on userId and token

### Prisma Schema

```prisma
// Complete schema will be in prisma/schema.prisma
// Including all models with proper relations and indexes
```

---

## 14. Implementation Phases

### Phase 1: Foundation
1. Setup Prisma with PostgreSQL
2. Create database schema
3. Implement storage provider pattern
4. Setup Docker environment

### Phase 2: Authentication
1. Implement JWT auth service
2. Create auth controllers
3. Build auth middleware
4. Add registration/login endpoints

### Phase 3: Authorization
1. Implement role/permission system
2. Create permission middleware
3. Add user management endpoints
4. Build admin controls

### Phase 4: Sticker Management
1. Create sticker CRUD endpoints
2. Implement visibility logic
3. Add sharing functionality
4. Modify existing endpoints

### Phase 5: Security Hardening
1. Add rate limiting
2. Implement security headers
3. Add input sanitization
4. Setup audit logging

### Phase 6: Testing
1. Write unit tests
2. Create integration tests
3. Setup test database
4. Achieve >80% coverage

---

## 15. Future Considerations

1. **OAuth Integration** - Google, GitHub login
2. **Email Verification** - Verify email before full access
3. **Password Reset** - Forgot password flow
4. **2FA** - Two-factor authentication
5. **Audit Logging** - Track all actions for compliance
6. **API Keys** - For programmatic access alongside JWT
7. **Webhooks** - Notify on shared sticker access
8. **Sticker Collections** - Group stickers into albums
9. **Analytics** - Track sticker usage and popularity
10. **Cloud Storage** - S3/GCS integration

---

## 16. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Token theft | High | Medium | Short token expiry, refresh rotation, HTTPS |
| Password breach | High | Low | bcrypt hashing, password requirements |
| SQL Injection | High | Low | Prisma ORM, no raw queries |
| File traversal | Medium | Low | Path sanitization, user-scoped storage |
| Rate limit bypass | Medium | Medium | Redis-backed rate limiting, user-based keys |
| Data loss | High | Low | Regular backups, soft deletes |

---

## 17. Approval

**Approved by:** _________________ **Date:** _________________

**Notes:**
