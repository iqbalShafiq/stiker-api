# App Cleanup + Model Catalog (DB) + Images API — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Konsolidasi config/deployment (1 `.env.example` + 1 compose ber-profile), katalog model AI DB-backed dengan seeder (Muse Spark + Seedream), adapter image baru via OpenRouter Images API, struktur `src/ai` rapi, serta penghapusan seluruh fallback deterministik & backward-compat usang — tanpa mengubah kontrak HTTP.

**Architecture:** Config env tunggal (`AGENT_API_KEY`/`AGENT_BASE_URL`) + katalog `AiModel` di Postgres (seeder idempotent, runtime cache per-proses, baris absen = gagal cepat). `image` role → Images API adapter (`POST {base}/images`, `input_references` ≤14); role lain → Chat Completions dengan reasoning effort dari DB. Service dipecah: `ImageGenerationService` + `VisionAnalysisService` (provider-agnostic). Fail-fast untuk rahasia; rerouting error yang jujur menggantikan fallback.

**Tech Stack:** Node ≥20 (CommonJS), TypeScript 5.4, zod 4, Express 4, Prisma 7 + Postgres, Anvia (`@anvia/core` 1.14.0, `@anvia/openai` 1.3.0, `@anvia/langfuse` 1.2.1 + patch `patches/@anvia+langfuse+1.2.1.patch`), docker compose v2 profiles, vitest 1.

**Spec:** `docs/superpowers/specs/2026-10-13-app-cleanup-design.md`

## Global Constraints

- Backend tetap CommonJS; impor `@anvia/*` hanya dari root package dan hanya via `src/ai/esm.ts` (lihat spec migrasi).
- Gate lokal: `npx vitest run tests/unit` (script `npm test` ber-sintaks Unix, tidak jalan di PowerShell). 2 test gagal pre-existing (Prisma DB mati) TIDAK dihitung regresi.
- Model katalog final hanya dua: `meta/muse-spark-1.3-contributor` (role `agent|vision|improvement`) dan `bytedance-seed/seedream-5-0-flash` (role `image`). Model lain (gpt-4.1-mini, gemini-*) DIHAPUS dari DB, kode, env, docs.
- Nama env final: `AGENT_API_KEY`, `AGENT_BASE_URL` (default `https://openrouter.ai/api/v1`), `LANGFUSE_BASE_URL/PUBLIC_KEY/SECRET_KEY`. Env model & `OPENROUTER_API_KEY` lenyap dari semua file.
- Tidak ada fallback deterministik: kegagalan AI = error taksonomi (`AIGenerationError` 502 / `TimeoutError` 504 / `ProviderError` 502 / `GridDetectionError` 422 / `BackgroundRemovalError` 500). Pengecualian yang DISETUJUI: grid-split toleransi per-sel (bg removal gagal di satu sel → sel dilewati, batch lanjut); `AGENT_API_KEY` dicek di boundary AI (bukan boot).
- Signature HTTP endpoint tidak berubah; bentuk respons & metadata tetap (field `model`/`improvementAgentModel` tetap diisi, sumbernya katalog).
- `IMPROVEMENT_GRID_MAX_CELLS` 16 → 14 (cap `input_references` Seedream).
- Seeder tetap **JavaScript** (`prisma/seed.js`) — prod image tidak memiliki `tsx` (`npm ci --omit=dev`); data katalog AI diekstrak ke modul data CJS yang bisa di-unit-test.
- `prisma` CLI dipindah ke `dependencies` (dipakai runtime `migrate deploy`/`db seed` di container prod tanpa unduh via npx).
- Setiap task diakhiri commit; lint + typecheck + unit hijau sebelum commit.

## Review Focus

Lima hal yang tidak sepenuhnya diekspresikan spec namun paling mungkin menggigit; masing-masing punya test di task pemiliknya:

1. **Baris `AiModel` hilang / DB belum di-seed** → harus gagal cepat dengan pesan yang menyebut `prisma db seed`, bukan error `undefined` yang membingungkan — Task 3 (`tests/unit/ai/models/catalog.test.ts`).
2. **Pemetaan aspect ratio & `input_references` di adapter Images API** (data URL, cap 14, nilai di luar tabel → `auto`) — Task 4 (`tests/unit/ai/provider/images-api-model.test.ts`).
3. **Rahasia kosong** (`JWT_SECRET` dkk) harus menggagalkan boot dengan menyebut nama var — Task 1 (`tests/unit/config/required-env.test.ts`).
4. **Perilaku `IMPROVEMENT_GRID_MAX_CELLS=14`** pada chunking (15 → [14,1]; 32 → [14,14,4]) — Task 4 (update `tests/unit/utils/improvement.test.ts`).
5. **`patch-package` di image Docker**: `patches/` harus dicopy SEBELUM `npm ci` di kedua stage, kalau tidak tracing Langfuse mati diam-diam di produksi — Task 2 (verifikasi statis Dockerfile + `docker compose config`).

---

## File Map

**Dibuat:**
- `prisma/ai-models.seed.js` — data katalog AI (CJS murni, diimpor seed + test)
- `prisma/migrations/20261013150000_add_ai_models/migration.sql`
- `src/ai/models/catalog.ts`, `src/ai/models/controls.ts`
- `src/ai/provider/client.ts` (rename dari `src/ai/openrouter.ts`)
- `src/ai/provider/completion-model.ts`
- `src/ai/provider/images-api-model.ts`
- `src/ai/agents/video-sticker-pack/{agent,prompts,tools}.ts` (pecahan dari `src/ai/video-sticker-pack-agent.ts`)
- `src/services/image-generation.service.ts`, `src/services/vision-analysis.service.ts`
- `docs/ARCHITECTURE.md`
- Tests baru: `tests/unit/config/required-env.test.ts`, `tests/unit/ai/models/catalog.test.ts`, `tests/unit/ai/provider/images-api-model.test.ts`, `tests/unit/ai/provider/completion-model.test.ts`, `tests/unit/services/image-generation.service.test.ts`, `tests/unit/services/vision-analysis.service.test.ts`, `tests/unit/prisma/ai-models-seed.test.ts`

**Dimodifikasi:** `.env.example`, `.gitignore`, `.dockerignore`, `docker-compose.yml`, `Dockerfile`, `package.json`/lock, `prisma.config.ts`, `prisma/schema.prisma`, `prisma/seed.js`, `scripts/{setup-production,init-ssl,backup}.sh`, `src/config/index.ts`, `src/utils/logger.ts` (tetap), `src/services/{video-sticker-pack-agent,grid-split,image,background-removal,animated-gif-background-removal}.service.ts`, `src/controllers/{generate,grid}.controller.ts`, `src/middleware/error-handler.ts`, `src/errors/index.ts`, `src/ai/{completion,tracing}.ts`, `README.md`, `docs/play-console/data-safety-mapping.md`, `tests/setup.ts`, tests terdampak.

**Dihapus:** `.env.production.example`, `docker-compose.prod.yml`, `docker-compose.test.yml`, `src/services/openrouter.service.ts`, `src/services/imgly-background-removal-toggle.ts`, `src/ai/openrouter.ts`, `src/ai/openrouter-image.ts`, `src/ai/video-sticker-pack-agent.ts` (dipindah), `tests/unit/ai/openrouter-image.test.ts`, `tests/unit/services/openrouter.service.test.ts` (diganti), method `imageService.removeBackground`/`removeNeutralBrightBackground`/`detectGridBoundaries`/`detectContentIntervals`.

---

### Task 1: Config tunggal + fail-fast + audit env + tests/setup

**Files:**
- Modify: `src/config/index.ts`, `.env.example`, `tests/setup.ts`
- Create: `tests/unit/config/required-env.test.ts`

**Interfaces:**
- Produces: `config.agent = { apiKey: string; baseUrl: string }`; helper `requiredEnv(name: string): string` (diekspor dari config untuk test); `config.models` dan `config.openRouterApiKey` **dihapus** (konsumen diperbaiki di Task 3–5 — sementara ini config masih harus compile: lihat Step 4 yang menyisakan shim sementara? TIDAK — Step 4 menghapus, jadi Task 1 TIDAK boleh menghapus sebelum konsumen beres).
- **Urutan aman**: Task 1 hanya MENAMBAH `agent` + helper, MEMPERTAHANKAN `models`/`openRouterApiKey` sebagai jembatan sementara dengan TODO yang akan dihapus di Task 3. Ini satu-satunya kompromi jembatan; sah karena kompilasi harus tetap hijau per-task.

- [ ] **Step 1: Tulis test yang gagal — `tests/unit/config/required-env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { requiredEnvFrom, MissingEnvError } from '../../../src/config';

describe('requiredEnv', () => {
  it('returns the value when present', () => {
    expect(requiredEnvFrom({ JWT_SECRET: 'abc' }, 'JWT_SECRET')).toBe('abc');
  });

  it('throws a MissingEnvError naming every missing variable', () => {
    expect(() => requiredEnvFrom({ A: 'x' }, 'A', 'B', 'C')).toThrow(MissingEnvError);
    expect(() => requiredEnvFrom({ A: 'x' }, 'A', 'B', 'C')).toThrow(/B, C/);
  });
});
```

- [ ] **Step 2: Jalankan — pastikan gagal**

Run: `npx vitest run tests/unit/config/required-env.test.ts`
Expected: FAIL (`src/config` belum mengekspor `requiredEnvFrom`/`MissingEnvError`).

- [ ] **Step 3: Implementasi di `src/config/index.ts`**

Tambahkan di atas (setelah imports):

```ts
export class MissingEnvError extends Error {
  constructor(names: string[]) {
    super(`Missing required environment variables: ${names.join(', ')}`);
    this.name = 'MissingEnvError';
  }
}

/** Throws when any requested variable is missing/blank. Pure for testability. */
export function requiredEnvFrom(
  source: Record<string, string | undefined>,
  ...names: string[]
): string {
  const missing = names.filter((name) => {
    const value = source[name];
    return value === undefined || value.trim().length === 0;
  });
  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }
  return source[names[0]] as string;
}
```

Dan di dalam objek `config` (blok baru sebelum `langfuse`):

```ts
  agent: {
    apiKey: process.env.AGENT_API_KEY ?? '',
    baseUrl: process.env.AGENT_BASE_URL ?? 'https://openrouter.ai/api/v1',
  },
```

Di bawah objek `config`, tambahkan boot-check (fail-fast) — JANGAN di dalam literal `as const`:

```ts
/** Fail fast at boot when required secrets are absent (no placeholder defaults). */
requiredEnvFrom(process.env, 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'DATABASE_URL');
```

Catatan penting: `JWT_SECRET`/`JWT_REFRESH_SECRET`/`DATABASE_URL` juga masih dibaca oleh `config.jwtSecret` dsb — ganti bacaannya menjadi `requiredEnvFrom(process.env, ...)` agar nilai default palsu hilang:

```ts
  jwtSecret: requiredEnvFrom(process.env, 'JWT_SECRET'),
  jwtRefreshSecret: requiredEnvFrom(process.env, 'JWT_REFRESH_SECRET'),
  databaseUrl: requiredEnvFrom(process.env, 'DATABASE_URL'),
```

(Tiga key itu dipindah keluar literal `as const` — letakkan objek `config` sebagai `export const config = { ... } as const;` lalu panggilan `requiredEnvFrom` di tempat pemakaiannya. Alternatif lebih rapi yang DIPILIH: hitung dulu `const jwtSecret = requiredEnvFrom(...)` di atas objek, lalu pakai `jwtSecret` di literal.)

**Jembatan sementara** (dihapus Task 3): pertahankan `openRouterApiKey` + blok `models` untuk sementara, tapi arahkan `openRouterApiKey: process.env.AGENT_API_KEY ?? ''`.

- [ ] **Step 4: Update `.env.example` — tulis ulang penuh**

Konten final (satu file; urutan ini dipertahankan):

```dotenv
# ── App ─────────────────────────────────────────────────────────────────────
PORT=3000
HOST=0.0.0.0
NODE_ENV=development
APP_URL=http://localhost:3000
CORS_ORIGIN=*
LOG_LEVEL=debug            # Production: info
MAX_FILE_SIZE=10485760
UPLOAD_DIR=uploads

# ── AI gateway (OpenAI-compatible; default OpenRouter) ──────────────────────
AGENT_API_KEY=
AGENT_BASE_URL=https://openrouter.ai/api/v1

# ── Langfuse tracing (optional — empty disables tracing) ────────────────────
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=

# ── Database (DATABASE_URL required; DB_* used by docker compose) ───────────
DATABASE_URL=postgresql://postgres:password@localhost:5432/sticker_api
DB_USER=postgres
DB_PASSWORD=password
DB_NAME=sticker_api
DB_PORT=5432

# ── Redis ───────────────────────────────────────────────────────────────────
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379
REDIS_ENABLED=true

# ── Auth (Production: openssl rand -base64 48) ──────────────────────────────
JWT_SECRET=change-me-32-characters-minimum-secret
JWT_REFRESH_SECRET=change-me-32-characters-minimum-refresh
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=7d
GOOGLE_CLIENT_IDS=
APPLE_CLIENT_IDS=

# ── Email (Resend) ──────────────────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM=Setiker <support@setiker.app>
SUPPORT_EMAIL=support@setiker.app
PRIVACY_EMAIL=
PASSWORD_RESET_URL_BASE=http://localhost:3000/reset-password
PASSWORD_RESET_TOKEN_TTL_MINUTES=60
APP_DEEP_LINK_SCHEME=setiker
PUBLIC_WEB_BASE_URL=

# ── Storage ─────────────────────────────────────────────────────────────────
STORAGE_PROVIDER=local
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=us-east-1
# AWS_S3_BUCKET_NAME=

# ── Background removal / animated GIF ───────────────────────────────────────
IMGLY_BG_MODEL=medium
# IMGLY_BG_PUBLIC_PATH=node_modules/@imgly/background-removal-node/dist
IMGLY_BG_MAX_CONCURRENCY=2
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

# ── AI quota (daily points) ─────────────────────────────────────────────────
AI_DAILY_POINT_LIMIT=100
AI_RESERVATION_TTL_SECONDS=3600
PACK_IMPORT_ENABLED=true
# AI_QUOTA_FAIL_CLOSED=true   # Production default (true outside development)
# AI_OPERATION_COSTS={"generate":1,"gridSplit":1,"backgroundRemove":1,"videoStickerPack":1,"improve":1,"packImport":1}
AI_COST_GENERATE=1
AI_COST_GRID_SPLIT=1
AI_COST_BACKGROUND_REMOVE=1
AI_COST_VIDEO_PACK=1
AI_COST_IMPROVE=1
AI_COST_PACK_IMPORT=1

# ── Billing (store-compliant IAP; Xendit optional for non-store builds) ─────
BILLING_DAILY_RESET_TIMEZONE=Asia/Jakarta
BILLING_FREE_DAILY_POINT_LIMIT=100
BILLING_PREMIUM_DAILY_POINT_LIMIT=500
GOOGLE_PLAY_PACKAGE_NAME=com.setiker.app
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH=
GOOGLE_PLAY_RTDN_VERIFICATION_TOKEN=
GOOGLE_PLAY_MOCK_MODE=false
APPLE_BUNDLE_ID=com.setiker.app
APPLE_APP_STORE_ISSUER_ID=
APPLE_APP_STORE_KEY_ID=
APPLE_APP_STORE_PRIVATE_KEY_PATH=
APPLE_APP_STORE_ENVIRONMENT=Sandbox
APPLE_APP_STORE_APP_ID=
APPLE_MOCK_MODE=false
XENDIT_ENABLED=false
XENDIT_SECRET_KEY=
XENDIT_WEBHOOK_TOKEN=
XENDIT_PRODUCT_PRICES_JSON=

# ── Legal & housekeeping ────────────────────────────────────────────────────
APP_NAME=Setiker
DEVELOPER_NAME=Setiker
SUPPORT_EMAIL_DISPLAY=Setiker Support
PRIVACY_NOTIFICATION_WEBHOOK_URL=
DELETED_ACCOUNT_GRACE_DAYS=30
CONTENT_SAFETY_ENABLED=true
HISTORY_EXPIRATION_DAYS=7
CLEANUP_INTERVAL_HOURS=24
```

(Hapus `SUPPORT_EMAIL_DISPLAY` bila tidak dibaca config — cek `grep SUPPORT_EMAIL_DISPLAY src`; audit step: `grep -o 'process.env.[A-Z_]*' src/config/index.ts | sort -u` lalu bandingkan dengan file di atas.)

- [ ] **Step 5: Update `tests/setup.ts`**

```ts
process.env.AGENT_API_KEY = 'test-api-key';
process.env.AGENT_BASE_URL = 'https://openrouter.example/api/v1';
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
process.env.APP_URL = 'http://localhost:3000';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5433/sticker_api_test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6380';
// Empty (not deleted) so dotenv does not repopulate from a developer .env file.
process.env.LANGFUSE_PUBLIC_KEY = '';
process.env.LANGFUSE_SECRET_KEY = '';
process.env.LANGFUSE_BASE_URL = '';
```

(Buang `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `IMGLY_BG_ENABLED`.)

- [ ] **Step 6: Verifikasi**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit/config/required-env.test.ts tests/unit/ai`
Expected: PASS (test config baru + semua test ai lama tetap hijau).

- [ ] **Step 7: Commit**

```bash
git add src/config/index.ts .env.example tests/setup.ts tests/unit/config/required-env.test.ts
git commit -m "feat(config): single env example, generic AGENT_* gateway vars, fail-fast secrets"
```

---

### Task 2: Deployment satu file — compose profiles, Dockerfile patches, scripts, gitignore

**Files:**
- Rewrite: `docker-compose.yml`
- Modify: `Dockerfile`, `.dockerignore`, `.gitignore`, `package.json` (scripts), `scripts/setup-production.sh`, `scripts/init-ssl.sh`
- Delete: `docker-compose.prod.yml`, `docker-compose.test.yml`, `.env.production.example`
- Migrate: `.env` lokal (script, tanpa cetak rahasia)

**Interfaces:**
- Produces: perintah baku `docker compose --profile dev|test|prod ...`; npm `test:up`/`test:down` memakai profil test; `setup-production.sh` memakai satu compose + `.env`.

- [ ] **Step 1: Tulis ulang `docker-compose.yml` (satu file, profiles)**

```yaml
name: stiker-api

services:
  postgres:
    image: postgres:16-alpine
    profiles: [dev, prod]
    container_name: stiker-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-postgres}
      POSTGRES_DB: ${DB_NAME:-sticker_api}
    ports:
      - "127.0.0.1:${DB_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER:-postgres} -d ${DB_NAME:-sticker_api}"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    networks: [stiker-network]

  redis:
    image: redis:7-alpine
    profiles: [dev, prod]
    container_name: stiker-redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "127.0.0.1:${REDIS_PORT:-6379}:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 5s
    networks: [stiker-network]

  api:
    profiles: [dev]
    build:
      context: .
      dockerfile: Dockerfile
    env_file: .env
    environment:
      - NODE_ENV=${NODE_ENV:-development}
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-sticker_api}
      - REDIS_URL=redis://redis:6379
    ports:
      - "${PORT:-3000}:3000"
    volumes:
      - uploads:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks: [stiker-network]

  app:
    profiles: [prod]
    image: ghcr.io/iqbalshafiq/stiker-api:${IMAGE_TAG:-latest}
    container_name: api
    restart: unless-stopped
    env_file: .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-sticker_api}
      - REDIS_URL=redis://redis:6379
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - uploads:/app/uploads
      - ./logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks: [stiker-network]
    cpus: '2.0'
    mem_limit: 2g

  migrate:
    profiles: [prod]
    image: ghcr.io/iqbalshafiq/stiker-api:${IMAGE_TAG:-latest}
    env_file: .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-sticker_api}
    command: ["npx", "prisma", "migrate", "deploy"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
    networks: [stiker-network]

  seed:
    profiles: [prod]
    image: ghcr.io/iqbalshafiq/stiker-api:${IMAGE_TAG:-latest}
    env_file: .env
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-postgres}@postgres:5432/${DB_NAME:-sticker_api}
    command: ["npx", "prisma", "db", "seed"]
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"
    networks: [stiker-network]

  nginx:
    profiles: [prod]
    image: nginx:alpine
    container_name: stiker-nginx
    restart: unless-stopped
    ports:
      - "8080:80"
      - "8443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
      - uploads:/app/uploads:ro
    depends_on: [app]
    networks: [stiker-network]
    command: "/bin/sh -c 'while :; do sleep 6h & wait $${!}; nginx -s reload; done & nginx -g \"daemon off;\"'"

  postgres-test:
    profiles: [test]
    image: postgres:16-alpine
    container_name: stiker-postgres-test
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: sticker_api_test
    ports:
      - "5433:5432"
    volumes:
      - postgres_test_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d sticker_api_test"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis-test:
    profiles: [test]
    image: redis:7-alpine
    container_name: stiker-api-redis-test
    ports:
      - "6380:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

networks:
  stiker-network:
    driver: bridge

volumes:
  postgres_data:
  redis_data:
  uploads:
  postgres_test_data:
```

Catatan desain yang harus ditulis di README: postgres/redis prod kini ter-bind `127.0.0.1` (localhost-only) — perubahan posture dari sebelumnya yang tidak mem-publish port.

- [ ] **Step 2: Perbaiki `Dockerfile` (dua hal)**

1. **Copy `patches/` sebelum `npm ci`** di builder DAN production stage:

```dockerfile
COPY package*.json ./
COPY patches ./patches
```

2. `patches` juga harus tidak diabaikan `.dockerignore` (Step 3).

3. Pastikan prod stage tetap `npm ci --omit=dev` (postinstall `patch-package` kini menemukan `patches/`; `patch-package` dipindah? — tetap di `dependencies` seperti sekarang ✓) dan `npx prisma generate` berjalan (Task 3 memindahkan `prisma` ke `dependencies`).

- [ ] **Step 3: Update `.dockerignore`**

Tambah baris (jangan abaikan `patches`):

```
.superpowers
certbot
backups
logs
scripts/tmp-*
```

(Verifikasi tidak ada pola yang mengecualikan `patches/`.)

- [ ] **Step 4: Tulis ulang `.gitignore`**

```gitignore
# Dependencies
node_modules/

# Build output
dist/
build/
*.tsbuildinfo

# Environment files (keep the example)
.env*
!.env.example

# IDE / OS
.vscode/
.idea/
*.swp
*.swo
*~
.DS_Store
Thumbs.db
Desktop.ini

# Logs & runtime dirs
*.log
logs/
backups/
certbot/
uploads/*
!uploads/.gitkeep

# Local ML / ONNX model cache (e.g. @imgly/background-removal-node)
.cache/

# Test coverage
coverage/
.nyc_output/

# Agent scratch (superpowers workspaces self-ignore too)
.superpowers/
```

- [ ] **Step 5: Update `package.json` scripts + hapus file lama**

Ganti script test-stack (buang sintaks env-prefix ala Unix yang tidak portabel):

```json
    "test:up": "docker compose --profile test up -d --wait postgres-test redis-test",
    "test:migrate": "tsx scripts/test-migrate.ts",
    "test:down": "docker compose --profile test down -v"
```

dengan `scripts/test-migrate.ts` (env di-set via kode sehingga jalan di PowerShell maupun CI/Linux):

```ts
import { execSync } from 'node:child_process';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/sticker_api_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380';

execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
```

Hapus `docker-compose.prod.yml`, `docker-compose.test.yml`, `.env.production.example` (`Remove-Item`).

- [ ] **Step 6: Update `scripts/setup-production.sh` & `scripts/init-ssl.sh`**

Semua `docker-compose -f docker-compose.prod.yml X` → `docker compose --profile prod X`; referensi `.env.production` → `.env`; pesan "Please edit .env with your actual values"; `sed` JWT kini menargetkan `.env`. Pada `init-ssl.sh`: `docker compose --profile prod up -d nginx` / `restart nginx`.

- [ ] **Step 7: Migrasi `.env` lokal (tanpa mencetak rahasia)**

```powershell
node -e "const fs=require('fs');let t=fs.readFileSync('.env','utf8');const get=(k)=>{const m=t.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1].trim():null;};const key=get('OPENROUTER_API_KEY');if(key&&key.length>0){t=t.replace(/^OPENROUTER_API_KEY=.*$/m,'');if(!/^AGENT_API_KEY=/m.test(t))t+='\nAGENT_API_KEY='+key;if(!/^AGENT_BASE_URL=/m.test(t))t+='\nAGENT_BASE_URL=https://openrouter.ai/api/v1';}for(const k of ['AGENT_MODEL','VIDEO_STICKER_PACK_AGENT_MODEL','IMPROVEMENT_AGENT_MODEL','IMAGE_GENERATION_MODEL','IMGLY_BG_ENABLED']){t=t.replace(new RegExp('^'+k+'=.*$\\n?','m'),'');}fs.writeFileSync('.env',t);console.log('env migrated: OPENROUTER_API_KEY -> AGENT_API_KEY; model vars removed');"
```

Cek hasil: `Select-String -Path .env -Pattern 'AGENT_API_KEY|AGENT_BASE_URL'` (nilai tidak dicetak — hanya pastikan baris ada; gunakan `-Pattern '^AGENT_API_KEY=' | Measure-Object` bila ragu).

- [ ] **Step 8: Verifikasi struktural**

Run: `docker compose config --quiet` (profil default) — Expected: PASS tanpa daemon.
Run: `docker compose --profile dev config --quiet && docker compose --profile test config --quiet && docker compose --profile prod config --quiet` — Expected: semua PASS.
Run: `Select-String -Path Dockerfile -Pattern 'COPY patches'` — Expected: 2 baris (builder + prod).

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml Dockerfile .dockerignore .gitignore package.json scripts
git add -u docker-compose.prod.yml docker-compose.test.yml .env.production.example
git commit -m "chore(deploy): single compose with dev/test/prod profiles; Dockerfile patch-package support; env consolidation"
```

---

### Task 3: Katalog model DB (schema, migrasi, seed data, loader, controls, wiring)

**Files:**
- Modify: `prisma/schema.prisma`, `prisma/seed.js`, `prisma.config.ts`, `package.json` (prisma→dependencies)
- Create: `prisma/ai-models.seed.js`, `prisma/migrations/20261013150000_add_ai_models/migration.sql`, `src/ai/models/catalog.ts`, `src/ai/models/controls.ts`, `src/ai/provider/client.ts` (rename), `src/ai/provider/completion-model.ts`, tests
- Delete: `src/ai/openrouter.ts` (diganti `provider/client.ts`)
- Modify: `src/ai/completion.ts`, `src/services/video-sticker-pack-agent.service.ts`, `src/services/openrouter.service.ts` (sementara: baca katalog role image utk model id; adapter masih chat sampai Task 4), `src/controllers/generate.controller.ts` (metadata model dari hasil service), `src/ai/video-sticker-pack-agent.ts` (masih lokasi lama; pindah Task 4? — TIDAK, tetap di sini agar diff kecil: pindahkan folder `agents/` di Task 4 saja)

**Interfaces:**
- Produces:
  - `loadAiModel(role: AiModelRole): Promise<AiModelRow>` (baris absen → `MissingAiModelError` dengan pesan `run prisma db seed`); `resetAiModelCache()` (test-only)
  - `getCompletionModelForRole(role): Promise<{ model: CompletionModel; reasoningEffort: string | null; temperature: number | null; maxTokens: number | null }>`
  - `requireAgentCredentials(): { apiKey: string; baseUrl: string }` (throw `ValidationError` bila `apiKey` kosong)
  - `AI_MODEL_SEED` (dari `prisma/ai-models.seed.js`)

- [ ] **Step 1: Schema + migrasi**

`prisma/schema.prisma` tambahkan:

```prisma
enum AiModelRole {
  agent
  vision
  improvement
  image
}

model AiModel {
  id                     String      @id @default(cuid())
  role                   AiModelRole @unique
  modelId                String
  reasoningEfforts       String[]    @default([])
  defaultReasoningEffort String?
  temperature            Float?
  maxTokens              Int?
  label                  String?
  createdAt              DateTime    @default(now())
  updatedAt              DateTime    @updatedAt
}
```

`prisma/migrations/20261013150000_add_ai_models/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "AiModelRole" AS ENUM ('agent', 'vision', 'improvement', 'image');

-- CreateTable
CREATE TABLE "AiModel" (
    "id" TEXT NOT NULL,
    "role" "AiModelRole" NOT NULL,
    "modelId" TEXT NOT NULL,
    "reasoningEfforts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "defaultReasoningEffort" TEXT,
    "temperature" DOUBLE PRECISION,
    "maxTokens" INTEGER,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModel_role_key" ON "AiModel"("role");
```

Validasi: `npx prisma validate` + `npx prisma generate` (regenerasi client agar tipe `AiModel` tersedia). Jika Docker engine tersedia, jalankan `npx prisma migrate deploy` terhadap DB dev lalu **hapus migrasi hand-written dan regenerate** via `npx prisma migrate dev --name add_ai_models` supaya checksum native.

- [ ] **Step 2: Tulis test yang gagal — seed data + catalog**

`tests/unit/prisma/ai-models-seed.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import aiModels from '../../../prisma/ai-models.seed.js';

const MUSE = 'meta/muse-spark-1.3-contributor';
const SEEDREAM = 'bytedance-seed/seedream-5-0-flash';

describe('AI model seed data', () => {
  it('registers exactly the approved catalog', () => {
    expect(aiModels.map((m: { role: string }) => m.role).sort()).toEqual([
      'agent',
      'image',
      'improvement',
      'vision',
    ]);
    for (const model of aiModels as Array<{ role: string; modelId: string }>) {
      expect([MUSE, SEEDREAM]).toContain(model.modelId);
    }
  });

  it('uses muse spark for every completion role with a valid default effort', () => {
    for (const model of aiModels as Array<{ role: string; modelId: string; reasoningEfforts: string[]; defaultReasoningEffort: string | null }>) {
      if (model.role === 'image') continue;
      expect(model.modelId).toBe(MUSE);
      expect(model.reasoningEfforts.length).toBeGreaterThan(0);
      expect(model.defaultReasoningEffort).not.toBeNull();
      expect(model.reasoningEfforts).toContain(model.defaultReasoningEffort as string);
    }
  });

  it('registers seedream only for the image role without reasoning efforts', () => {
    const image = (aiModels as Array<{ role: string; modelId: string; reasoningEfforts: string[] }>).find(
      (m) => m.role === 'image'
    );
    expect(image?.modelId).toBe(SEEDREAM);
    expect(image?.reasoningEfforts).toEqual([]);
  });
});
```

`tests/unit/ai/models/catalog.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAiModel, MissingAiModelError, resetAiModelCache } from '../../../src/ai/models/catalog';

const findUniqueMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/prisma/client', () => ({
  prisma: { aiModel: { findUnique: findUniqueMock } },
}));

describe('loadAiModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAiModelCache();
  });

  it('returns the row and caches it per process', async () => {
    findUniqueMock.mockResolvedValueOnce({
      role: 'agent',
      modelId: 'meta/muse-spark-1.3-contributor',
      reasoningEfforts: ['low'],
      defaultReasoningEffort: 'low',
      temperature: 0.2,
      maxTokens: 4000,
    });
    const first = await loadAiModel('agent');
    const second = await loadAiModel('agent');
    expect(first.modelId).toBe('meta/muse-spark-1.3-contributor');
    expect(second).toBe(first);
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
  });

  it('fails fast with a seed hint when the row is missing', async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    await expect(loadAiModel('vision')).rejects.toBeInstanceOf(MissingAiModelError);
    await expect(loadAiModel('vision')).rejects.toThrow(/prisma db seed/);
  });
});
```

Catatan: path `../../../src/prisma/client` — cek client Prisma yang ada di repo (`src/prisma/`); sesuaikan nama ekspor nyata (baca `src/prisma/` saat eksekusi; bila instance diekspor bernama lain, samakan mock).

- [ ] **Step 3: Jalankan — pastikan gagal, lalu implementasi**

`prisma/ai-models.seed.js`:

```js
/** Canonical AI model catalog. Kept in CJS so the production image (no tsx) can seed it. */
const AI_MODEL_SEED = [
  {
    role: 'agent',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'high',
    temperature: 0.2,
    maxTokens: 4000,
    label: 'Meta Muse Spark 1.3 (contributor)',
  },
  {
    role: 'vision',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'medium',
    temperature: null,
    maxTokens: null,
    label: 'Meta Muse Spark 1.3 (contributor)',
  },
  {
    role: 'improvement',
    modelId: 'meta/muse-spark-1.3-contributor',
    reasoningEfforts: ['low', 'medium', 'high', 'max'],
    defaultReasoningEffort: 'medium',
    temperature: null,
    maxTokens: null,
    label: 'Meta Muse Spark 1.3 (contributor)',
  },
  {
    role: 'image',
    modelId: 'bytedance-seed/seedream-5-0-flash',
    reasoningEfforts: [],
    defaultReasoningEffort: null,
    temperature: null,
    maxTokens: null,
    label: 'ByteDance Seedream 5.0 Flash',
  },
];

module.exports = { AI_MODEL_SEED };
```

`prisma/seed.js` — tambah setelah billing products:

```js
const { AI_MODEL_SEED } = require('./ai-models.seed');

// …di dalam main(), sebelum console.log penutup:
for (const model of AI_MODEL_SEED) {
  await prisma.aiModel.upsert({
    where: { role: model.role },
    update: model,
    create: model,
  });
}
await prisma.aiModel.deleteMany({
  where: { role: { notIn: AI_MODEL_SEED.map((model) => model.role) } },
});
console.log('AI model catalog seeded');
```

`package.json`: pindahkan `"prisma": "^7.8.0"` dari devDependencies → dependencies (dipakai `migrate deploy`/`db seed` di runtime container). `prisma.config.ts` seed tetap `node prisma/seed.js` ✓ (tidak berubah).

`src/ai/models/catalog.ts`:

```ts
import { prisma } from '../../prisma/client'; // sesuaikan dengan ekspor nyata di src/prisma/

export type AiModelRole = 'agent' | 'vision' | 'improvement' | 'image';

export interface AiModelRow {
  role: AiModelRole;
  modelId: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

export class MissingAiModelError extends Error {
  constructor(role: AiModelRole) {
    super(`AiModel row for role '${role}' is missing — run \`npx prisma db seed\` first.`);
    this.name = 'MissingAiModelError';
  }
}

type CachedRow = AiModelRow;

const cache = new Map<AiModelRole, CachedRow>();

export function resetAiModelCache(): void {
  cache.clear();
}

/** Reads the catalog row for one role; cached for the process lifetime (restart to apply changes). */
export async function loadAiModel(role: AiModelRole): Promise<AiModelRow> {
  const cached = cache.get(role);
  if (cached) {
    return cached;
  }
  const row = await prisma.aiModel.findUnique({ where: { role } });
  if (!row) {
    throw new MissingAiModelError(role);
  }
  const normalized: CachedRow = {
    role: row.role as AiModelRole,
    modelId: row.modelId,
    reasoningEfforts: row.reasoningEfforts,
    defaultReasoningEffort: row.defaultReasoningEffort,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
  };
  cache.set(role, normalized);
  return normalized;
}
```

`src/ai/models/controls.ts`:

```ts
import { defineCompletionModelControls } from '@anvia/core';
import type { CompletionModelControls } from '@anvia/core';
import type { AiModelRow } from './catalog';

/** Declares the reasoning-effort vocabulary so Anvia validates the value before the provider call. */
export function explicitControls(efforts: readonly string[]): { controls?: CompletionModelControls } {
  if (efforts.length === 0) {
    return {};
  }
  return {
    controls: defineCompletionModelControls({
      reasoningEffort: {
        type: 'select' as const,
        label: 'Reasoning effort',
        description: 'How much reasoning the model applies before answering.',
        options: [...efforts],
      },
    }),
  };
}

/** The effort value to pass per run; null when the model declares none or the default is invalid. */
export function resolveReasoningEffort(row: AiModelRow): string | null {
  if (!row.defaultReasoningEffort) {
    return null;
  }
  return row.reasoningEfforts.includes(row.defaultReasoningEffort)
    ? row.defaultReasoningEffort
    : null;
}
```

`src/ai/provider/client.ts` (rename dari `src/ai/openrouter.ts`; ubah nama ekspor & sumber kredensial):

```ts
import type { CompletionModel } from '@anvia/core';
import { config } from '../../config';
import { importEsm } from '../esm';

type AnviaOpenAIModule = typeof import('@anvia/openai');

let openaiModulePromise: Promise<AnviaOpenAIModule> | undefined;

function anviaOpenAI(): Promise<AnviaOpenAIModule> {
  openaiModulePromise ??= importEsm<AnviaOpenAIModule>('@anvia/openai');
  return openaiModulePromise;
}

let clientPromise: Promise<InstanceType<AnviaOpenAIModule['OpenAIClient']>> | undefined;

function getClient(): Promise<InstanceType<AnviaOpenAIModule['OpenAIClient']>> {
  clientPromise ??= anviaOpenAI().then(({ OpenAIClient }) => {
    const { apiKey, baseUrl } = requireAgentCredentials();
    return new OpenAIClient({
      apiKey,
      baseUrl,
      headers: {
        'HTTP-Referer': config.appUrl,
        'X-Title': config.legal.appName,
      },
    });
  });
  return clientPromise;
}

const modelCache = new Map<string, CompletionModel>();

/** Guard at the AI boundary: a missing gateway key is a configuration error, reported clearly. */
export function requireAgentCredentials(): { apiKey: string; baseUrl: string } {
  if (!config.agent.apiKey) {
    throw new ValidationError('AGENT_API_KEY is required for AI features');
  }
  return { apiKey: config.agent.apiKey, baseUrl: config.agent.baseUrl };
}

export async function getCompletionModel(
  modelId: string,
  options?: { controls?: CompletionModelControls }
): Promise<CompletionModel> {
  const cacheKey = `${modelId}::${options?.controls ? 'controls' : 'plain'}`;
  const cached = modelCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const client = await getClient();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- typescript-eslint v7 cannot evaluate the `const` type parameter; tsc validates (see migration ledger)
  const model: CompletionModel = client.completionModel({
    modelId,
    api: 'chat',
    ...(options?.controls ? { controls: options.controls } : {}),
  });
  modelCache.set(cacheKey, model);
  return model;
}
```

(Impor `ValidationError` dari `../../errors`.)

`src/ai/provider/completion-model.ts`:

```ts
import type { CompletionModel } from '@anvia/core';
import { loadAiModel, type AiModelRole } from '../models/catalog';
import { explicitControls, resolveReasoningEffort } from '../models/controls';
import { getCompletionModel } from './client';

export interface CompletionModelBinding {
  model: CompletionModel;
  reasoningEffort: string | null;
  temperature: number | null;
  maxTokens: number | null;
}

const bindings = new Map<AiModelRole, Promise<CompletionModelBinding>>();

export function getCompletionModelForRole(role: AiModelRole): Promise<CompletionModelBinding> {
  const existing = bindings.get(role);
  if (existing) {
    return existing;
  }
  const binding = (async () => {
    const row = await loadAiModel(role);
    const model = await getCompletionModel(row.modelId, explicitControls(row.reasoningEfforts));
    return {
      model,
      reasoningEffort: resolveReasoningEffort(row),
      temperature: row.temperature,
      maxTokens: row.maxTokens,
    };
  })();
  bindings.set(role, binding);
  return binding;
}
```

`tests/unit/ai/provider/completion-model.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompletionModelForRole } from '../../../src/ai/provider/completion-model';

const loadAiModelMock = vi.hoisted(() => vi.fn());
const getCompletionModelMock = vi.hoisted(() => vi.fn(async () => ({ provider: 'test' })));

vi.mock('../../../src/ai/models/catalog', () => ({ loadAiModel: loadAiModelMock }));
vi.mock('../../../src/ai/provider/client', () => ({ getCompletionModel: getCompletionModelMock }));

describe('getCompletionModelForRole', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds model, default effort and decoding settings from the catalog row', async () => {
    loadAiModelMock.mockResolvedValueOnce({
      role: 'agent',
      modelId: 'meta/muse-spark-1.3-contributor',
      reasoningEfforts: ['low', 'high'],
      defaultReasoningEffort: 'high',
      temperature: 0.2,
      maxTokens: 4000,
    });
    const binding = await getCompletionModelForRole('agent');
    expect(binding.reasoningEffort).toBe('high');
    expect(binding.temperature).toBe(0.2);
    expect(getCompletionModelMock).toHaveBeenCalledWith(
      'meta/muse-spark-1.3-contributor',
      expect.objectContaining({ controls: expect.anything() })
    );
  });
});
```

- [ ] **Step 4: Wiring konsumen (masih struktur lama)**

- `src/ai/completion.ts`: hapus impor getter lama; `generateStructuredCompletion` membaca binding per role:

```ts
const binding = await getCompletionModelForRole(input.role);
const result = await generateCompletion({
  model: binding.model,
  instructions: input.instructions,
  messages: [{ role: 'user', content: buildUserContent({ text: input.prompt, images: input.images }) }],
  outputSchema: input.outputSchema,
  ...(binding.temperature !== null ? { temperature: binding.temperature } : {}),
  ...(binding.maxTokens !== null ? { maxTokens: binding.maxTokens } : {}),
  ...(binding.reasoningEffort ? { controls: { reasoningEffort: binding.reasoningEffort } } : {}),
  abortSignal,
});
```

- `src/services/video-sticker-pack-agent.service.ts`: hapus cek `config.openRouterApiKey`; `createVideoStickerPackAgent(input)` tetap, tapi di dalam factory: `const binding = await getCompletionModelForRole('agent')` menggantikan `getAgentCompletionModel()`; `temperature/maxTokens` dari binding (bukan hardcoded 0.2/3500); pada `agent.generate(...)` tambah `...(binding.reasoningEffort ? { controls: { reasoningEffort: binding.reasoningEffort } } : {})`; metadata `model` di service dibaca dari `loadAiModel('agent').modelId` (panggil sekali per request).
- `src/services/openrouter.service.ts` (transisi Task 3): default param `model: string = config.models.imageGeneration` → ganti pemanggilan internal memakai `(await loadAiModel('image')).modelId`, hapus parameter `model` dari dua method; `buildImprovementPrompt`/`analyzeCellTextOutsideForeground`/`detectGridBoundaries` sudah role-based via helper (tidak berubah). Adapter chat masih `src/ai/openrouter-image.ts` (dipakai sampai Task 4).
- `src/controllers/generate.controller.ts`: ganti referensi `config.models.imageGeneration` / `config.models.improvementAgent` menjadi nilai dari hasil service (`imageResult` metadata / tambahkan field `model` di return service bila belum); penyesuaian detail dilakukan dengan mengiterasi error typecheck.
- Hapus jembatan Task 1: `config.openRouterApiKey` + blok `config.models` dihapus dari `src/config/index.ts`; perbaiki semua konsumen hingga `npm run typecheck` hijau (grep `config.models|openRouterApiKey` harus bersih).

- [ ] **Step 5: Migrasi + seed nyata (bila DB tersedia)**

Coba nyalakan Docker: `Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'` → tunggu engine → `docker compose --profile dev up -d postgres redis` → `npx prisma migrate deploy` → `npx prisma db seed` → jalankan `npx prisma db seed` **dua kali** (idempotensi) → `node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.aiModel.findMany().then(rows=>{console.log(rows.map(r=>r.role+':'+r.modelId).join(' | '));return p.$disconnect();})"` — Expected: 4 baris sesuai katalog, dua kali seed tidak error.

Jika engine tidak bisa dinyalakan: jalankan validasi statis (`npx prisma validate`, SQL review) dan catat sebagai deferred acceptance untuk dijalankan pengguna (perintahnya ditulis di laporan akhir).

- [ ] **Step 6: Live smoke (wajib; key tersedia)**

Recreate dua smoke script sementara (pola Task 5 plan migrasi; dihapus setelah lulus):
- Agent: `scripts/tmp-agent-smoke.ts` (grid 2×2 + 4 kandidat) — Expected: plan valid, `metadata.model === 'meta/muse-spark-1.3-contributor'`.
- Tiga analisis: `scripts/tmp-analyses-smoke.ts` — Expected: improvementPrompt non-kosong; cellText struktur valid; detection `{ gridLayout, boundaries }` ATAU `GridDetectionError` yang di-log (fallback lokal sudah dihapus di Task 5, saat ini masih ada — nilai valid apa pun diterima).

Jalankan dengan `npx tsx …`; catat hasil; hapus script.

- [ ] **Step 7: Verifikasi + commit**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit` → Expected: hijau (2 DB-gagal pre-existing dikecualikan).
Run: `Select-String -Path src -Pattern 'config\.models|openRouterApiKey|OPENROUTER' -Recurse` → Expected: kosong.

```bash
git add -A
git commit -m "feat(ai): DB-backed model catalog with seeder; muse-spark bindings via reasoning controls"
```

---

### Task 4: Images API adapter + pemecahan service (ImageGenerationService/VisionAnalysisService)

**Files:**
- Create: `src/ai/provider/images-api-model.ts`, `src/services/image-generation.service.ts`, `src/services/vision-analysis.service.ts`, `src/ai/agents/video-sticker-pack/{agent,prompts,tools}.ts`, tests
- Modify: `src/controllers/{generate,grid}.controller.ts`, `src/services/grid-split.service.ts`, `src/utils/improvement.ts` (cap), `tests/unit/utils/improvement.test.ts`, `tests/unit/services/grid-split.service.test.ts`, `tests/setup.ts` (jika perlu)
- Delete: `src/ai/openrouter-image.ts`, `src/ai/video-sticker-pack-agent.ts` (dipindah), `src/services/openrouter.service.ts`, `tests/unit/ai/openrouter-image.test.ts`, `tests/unit/services/openrouter.service.test.ts`, dependency `openai` dari `package.json`

**Interfaces:**
- Produces: `getImagesApiModel(modelId): ImageGenerationModel`; `buildReferenceImagesProviderOptions(images)` (pindah); `ImageGenerationService` (`generateImage`, `generateImageWithInputs`, `normalizeGridImage` — tanpa param model/fallback; hasil `{ imageBuffer, metadata }`); `VisionAnalysisService` (3 method + validasi grid); `IMAGE_API_MAX_INPUT_REFERENCES = 14`.

- [ ] **Step 1: `src/ai/provider/images-api-model.ts`**

```ts
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  JsonObject,
  ModelCallOptions,
} from '@anvia/core';
import { AIGenerationError } from '../../errors';
import { toAiError } from '../errors';
import { requireAgentCredentials } from './client';

export interface ReferenceImageInput {
  base64: string;
  mimeType: string;
}

const REFERENCE_IMAGES_KEY = 'referenceImages';

export const IMAGE_API_SUPPORTED_ASPECT_RATIOS = [
  '1:1','1:2','2:1','2:3','3:2','3:4','4:3','4:5','5:4',
  '9:16','16:9','9:19.5','19.5:9','9:20','20:9','9:21','21:9','auto',
] as const;

export function buildReferenceImagesProviderOptions(
  images: ReadonlyArray<ReferenceImageInput>
): JsonObject | undefined {
  if (images.length === 0) {
    return undefined;
  }
  return {
    [REFERENCE_IMAGES_KEY]: images.map((image) => ({ base64: image.base64, mimeType: image.mimeType })),
  };
}

function readReferenceImages(providerOptions: JsonObject | undefined): ReferenceImageInput[] {
  const raw = providerOptions?.[REFERENCE_IMAGES_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const images: ReferenceImageInput[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.base64 === 'string' && typeof record.mimeType === 'string') {
      images.push({ base64: record.base64, mimeType: record.mimeType });
    }
  }
  return images;
}

export function aspectRatioFor(width: number, height: number): string {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height) || 1;
  const candidate = `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
  return (IMAGE_API_SUPPORTED_ASPECT_RATIOS as readonly string[]).includes(candidate)
    ? candidate
    : 'auto';
}

const modelCache = new Map<string, ImageGenerationModel<unknown>>();

/** Anvia ImageGenerationModel for the OpenRouter Images API (`POST /images`). */
export function getImagesApiModel(modelId: string): ImageGenerationModel<unknown> {
  const cached = modelCache.get(modelId);
  if (cached !== undefined) {
    return cached;
  }

  const model: ImageGenerationModel<unknown> = {
    provider: 'openrouter-images',
    modelId,
    async imageGeneration(
      request: ImageGenerationRequest,
      options?: ModelCallOptions
    ): Promise<ImageGenerationResult<unknown>> {
      const { apiKey, baseUrl } = requireAgentCredentials();
      const referenceImages = readReferenceImages(request.providerOptions);
      const body: Record<string, unknown> = {
        model: modelId,
        prompt: request.prompt,
        n: 1,
        aspect_ratio: aspectRatioFor(request.width, request.height),
      };
      if (referenceImages.length > 0) {
        body.input_references = referenceImages.map((image) => ({
          type: 'image_url',
          image_url: {
            url: `data:${/^image\/[a-z0-9.+-]+$/i.test(image.mimeType) ? image.mimeType : 'image/png'};base64,${image.base64}`,
          },
        }));
      }

      try {
        const response = await fetch(`${baseUrl}/images`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: options?.abortSignal,
        });
        const payload = (await response.json()) as {
          data?: Array<{ b64_json?: string; media_type?: string }>;
          error?: { message?: string };
        };
        if (!response.ok) {
          throw new AIGenerationError(payload.error?.message ?? `Images API failed with ${response.status}`);
        }
        const first = payload.data?.[0];
        if (!first?.b64_json) {
          throw new AIGenerationError('Images API returned no image data');
        }
        const image: GeneratedImage = {
          data: Buffer.from(first.b64_json, 'base64'),
          mediaType: first.media_type ?? 'image/png',
        };
        return { images: [image], rawResponse: payload };
      } catch (error) {
        throw toAiError(error, { abortSignal: options?.abortSignal });
      }
    },
  };

  modelCache.set(modelId, model);
  return model;
}
```

- [ ] **Step 2: Test adapter (tulis dulu, lihat gagal) — `tests/unit/ai/provider/images-api-model.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aspectRatioFor, buildReferenceImagesProviderOptions, getImagesApiModel } from '../../../src/ai/provider/images-api-model';

const fetchMock = vi.hoisted(() => vi.fn());

describe('images-api-model', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.clearAllMocks();
    // credentials guard membaca config yang sudah di-seed tests/setup
  });
  afterEach(() => vi.unstubAllGlobals());

  it('maps aspect ratio with gcd and falls back to auto for unsupported ratios', () => {
    expect(aspectRatioFor(1024, 1024)).toBe('1:1');
    expect(aspectRatioFor(512, 1024)).toBe('1:2');
    expect(aspectRatioFor(100, 33)).toBe('auto');
  });

  it('posts model, prompt, aspect ratio and reference images to /images', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('img').toString('base64'), media_type: 'image/jpeg' }], usage: { cost: 0.018 } }), { status: 200 })
    );
    const model = getImagesApiModel('bytedance-seed/seedream-5-0-flash');
    const result = await model.imageGeneration({
      prompt: 'sticker',
      width: 1024,
      height: 1024,
      providerOptions: buildReferenceImagesProviderOptions([{ base64: 'abc', mimeType: 'image/png' }]),
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://openrouter.example/api/v1/images');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('bytedance-seed/seedream-5-0-flash');
    expect(body.prompt).toBe('sticker');
    expect(body.aspect_ratio).toBe('1:1');
    expect(body.input_references[0].image_url.url).toBe('data:image/png;base64,abc');
    expect(Buffer.from(result.images[0].data).toString()).toBe('img');
    expect(result.images[0].mediaType).toBe('image/jpeg');
  });

  it('throws AIGenerationError when response carries no image data', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const model = getImagesApiModel('x/y');
    await expect(model.imageGeneration({ prompt: 'p', width: 1, height: 1 })).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
    });
  });
});
```

Jalankan RED → implementasi Step 1 → GREEN.

- [ ] **Step 3: `src/services/image-generation.service.ts`**

```ts
import sharp from 'sharp';
import type { ImageGenerationResult } from '@anvia/core';
import { AIGenerationError, ProviderError, TimeoutError } from '../errors';
import { anviaCore } from '../ai/core';
import { loadAiModel } from '../ai/models/catalog';
import { getImagesApiModel, buildReferenceImagesProviderOptions } from '../ai/provider/images-api-model';

export interface ImageGenerationInput {
  buffer: Buffer;
  mimeType: string;
}

export interface GenerationResult {
  imageBuffer: Buffer;
  metadata: {
    model: string;
    tokensPrompt?: number;
    tokensCompletion?: number;
    cost?: number;
    latencyMs?: number;
  };
}

export class ImageGenerationService {
  private readonly defaultTimeout: number;

  constructor(timeoutMs: number = 60000) {
    this.defaultTimeout = timeoutMs;
  }

  async generateImage(
    prompt: string,
    base64Image?: string,
    imageMimeType: string = 'image/png'
  ): Promise<GenerationResult> {
    const images = base64Image ? [{ base64: base64Image, mimeType: imageMimeType }] : [];
    return this.generateImageWithInputs(prompt, images);
  }

  async generateImageWithInputs(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }> = []
  ): Promise<GenerationResult> {
    const startedAt = Date.now();
    const row = await loadAiModel('image');
    const { generateImage } = await anviaCore();

    try {
      const result = await generateImage({
        model: getImagesApiModel(row.modelId),
        prompt,
        width: 1024,
        height: 1024,
        ...(images.length > 0 ? { providerOptions: buildReferenceImagesProviderOptions(images) } : {}),
        abortSignal: AbortSignal.timeout(this.defaultTimeout),
      });
      return this.toGenerationResult(row.modelId, result, startedAt);
    } catch (error) {
      if (error instanceof TimeoutError || error instanceof AIGenerationError) throw error;
      if (error instanceof ProviderError) throw error;
      throw new AIGenerationError(error instanceof Error ? error.message : 'Image generation failed');
    }
  }

  async normalizeGridImage(
    imageBase64: string,
    gridLayout: string,
    targetWidth: number,
    targetHeight: number
  ): Promise<Buffer> {
    const prompt = `You are normalizing a sticker grid image for precise automated splitting.
… (prompt lama VERBATIM; salin dari openrouter.service.ts sebelum dihapus) …`;
    const { imageBuffer } = await this.generateImage(prompt, imageBase64);
    return sharp(imageBuffer).resize(targetWidth, targetHeight, { fit: 'fill' }).png().toBuffer();
  }

  private toGenerationResult(
    model: string,
    result: ImageGenerationResult<unknown>,
    startedAt: number
  ): GenerationResult {
    const response = result.rawResponse as {
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    return {
      imageBuffer: Buffer.from(result.images[0].data),
      metadata: {
        model,
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: response.usage?.cost,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
}
```

(`logger`/`isProviderError` tidak diimpor karena tidak dipakai — jaga impor tetap mati-bebas saat menyalin.)

- [ ] **Step 4: `src/services/vision-analysis.service.ts`**

Pindahkan dari `openrouter.service.ts` apa adanya: konstanta prompt (3 blok + 2 prompt cell-text), `buildImprovementPrompt`, `analyzeCellTextOutsideForeground` + `reconcileCellTextAnalysis`, `detectGridBoundaries` **AI-only** (hapus blok `catch { … autoDetectGrid … }`; biarkan error naik sebagai `GridDetectionError`):

```ts
} catch (aiError) {
  logger.warn({ error: aiError }, 'AI grid detection failed');
  throw new GridDetectionError(aiError instanceof Error ? aiError.message : 'Grid detection failed');
}
```

`validateBoundaries` + `validateGridCoverage` tetap; method tidak lagi menerima `forceRows/forceCols`? — TETAP menerima (jalur user-specified rows/cols memakai `generateGridBoundaries` langsung; salin method itu juga). Tipe `CellTextAnalysisResult`/`OutsideForegroundTextDetection` diimpor dari `utils/text-asset-decoration` (tanpa re-export perantara).

- [ ] **Step 5: Update konsumen + pindahkan agent folder + hapus lama**

- `generate.controller.ts`: `new ImageGenerationService()` / `new VisionAnalysisService()`; buang argumen `config.models.*` & `false` pada pemanggilan; metadata `model`/`improvementAgentModel` dibaca dari hasil service (service sudah mengisi `metadata.model`; `buildImprovementPrompt` tambahkan `metadata.model` di VisionAnalysisService).
- `grid.controller.ts`: wirе `VisionAnalysisService` ke `GridSplitService`.
- `grid-split.service.ts`: impor tipe dari `utils/text-asset-decoration`; panggilan detection menjadi AI-only (hapus `imageService.detectGridBoundaries` dari rantai, hapus import terkait).
- `src/ai/agents/video-sticker-pack/{tools,prompts,agent}.ts`: pindahkan dari `src/ai/video-sticker-pack-agent.ts` (tools.ts = 4 createTool; prompts.ts = system prompt + user message; agent.ts = factory dengan binding katalog seperti Task 3). Service mengimpor dari lokasi baru (path modul di test service juga diperbarui).
- `src/utils/improvement.ts`: `IMPROVEMENT_GRID_MAX_CELLS = 14` + komentar `// Seedream accepts at most 14 input references per request`. Update `tests/unit/utils/improvement.test.ts` expectations: 15→[14,1], 17→[14,3], 32→[14,14,4].
- Hapus: `src/ai/openrouter-image.ts`, `src/services/openrouter.service.ts`, dan dependency `openai` dari `package.json` (verifikasi `grep -r "from 'openai'" src` kosong). Rewrite test: `tests/unit/services/image-generation.service.test.ts` (mock `src/ai/models/catalog` → row image; mock `src/ai/provider/images-api-model` → adapter palsu; mock `src/ai/core` anviaCore→generateImage; kasus: sukses + metadata cost/token; error non-taksonomi → AIGenerationError; TIDAK ada retry text-only lagi — buktikan adapter dipanggil sekali). Hapus `tests/unit/ai/openrouter-image.test.ts` + `tests/unit/services/openrouter.service.test.ts`.

- [ ] **Step 6: Verifikasi + live image smokes**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit` → Expected hijau.
Smoke: `scripts/tmp-image-smoke.ts` (plain + with input reference; assert bytes > 1000, `metadata.model === 'bytedance-seed/seedream-5-0-flash'`, cost ≈ 0.018) → hapus script.
Cek: `docker compose --profile dev config --quiet` tetap lolos.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ai): images-api adapter for seedream; split image/vision services; drop raw openai sdk"
```

---

### Task 5: Penghapusan fallback & legacy (6 kategori)

**Files:**
- Modify: `src/services/{image,background-removal,animated-gif-background-removal,grid-split}.service.ts`, `src/middleware/error-handler.ts`, `src/errors/index.ts`, `src/config/index.ts`, `src/controllers/background.controller.ts`, tests terkait
- Delete: `src/services/imgly-background-removal-toggle.ts`, method `imageService.removeBackground`/`removeNeutralBrightBackground`/`detectGridBoundaries`/`detectContentIntervals`

- [ ] **Step 1: `autoDetectGrid` + detection lokal (sudah sebagian dari Task 4) — selesaikan sisa**

`grep -rn "autoDetectGrid\|detectContentIntervals" src` → Expected kosong. Pastikan `image.service.ts` sudah tanpa dua method tersebut dan `grid-split.service.ts` tanpa rantai `??`.

- [ ] **Step 2: Background removal tanpa fallback**

`src/services/background-removal.service.ts`:

```ts
import logger from '../utils/logger';
import { BackgroundRemovalError } from '../errors';
import { getSegmentationBackgroundRemovalService } from './segmentation-background-removal.service';

export interface BackgroundRemovalResult {
  processedBuffer: Buffer;
  method: string;
}

/** IMG.LY segmentation only — failures surface instead of degrading to a crude local threshold. */
export async function removeBackground(imageBuffer: Buffer): Promise<BackgroundRemovalResult> {
  try {
    const processedBuffer = await getSegmentationBackgroundRemovalService().remove(imageBuffer);
    return { processedBuffer, method: 'imgly-onnx' };
  } catch (error) {
    logger.error({ error }, 'IMG.LY background removal failed');
    throw new BackgroundRemovalError(
      error instanceof Error ? `Background removal failed: ${error.message}` : 'Background removal failed'
    );
  }
}
```

Update pemanggil: `background.controller.ts`, `grid-split.service.ts` (ganti nama impor). **Hapus** `src/services/imgly-background-removal-toggle.ts`; di `animated-gif-background-removal.service.ts` hapus `else`-branch neutral + blok `catch` fallback → attempt imgly; pada error, `throw new BackgroundRemovalError('Animated GIF background removal failed: …')`. Di `image.service.ts` hapus `removeBackground` + `removeNeutralBrightBackground` (+ helper privat yang hanya dipakai keduanya); `tests/unit/services/image.service.test.ts` hapus describe `removeBackground`. Di `src/config/index.ts` hapus key `imglyBackgroundRemoval.enabled` + env `IMGLY_BG_ENABLED`; cek konsumen `shouldUseImglyBackgroundRemoval` (grep) → semua dihapus.

- [ ] **Step 3: Legacy config & error**

- `src/config/index.ts`: hapus blok `aiDailyLimits` (+ komentar @deprecated). Grep `aiDailyLimits` → kosong.
- `src/errors/index.ts`: hapus class `UseGoogleSignInError`. Grep → kosong.
- `src/middleware/error-handler.ts`: hapus blok "Fallback untuk error lama yang masih pakai string prefix" (5 cabang `startsWith`), sisakan `AppError`, multer, dan 500 generik.
- Test: tambah `tests/unit/middleware/error-handler.test.ts` (baru; pakai express + supertest pattern yang ada di repo): error `AppError` → status/kode sesuai; error biasa → 500 `INTERNAL_ERROR`; error dengan pesan ber-prefix `VALIDATION_ERROR` **tidak lagi** dipetakan khusus (tetap 500) — ini menegaskan fallback benar-benar hilang.

- [ ] **Step 4: Verifikasi suite + live grid**

Run: `npm run typecheck && npm run lint && npx vitest run tests/unit` → hijau (perbaiki test yang terdampak: grid-split stub, image.service, animated-gif bila ada).
Live: `scripts/tmp-grid-smoke.ts` — grid 2×2 nyata: Expected salah satu dari (a) `{ gridLayout: '2x2', boundaries }` valid, atau (b) `GridDetectionError` ter-log/terlempar (tanpa fallback). Catat hasil, hapus script.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(ai): remove deterministic fallbacks and legacy compatibility paths"
```

---

### Task 6: Docs, sapuan akhir, verifikasi menyeluruh

**Files:**
- Create: `docs/ARCHITECTURE.md`
- Modify: `README.md`, `docs/play-console/data-safety-mapping.md`

- [ ] **Step 1: `docs/ARCHITECTURE.md`**

Konten minimum: diagram lapisan (routes → controllers → services → `src/ai` → gateway); daftar service domain + tanggung jawab; **katalog model DB** (skema, cara ganti model/effort: update DB/seed → restart, kenapa DB bukan env); alur AI (agent run, parsed completions, Images API + cap 14 referensi); tracing Langfuse (+ patch `@anvia/langfuse` & alasannya); catatan provider boundary (`AGENT_BASE_URL` kompatibel-OpenAI; Images API mengikuti ekosistem OpenRouter); perintah docker profile.

- [ ] **Step 2: README**

- Ganti bagian env AI & model: `AGENT_API_KEY`/`AGENT_BASE_URL`; tabel model merujuk katalog DB; hapus referensi `OPENROUTER_API_KEY`/`*_MODEL`.
- Getting started: `cp .env.example .env`; perintah `docker compose --profile dev|test|prod`; `npm run test:up && npm run test:migrate && npm test` (catatan PowerShell: `npx vitest run tests/unit`).
- Update `docs/play-console/data-safety-mapping.md` baris provider (`OpenRouter / model APIs` → `AI gateway (AGENT_BASE_URL)`).

- [ ] **Step 3: Sapuan akhir (grep audit — semua harus kosong/kecuali yang diizinkan)**

```powershell
Select-String -Path src,tests,prisma,scripts -Pattern 'OPENROUTER|openRouter|config\.models|autoDetectGrid|allowTextOnlyFallback|fallback|@deprecated' -Recurse
```

Expected: kata `fallback` hanya bila ada komentar penjelas historis yang disengaja (tidak ada), `@deprecated` kosong, sisanya kosong. `grep -r "openai" package.json` → hanya `@anvia/openai` (dependency SDK mentah `openai` hilang).

- [ ] **Step 4: Verifikasi penuh**

Run: `npm run typecheck && npm run lint && npm run build` → PASS.
Run: `npx vitest run tests/unit` → hijau (2 pre-existing dikecualikan; bila Docker hidup: `npm run test:up && npm run test:migrate && npm test` penuh).
Live smokes terakhir (semua, sekali jalan): agent muse; 3 analisis; image plain + reference; trace Langfuse masih masuk (query `/api/public/v2/observations`).

- [ ] **Step 5: Commit + push**

```bash
git add -A
git commit -m "docs: architecture guide, refreshed README, env rename sweep"
git push
```

---

## Catatan Eksekusi

- Probe/smoke script adalah **temporary**: hapus di task yang sama; `git status --short` bersih sebelum commit.
- Bila Docker Desktop bisa dinyalakan, utamakan jalur nyata (migrate/seed/integration) alih-alih hand-written SQL; bila tidak, tandai deferred acceptance berisi perintah yang harus dijalankan pengguna.
- Semua deviasi dari plan dicatat sebagai ruling di ledger (format `Ruling: <what> — <why> — <cost if wrong>`), lalu lanjut.
- Emoji/judul file di plan ini bilingual by design (kode & pesan berbahasa Inggris, narasi pengguna berbahasa Indonesia).
