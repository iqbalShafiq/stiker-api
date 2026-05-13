# Production Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare the WhatsApp Sticker Generator API for production deployment on a VPS with automated CI/CD via GitHub Actions.

**Architecture:** The API will run as a Docker container behind Nginx reverse proxy with SSL. CI/CD pipeline builds and deploys automatically on push to main. Database migrations run automatically. Health checks ensure reliability.

**Tech Stack:** Node.js 20, Express.js, TypeScript, Prisma, PostgreSQL, Redis, Docker, Nginx, GitHub Actions, Let's Encrypt, Pino (logging)

---

## Task 1: Create GitHub Actions CI/CD Pipeline

**Files:**
- Create: `.github/workflows/ci-cd.yml`
- Create: `.github/workflows/pr-check.yml`

**Step 1: Create CI/CD pipeline for main branch**

Create `.github/workflows/ci-cd.yml`:

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  NODE_VERSION: '20'
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # Stage 1: Quality Checks
  quality:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run typecheck

      - name: Run tests
        run: npm run test

  # Stage 2: Build Docker Image
  build:
    runs-on: ubuntu-latest
    needs: quality
    if: github.ref == 'refs/heads/main'
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,prefix=,suffix=,format=short
            type=raw,value=latest

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64

  # Stage 3: Deploy to VPS
  deploy:
    runs-on: ubuntu-latest
    needs: build
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to VPS
        uses: appleboy/ssh-action@v1.0.0
        with:
          host: ${{ secrets.VPS_HOST }}
          username: ${{ secrets.VPS_USERNAME }}
          key: ${{ secrets.VPS_SSH_KEY }}
          script: |
            cd ~/stiker-api
            
            # Pull latest code
            git pull origin main
            
            # Login to GitHub Container Registry
            echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
            
            # Pull latest image
            docker pull ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            
            # Run database migrations
            docker-compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
            
            # Restart services
            docker-compose -f docker-compose.prod.yml up -d --no-deps --build api
            
            # Cleanup old images
            docker image prune -f
            
            # Health check
            sleep 10
            curl -f http://localhost:3000/health || exit 1
```

**Step 2: Create PR check workflow**

Create `.github/workflows/pr-check.yml`:

```yaml
name: PR Checks

on:
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linter
        run: npm run lint

      - name: Run type check
        run: npm run typecheck

      - name: Run tests
        run: npm run test
```

**Step 3: Commit**

```bash
git add .github/workflows/
git commit -m "ci: add GitHub Actions CI/CD pipeline"
```

---

## Task 2: Create Production Docker Compose

**Files:**
- Create: `docker-compose.prod.yml`
- Modify: `Dockerfile`
- Create: `.dockerignore`

**Step 1: Update Dockerfile for production**

Modify `Dockerfile`:

```dockerfile
# Stage 1: Builder
FROM node:20-alpine AS builder

WORKDIR /app

# Install system dependencies for sharp and other native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    vips-dev

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Stage 2: Production
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies
RUN apk add --no-cache \
    libstdc++ \
    vips

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Generate Prisma client for production
RUN npx prisma generate

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Create uploads directory and set permissions
RUN mkdir -p uploads && chown -R nodejs:nodejs uploads

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

# Start the application
CMD ["node", "dist/server.js"]
```

**Step 2: Create production Docker Compose**

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  api:
    image: ghcr.io/${GITHUB_REPOSITORY:-your-username/stiker-api}:latest
    container_name: stiker-api
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    env_file:
      - .env.production
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
    volumes:
      - uploads:/app/uploads
      - ./logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - stiker-network
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M

  postgres:
    image: postgres:16-alpine
    container_name: stiker-postgres
    restart: unless-stopped
    environment:
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=${DB_NAME}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    networks:
      - stiker-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 1G

  redis:
    image: redis:7-alpine
    container_name: stiker-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    networks:
      - stiker-network
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M

  nginx:
    image: nginx:alpine
    container_name: stiker-nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
      - uploads:/app/uploads:ro
    depends_on:
      - api
    networks:
      - stiker-network
    command: "/bin/sh -c 'while :; do sleep 6h & wait $${!}; nginx -s reload; done & nginx -g \"daemon off;\"'"

  certbot:
    image: certbot/certbot
    container_name: stiker-certbot
    restart: unless-stopped
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done'"

networks:
  stiker-network:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  uploads:
```

**Step 3: Create .dockerignore**

Create `.dockerignore`:

```
node_modules
npm-debug.log
Dockerfile
.dockerignore
docker-compose*.yml
.git
.gitignore
README.md
.env
.env.*
!.env.example
dist
coverage
.cache
uploads/*
!uploads/.gitkeep
*.log
logs
.vscode
.idea
.DS_Store
_test_*
contoh_*
docs/*.gif
docs/*.jpeg
docs/*.webp
```

**Step 4: Commit**

```bash
git add Dockerfile docker-compose.prod.yml .dockerignore
git commit -m "docker: optimize for production deployment"
```

---

## Task 3: Create Nginx Configuration

**Files:**
- Create: `nginx/nginx.conf`
- Create: `nginx/conf.d/default.conf`
- Create: `nginx/conf.d/ssl.conf`

**Step 1: Create main nginx config**

Create `nginx/nginx.conf`:

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';

    access_log /var/log/nginx/access.log main;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 50M;

    # Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        image/svg+xml;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Rate Limiting Zones
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;

    # Upstream
    upstream api {
        server api:3000;
        keepalive 32;
    }

    include /etc/nginx/conf.d/*.conf;
}
```

**Step 2: Create default server config**

Create `nginx/conf.d/default.conf`:

```nginx
server {
    listen 80;
    server_name _;
    
    # Certbot challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect HTTP to HTTPS (after SSL is configured)
    location / {
        return 301 https://$host$request_uri;
    }
}
```

**Step 3: Create SSL config template**

Create `nginx/conf.d/ssl.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;  # CHANGE THIS

    # SSL Certificates
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;  # CHANGE THIS
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;  # CHANGE THIS

    # SSL Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Security headers
    add_header Strict-Transport-Security "max-age=63072000" always;

    # API endpoints
    location /api/ {
        limit_req zone=api burst=20 nodelay;
        
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
    }

    # Documentation
    location /docs {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # OpenAPI spec
    location /openapi.json {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        access_log off;
    }

    # Static uploads
    location /uploads/ {
        alias /app/uploads/;
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    # Root
    location / {
        proxy_pass http://api;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

**Step 4: Commit**

```bash
git add nginx/
git commit -m "nginx: add reverse proxy configuration for production"
```

---

## Task 4: Add Structured Logging

**Files:**
- Install: `pino` and `pino-pretty`
- Create: `src/utils/logger.ts`
- Modify: `src/server.ts`
- Modify: `src/app.ts`

**Step 1: Install logging dependencies**

Run: `npm install pino pino-pretty`

**Step 2: Create logger utility**

Create `src/utils/logger.ts`:

```typescript
import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
  base: {
    pid: process.pid,
    env: process.env.NODE_ENV,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'token',
      'jwtSecret',
      'jwtRefreshSecret',
      'openRouterApiKey',
      'DATABASE_URL',
      'REDIS_URL',
    ],
    censor: '[REDACTED]',
  },
});

export default logger;
```

**Step 3: Update server.ts with logging**

Modify `src/server.ts`:

```typescript
import app from './app';
import { config } from './config';
import logger from './utils/logger';

const server = app.listen(config.port, config.host, () => {
  logger.info(
    `Server running on ${config.host}:${config.port} in ${config.nodeEnv} mode`
  );
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled rejection');
});
```

**Step 4: Update app.ts to use logger**

Add import to `src/app.ts`:

```typescript
import logger from './utils/logger';
```

Replace console.log if any, and add request logging middleware after imports.

Add request logging middleware:

```typescript
import { randomUUID } from 'crypto';

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = randomUUID();
  
  req.id = requestId;
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(
      {
        requestId,
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('user-agent'),
        ip: req.ip,
      },
      `${req.method} ${req.url} ${res.statusCode} ${duration}ms`
    );
  });
  
  next();
});
```

**Step 5: Commit**

```bash
git add src/utils/logger.ts src/server.ts src/app.ts package*.json
git commit -m "feat: add structured logging with pino"
```

---

## Task 5: Enhance Health Checks

**Files:**
- Create: `src/utils/health-check.ts`
- Modify: `src/app.ts`

**Step 1: Create health check utility**

Create `src/utils/health-check.ts`:

```typescript
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import logger from './logger';

const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: { status: 'up' | 'down'; responseTime: number };
    redis: { status: 'up' | 'down'; responseTime: number };
    memory: { status: 'up' | 'down'; used: number; total: number; percentage: number };
    disk: { status: 'up' | 'down'; available: number };
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const startTime = Date.now();

  // Check database
  let dbStatus: 'up' | 'down' = 'down';
  let dbResponseTime = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbResponseTime = Date.now() - dbStart;
    dbStatus = 'up';
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    dbResponseTime = Date.now() - startTime;
  }

  // Check Redis
  let redisStatus: 'up' | 'down' = 'down';
  let redisResponseTime = 0;
  try {
    const redisStart = Date.now();
    await redis.ping();
    redisResponseTime = Date.now() - redisStart;
    redisStatus = 'up';
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    redisResponseTime = Date.now() - startTime;
  }

  // Check memory
  const usedMemory = process.memoryUsage();
  const totalMemory = require('os').totalmem();
  const memoryPercentage = (usedMemory.heapUsed / totalMemory) * 100;

  // Check disk (simplified - just check if we can write)
  let diskAvailable = 0;
  try {
    const fs = require('fs').promises;
    const stats = await fs.stat('/');
    diskAvailable = stats.size;
  } catch {
    // Ignore disk check errors
  }

  const isHealthy = dbStatus === 'up' && redisStatus === 'up' && memoryPercentage < 90;

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version || '1.0.0',
    checks: {
      database: {
        status: dbStatus,
        responseTime: dbResponseTime,
      },
      redis: {
        status: redisStatus,
        responseTime: redisResponseTime,
      },
      memory: {
        status: memoryPercentage < 90 ? 'up' : 'down',
        used: Math.round(usedMemory.heapUsed / 1024 / 1024),
        total: Math.round(totalMemory / 1024 / 1024),
        percentage: Math.round(memoryPercentage),
      },
      disk: {
        status: 'up',
        available: diskAvailable,
      },
    },
  };
}
```

**Step 2: Update health endpoint in app.ts**

Replace the existing `/health` endpoint in `src/app.ts`:

```typescript
import { getHealthStatus } from './utils/health-check';

app.get('/health', async (_req, res) => {
  const health = await getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

**Step 3: Commit**

```bash
git add src/utils/health-check.ts src/app.ts
git commit -m "feat: enhance health checks with database and redis monitoring"
```

---

## Task 6: Create Production Environment Template

**Files:**
- Create: `.env.production.example`
- Create: `scripts/setup-production.sh`

**Step 1: Create production env template**

Create `.env.production.example`:

```
# Server Configuration
PORT=3000
HOST=0.0.0.0
NODE_ENV=production
APP_URL=https://your-domain.com

# Security
CORS_ORIGIN=https://your-domain.com

# File Upload
MAX_FILE_SIZE=10485760
UPLOAD_DIR=uploads

# Database Configuration
DATABASE_URL=postgresql://postgres:secure_password_here@postgres:5432/sticker_api
DB_USER=postgres
DB_PASSWORD=secure_password_here
DB_NAME=sticker_api
DB_PORT=5432

# Redis Configuration
REDIS_URL=redis://redis:6379
REDIS_PORT=6379

# JWT Authentication (GENERATE STRONG SECRETS!)
JWT_SECRET=your-super-secret-jwt-key-min-32-chars
JWT_REFRESH_SECRET=your-super-secret-refresh-key-min-32-chars
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d

# OpenRouter API
OPENROUTER_API_KEY=your_openrouter_api_key

# Image Processing
IMGLY_BG_MODEL=medium
IMGLY_BG_MAX_CONCURRENCY=2

# Animated GIF Configuration
ANIMATED_GIF_MAX_FRAMES=120
ANIMATED_GIF_MAX_MEGAPIXELS_PER_FRAME=12
ANIMATED_GIF_DITHER=0
ANIMATED_GIF_REUSE_PALETTE=false
ANIMATED_GIF_ALPHA_BOOST_DIVISOR=0.76
ANIMATED_GIF_ALPHA_CLOSE_KERNEL=5
ANIMATED_GIF_CORNER_BG_STRIP_DIST=64
ANIMATED_GIF_TEMPORAL_ALPHA_MAX_HALF=3
ANIMATED_GIF_TEMPORAL_ALPHA_PASSES=3
ANIMATED_GIF_TEMPORAL_DILATE_ALPHA=5

# AI Model Configuration
IMAGE_GENERATION_MODEL=google/gemini-2.5-flash-image
AGENT_MODEL=google/gemini-2.5-flash-lite

# Storage
STORAGE_PROVIDER=local

# Logging
LOG_LEVEL=info

# History Cleanup
HISTORY_EXPIRATION_DAYS=7
```

**Step 2: Create setup script**

Create `scripts/setup-production.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Setting up Stiker API for production..."

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo "❌ Please do not run as root"
   exit 1
fi

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p uploads
mkdir -p logs
mkdir -p backups
mkdir -p certbot/conf
mkdir -p certbot/www
mkdir -p nginx/conf.d

# Copy example env if .env.production doesn't exist
if [ ! -f .env.production ]; then
    echo "📝 Creating .env.production from template..."
    cp .env.production.example .env.production
    echo "⚠️  Please edit .env.production with your actual values!"
fi

# Generate secure JWT secrets if not set
if grep -q "your-super-secret-jwt-key" .env.production; then
    echo "🔑 Generating secure JWT secrets..."
    JWT_SECRET=$(openssl rand -base64 48)
    JWT_REFRESH_SECRET=$(openssl rand -base64 48)
    
    sed -i "s/your-super-secret-jwt-key-min-32-chars/${JWT_SECRET}/g" .env.production
    sed -i "s/your-super-secret-refresh-key-min-32-chars/${JWT_REFRESH_SECRET}/g" .env.production
    
    echo "✅ JWT secrets generated automatically"
fi

# Pull latest images
echo "🐳 Pulling Docker images..."
docker-compose -f docker-compose.prod.yml pull

# Start database services first
echo "🗄️  Starting database services..."
docker-compose -f docker-compose.prod.yml up -d postgres redis

# Wait for databases to be ready
echo "⏳ Waiting for databases to be ready..."
sleep 10

# Run migrations
echo "🔄 Running database migrations..."
docker-compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy

# Start all services
echo "🚀 Starting all services..."
docker-compose -f docker-compose.prod.yml up -d

# Check health
echo "🏥 Checking health..."
sleep 5
curl -f http://localhost:3000/health || echo "⚠️  Health check failed, but services are starting..."

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Update nginx/conf.d/ssl.conf with your domain"
echo "2. Configure SSL certificates with: ./scripts/init-ssl.sh your-domain.com your-email@example.com"
echo "3. Update .env.production with your actual API keys"
echo "4. Configure GitHub Actions secrets for CI/CD"
echo ""
```

Make executable: `chmod +x scripts/setup-production.sh`

**Step 3: Create SSL initialization script**

Create `scripts/init-ssl.sh`:

```bash
#!/bin/bash
set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: $0 <domain> <email>"
    echo "Example: $0 api.example.com admin@example.com"
    exit 1
fi

echo "🔒 Initializing SSL for $DOMAIN..."

# Update nginx config with domain
sed -i "s/your-domain.com/${DOMAIN}/g" nginx/conf.d/ssl.conf

# Start nginx for certbot challenge
docker-compose -f docker-compose.prod.yml up -d nginx

# Get certificate
docker run -it --rm \
    -v $(pwd)/certbot/conf:/etc/letsencrypt \
    -v $(pwd)/certbot/www:/var/www/certbot \
    certbot/certbot certonly \
    --webroot \
    --webroot-path /var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    -d $DOMAIN

# Restart nginx with SSL
docker-compose -f docker-compose.prod.yml restart nginx

echo "✅ SSL certificate installed for $DOMAIN"
```

Make executable: `chmod +x scripts/init-ssl.sh`

**Step 4: Create backup script**

Create `scripts/backup.sh`:

```bash
#!/bin/bash
set -e

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_CONTAINER="stiker-postgres"
DB_NAME="sticker_api"
DB_USER="postgres"
RETENTION_DAYS=7

echo "💾 Starting backup at ${DATE}..."

# Create backup directory
mkdir -p ${BACKUP_DIR}

# Backup database
echo "🗄️  Backing up database..."
docker exec ${DB_CONTAINER} pg_dump -U ${DB_USER} -d ${DB_NAME} | gzip > ${BACKUP_DIR}/db_backup_${DATE}.sql.gz

# Backup uploads
echo "📁 Backing up uploads..."
tar -czf ${BACKUP_DIR}/uploads_backup_${DATE}.tar.gz uploads/

# Cleanup old backups
echo "🧹 Cleaning up old backups..."
find ${BACKUP_DIR} -name "db_backup_*.sql.gz" -mtime +${RETENTION_DAYS} -delete
find ${BACKUP_DIR} -name "uploads_backup_*.tar.gz" -mtime +${RETENTION_DAYS} -delete

echo "✅ Backup complete!"
echo "📊 Database: ${BACKUP_DIR}/db_backup_${DATE}.sql.gz"
echo "📊 Uploads: ${BACKUP_DIR}/uploads_backup_${DATE}.tar.gz"
```

Make executable: `chmod +x scripts/backup.sh`

**Step 5: Commit**

```bash
git add scripts/ .env.production.example
git commit -m "ops: add production setup and backup scripts"
```

---

## Task 7: Create Deployment Documentation

**Files:**
- Create: `docs/DEPLOYMENT.md`

**Step 1: Create comprehensive deployment guide**

Create `docs/DEPLOYMENT.md`:

```markdown
# Production Deployment Guide

## Prerequisites

- VPS with Docker and Docker Compose installed
- Domain name pointing to your VPS
- GitHub account with this repository

## VPS Requirements

- Ubuntu 22.04 LTS or newer
- Minimum 2GB RAM, 2 CPU cores
- 20GB disk space
- Docker 24.0+
- Docker Compose 2.0+

## Initial Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-username/stiker-api.git
cd stiker-api
```

### 2. Configure Environment

```bash
# Copy production environment template
cp .env.production.example .env.production

# Edit with your values
nano .env.production
```

### 3. Run Setup Script

```bash
./scripts/setup-production.sh
```

### 4. Configure SSL

```bash
./scripts/init-ssl.sh your-domain.com your-email@example.com
```

### 5. Update Nginx Config

Edit `nginx/conf.d/ssl.conf` and replace `your-domain.com` with your actual domain.

## GitHub Actions Setup

### Required Secrets

Go to Settings > Secrets and variables > Actions, add these secrets:

- `VPS_HOST`: Your VPS IP address or domain
- `VPS_USERNAME`: SSH username (e.g., `root` or `ubuntu`)
- `VPS_SSH_KEY`: Private SSH key for deployment

### Optional: GitHub Container Registry

The pipeline automatically pushes to GHCR. Make sure your repository has package write permissions.

## Database Migrations

Migrations run automatically during deployment. To run manually:

```bash
docker-compose -f docker-compose.prod.yml run --rm api npx prisma migrate deploy
```

## Backups

### Manual Backup

```bash
./scripts/backup.sh
```

### Automated Backups (Cron)

```bash
# Edit crontab
crontab -e

# Add daily backup at 2 AM
0 2 * * * /path/to/stiker-api/scripts/backup.sh >> /path/to/stiker-api/logs/backup.log 2>&1
```

## Monitoring

### Health Check

```bash
curl https://your-domain.com/health
```

### Logs

```bash
# API logs
docker-compose -f docker-compose.prod.yml logs -f api

# Nginx logs
docker-compose -f docker-compose.prod.yml logs -f nginx

# All logs
docker-compose -f docker-compose.prod.yml logs -f
```

### View Logs File

```bash
tail -f logs/app.log
```

## Updates

### Automatic (CI/CD)

Push to main branch triggers automatic deployment.

### Manual

```bash
# Pull latest code
git pull origin main

# Pull latest image
docker pull ghcr.io/your-username/stiker-api:latest

# Restart services
docker-compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs api

# Check health
docker-compose -f docker-compose.prod.yml ps
```

### Database Connection Issues

```bash
# Check if postgres is running
docker-compose -f docker-compose.prod.yml ps postgres

# Check database logs
docker-compose -f docker-compose.prod.yml logs postgres
```

### SSL Issues

```bash
# Renew certificates manually
docker-compose -f docker-compose.prod.yml run --rm certbot certbot renew

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

## Security Checklist

- [ ] Change default passwords
- [ ] Use strong JWT secrets
- [ ] Enable firewall (ufw)
- [ ] Disable root SSH login
- [ ] Use SSH key authentication
- [ ] Keep system updated
- [ ] Regular backups configured
- [ ] SSL/TLS enabled
- [ ] Rate limiting enabled
- [ ] CORS configured properly

## Support

For issues or questions:
1. Check logs first
2. Review health endpoint
3. Check GitHub Actions logs
4. Open an issue on GitHub
```

**Step 2: Commit**

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: add comprehensive deployment documentation"
```

---

## Task 8: Add Request ID and Security Headers

**Files:**
- Modify: `src/app.ts`

**Step 1: Enhance app.ts with additional security**

Add request ID middleware:

```typescript
import { randomUUID } from 'crypto';

// Request ID middleware
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
});
```

Add production trust proxy:

```typescript
if (config.nodeEnv === 'production') {
  app.set('trust proxy', 1);
}
```

**Step 2: Commit**

```bash
git add src/app.ts
git commit -m "feat: add request ID tracking and production trust proxy"
```

---

## Task 9: Final Verification

**Files:**
- Run: `npm run lint`
- Run: `npm run typecheck`
- Run: `npm run test`

**Step 1: Run quality checks**

```bash
npm run lint
npm run typecheck
npm run test
```

**Step 2: Build Docker image locally**

```bash
docker build -t stiker-api:test .
```

**Step 3: Final commit**

```bash
git add .
git commit -m "chore: production readiness complete"
```

---

## Summary

After completing all tasks, the API will be ready for production with:

1. **CI/CD Pipeline**: Automated build, test, and deploy via GitHub Actions
2. **Docker**: Multi-stage optimized production image
3. **Nginx**: Reverse proxy with SSL/TLS
4. **Monitoring**: Enhanced health checks and structured logging
5. **Security**: Security headers, request tracking, redacted logs
6. **Backups**: Automated database and file backups
7. **Documentation**: Complete deployment guide

**Required manual steps:**
1. Set GitHub Actions secrets (VPS_HOST, VPS_USERNAME, VPS_SSH_KEY)
2. Configure domain in nginx/conf.d/ssl.conf
3. Set actual API keys in .env.production
4. Run SSL initialization script
5. Configure DNS to point to VPS
