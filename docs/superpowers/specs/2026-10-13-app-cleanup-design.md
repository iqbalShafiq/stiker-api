# App Cleanup + Model Catalog (DB) + Images API — Design Specification

> **Date:** 2026-10-13
> **Status:** Approved (design)
> **Author:** AI Assistant
> **Scope:** Backend `stiker-api` — konfigurasi/deployment, katalog model AI (DB seeder), adapter image baru, struktur kode, penghapusan fallback/legacy.
> **Prasyarat:** migrasi Anvia (spec `2026-10-13-anvia-agent-migration-design.md`) sudah selesai & terverifikasi live.

## Overview

Merapikan backend `stiker-api` menjadi repo kelas portfolio: satu `.env.example` + satu `docker-compose.yml` ber-profile, env AI generik
(`AGENT_API_KEY`/`AGENT_BASE_URL`), katalog model AI pindah ke DB dengan **seeder** (termasuk reasoning effort), switching model ke
`meta/muse-spark-1.3-contributor` (semua peran kecuali image) dan `bytedance-seed/seedream-5-0-flash` (image, via **OpenRouter Images API**),
pemecahan service besar, serta penghapusan seluruh fallback deterministik praktis dan backward-compat usang.

## Goals

1. **Satu sumber konfigurasi**: `.env.example` (semua var, komentar produksi) + `docker-compose.yml` ber-profile `dev`/`test`/`prod`; hapus
   `.env.production.example`, `docker-compose.prod.yml`, `docker-compose.test.yml`.
2. **Env AI generik**: `AGENT_API_KEY` + `AGENT_BASE_URL` (default OpenRouter, bisa ganti gateway OpenAI-compatible). Semua env model
   (`OPENROUTER_API_KEY`, `AGENT_MODEL`, `VIDEO_STICKER_PACK_AGENT_MODEL`, `IMPROVEMENT_AGENT_MODEL`, `IMAGE_GENERATION_MODEL`) **dihapus**.
3. **Katalog model DB-backed**: tabel `AiModel` per peran (`agent`, `vision`, `improvement`, `image`) + seeder idempotent; runtime membaca DB
   dengan cache per-proses; baris hilang = gagal cepat; model lain otomatis terhapus oleh seeder.
4. **Model baru** (terverifikasi live): `meta/muse-spark-1.3-contributor` untuk agent + 3 analisis vision (vision ✓, tools ✓, strict structured ✓,
   `reasoning_effort` ✓); `bytedance-seed/seedream-5-0-flash` untuk image generation/editing via **Images API** (`input_references` ≤ 14).
5. **Struktur kode rapi**: `src/ai/` ber-subfolder (models/provider/agents), `openrouter.service.ts` dipecah menjadi
   `ImageGenerationService` + `VisionAnalysisService` (nama provider-agnostic), `docs/ARCHITECTURE.md`.
6. **Tanpa fallback deterministik praktis & backward-compat usang** (6 kategori, lihat §6).
7. **Config fail-fast**: rahasia tanpa default (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`).
8. **`.gitignore` sesuai konvensi** (menutup celah `.env.production`, hilangkan pola `*.png` dkk yang agresif).

## Non-Goals

1. Reorg feature-modules penuh (keputusan: rapi terarah, bukan pindah 200 file).
2. Mengubah kontrak HTTP endpoint atau bentuk respons API.
3. Admin UI untuk katalog model (perubahan model = update DB + restart; didokumentasikan).
4. Perubahan skema produk lain (billing, auth, sosial) di luar yang disebut §6.
5. Upgrade Node/ESM/TypeScript (tetap; catatan follow-up dari spec sebelumnya berlaku).

## Current State (ringkas)

- `.env.example` lengkap tapi `.env.production.example` **usang** (ketinggalan var billing/google/apple); 3 file compose (dev, prod lengkap
  dengan nginx+migrate+seed, test) + 3 script shell yang mereferensi `.env.production`/`docker-compose.prod.yml`.
- Env model AI: `OPENROUTER_API_KEY`, `AGENT_MODEL`, `VIDEO_STICKER_PACK_AGENT_MODEL`, `IMPROVEMENT_AGENT_MODEL`, `IMAGE_GENERATION_MODEL`
  (di `src/config/index.ts` sebagai `config.models.*` + `config.openRouterApiKey`).
- `src/services/openrouter.service.ts` (≈590 baris) memuat: image generation via adapter chat-image (OpenRouter `message.images[]` + cast
  `modalities`), 3 analisis vision, detector grid (AI + fallback `autoDetectGrid`), dan tipe analisis yang di-re-export.
- `src/services/image.service.ts` punya `detectGridBoundaries` deterministik (proyeksi grayscale) yang dipakai **sebelum** AI di
  `grid-split.service`.
- Fallback/legacy teridentifikasi: `autoDetectGrid`, deteksi lokal pra-AI, `allowTextOnlyFallback`, `removeBackgroundWithFallback`
  (brightness-threshold + `neutral-bright-fallback-animated-gif`), `config.aiDailyLimits` (@deprecated, env `AI_DAILY_*`),
  `UseGoogleSignInError` (@deprecated), cabang fallback string-prefix di `middleware/error-handler.ts`.
- Dependency `openai` (SDK mentah) hanya dipakai adapter chat-image → tidak lagi dibutuhkan setelah rewrite Images API.

## Findings — Riset Model (verified live dengan key pengguna)

| | `meta/muse-spark-1.3-contributor` | `bytedance-seed/seedream-5-0-flash` |
|---|---|---|
| Endpoint | Chat Completions (katalog `/models`) | **Images API** `POST /api/v1/images` (katalog `/images/models`) |
| Input | text, image, video, file | text + hingga **14** `input_references` (data URL/https) |
| Output | text | gambar (`data[0].b64_json`, `media_type` image/jpeg) |
| Context | 1.048.576 | — |
| Params | tools, tool_choice, response_format, structured_outputs, reasoning, reasoning_effort, temperature | resolution 1K/2K, aspect_ratio (19 nilai), n=1, seed |
| Terverifikasi | teks ✓, vision ("Red") ✓, strict structured ✓, `reasoning_effort` low/medium/high/max diterima + reasoning token nyata ✓, **full agent run** (tools+schema+vision, 35 dtk, ≈$0.003) ✓ | text-to-image ✓ ($0.018, 148KB JPEG), dengan `input_references` ✓ (297KB) |
| Harga | $0.10/M in, $0.20/M out | $0.018/gambar |

Implikasi: (a) adapter image **wajib** pindah ke Images API — parsing trivial, cast `modalities` dan dependency `openai` hilang;
(b) cap `input_references` 14 → `IMPROVEMENT_GRID_MAX_CELLS` 16→14; (c) satu model (muse) melayani agent + seluruh analisis vision.

## Keputusan (konfirmasi pengguna)

1. **Env & docker**: satu `.env.example`; satu `docker-compose.yml` dengan profiles `dev`/`test`/`prod`; hapus 2 compose lain + `.env.production.example`.
2. **Penamaan**: `AGENT_API_KEY`, `AGENT_BASE_URL` (default `https://openrouter.ai/api/v1`); model per peran pindah ke DB (env `MODEL_*` batal).
3. **Registry**: **DB-backed + Prisma seeder** (bukan katalog kode).
4. **Hapus semua 6 kategori** fallback/legacy: autoDetectGrid; deteksi grid lokal pra-AI; fallback text-only image gen; fallback background
   removal lokal (incl. GIF neutral-bright); backward-compat usang (env/class/error legacy); default rahasia config → fail-fast.
5. **Struktur**: rapi terarah + pecah service besar (tanpa reorg feature-modules).
6. **Sub-keputusan disetujui**: grid-split mempertahankan toleransi per-sel (bg removal gagal per-sel → sel dilewati, batch lanjut — toleransi
   batch, bukan substitusi deterministik); `AGENT_API_KEY` tidak fail-fast boot, tapi ada guard dengan pesan jelas di boundary AI.

## Architecture Decisions

- **Katalog model = data DB** (`AiModel`, satu baris per peran), bukan env/kode. Seeder sebagai source of truth nilai awal; runtime hanya membaca.
- **Bentuk pipeline ditentukan peran**, bukan kolom konfigurasi: `image` → Images API; `agent|vision|improvement` → Chat Completions.
- **Reasoning effort** diterapkan via `defineCompletionModelControls` (`explicitControls`) + nilai default per-run dari baris DB; adapter chat
  memetakan ke param `reasoning_effort` (terbukti didukung Muse Spark).
- **Provider boundary tetap** di `src/ai/provider/` (satu-satunya tempat akses gateway/SDK), service domain provider-agnostic.
- **Fail-fast > fallback**: setiap jalur AI gagal dengan error taksonomi yang jelas (422/502/504), bukan hasil substitusi.

## Detailed Design

### 1) Konfigurasi & Deployment

**`.env.example` (baru, satu file).** Bagian: App → **AI gateway** (`AGENT_API_KEY`, `AGENT_BASE_URL`) → Database → Redis → Auth →
Email/Resend → Storage/Uploads → Background removal & GIF → Langfuse → Billing (Play/Apple/Xendit) → Legal/Quota. Setiap var yang dibaca
`config` ada di example; komentar produksi inline (mis. generate JWT via `openssl rand -base64 48`). Hapus var *MODEL* & `OPENROUTER_*`.

**`docker-compose.yml` (baru, profiles).**

| Service | Profile | Catatan |
|---|---|---|
| `postgres`, `redis` | dev, prod | volume + healthcheck seperti sekarang |
| `api` | dev | build Dockerfile, port `${PORT:-3000}`, env_file `.env` |
| `app` | prod | image GHCR, restart unless-stopped, port 127.0.0.1:3000, limits cpus/mem |
| `migrate`, `seed` | prod | `prisma migrate deploy` / `prisma db seed`, restart "no" |
| `nginx` | prod | config + certbot dirs seperti sekarang |
| `postgres-test`, `redis-test` | test | port 5433/6380 |

Perintah: `docker compose --profile dev up -d`, `--profile test`, `--profile prod up -d`. npm script `test:up`/`test:down` menyesuaikan;
`scripts/setup-production.sh` & `init-ssl.sh` mengacu satu compose + `.env`. Nama network diseragamkan (`stiker-network`).

**Fail-fast config (`src/config/index.ts`).** Helper `requiredEnv(name)` untuk `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` — gagal
boot dengan menyebut var mana yang kosong. Nilai default non-rahasia (PORT, dsb.) tetap. Blok `models` + `openRouterApiKey` diganti
`agent: { apiKey, baseUrl }`.

**`.gitignore` + `.dockerignore`.** Root: `.env*` + `!.env.example`; hapus blok `*.png/jpg/jpeg/webp/gif`; tambah `logs/`, `backups/`,
`certbot/`, `.superpowers/`; pertahankan node_modules/dist/coverage/uploads(.gitkeep)/.cache/tsbuildinfo. Audit `.dockerignore` agar
tidak mengecualikan file yang dibutuhkan build (prisma, patches/).

**Migrasi `.env` lokal developer** (langkah implementasi, bukan file repo): pindahkan nilai `OPENROUTER_API_KEY` → `AGENT_API_KEY`, tambah
`AGENT_BASE_URL`, hapus 5 var model — dilakukan via script tanpa mencetak isi rahasia.

### 2) Katalog Model (DB)

```prisma
enum AiModelRole { agent  vision  improvement  image }

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

**Seeder** (`prisma/seed.js` → `prisma/seed.ts`, `tsx`; billing seed lama tetap pindah ke file yang sama):

| role | modelId | reasoningEfforts | default | temperature | maxTokens |
|---|---|---|---|---|---|
| agent | meta/muse-spark-1.3-contributor | low, medium, high, max | high | 0.2 | 4000 |
| vision | meta/muse-spark-1.3-contributor | low, medium, high, max | medium | — | — |
| improvement | meta/muse-spark-1.3-contributor | low, medium, high, max | medium | — | — |
| image | bytedance-seed/seedream-5-0-flash | [] | — | — | — |

Upsert by `role` + `deleteMany({ where: { role: { notIn: ROLES } } })`. `prisma.config.ts`/`package.json` seed command menunjuk `tsx prisma/seed.ts`.

**Runtime**: `src/ai/models/catalog.ts` → `loadAiModel(role)` (cache per-proses; baris absen → error "run prisma db seed");
`src/ai/models/controls.ts` → `explicitControls(reasoningEfforts)` + `resolveEffort(row)`. `src/ai/provider/completion-model.ts` →
`getCompletionModelForRole(role)` mengembalikan `{ model, reasoningEffort?, temperature?, maxTokens? }`; pemanggil meneruskan effort via
`controls` per-run dan temperature/maxTokens ke Agent/`generateCompletion`.

### 3) Provider Layer

- `provider/client.ts` (dari `openrouter.ts`): `OpenAIClient` Anvia dengan `AGENT_BASE_URL`/`AGENT_API_KEY` + headers
  `HTTP-Referer: config.appUrl`, `X-Title: config.legal.appName`; cache model per `modelId`.
- `provider/images-api-model.ts` (BARU, menggantikan `openrouter-image.ts`): implementasi `ImageGenerationModel` via `POST {baseUrl}/images`:
  - Body: `{ model, prompt, aspect_ratio, input_references?, n: 1 }`; `aspect_ratio` dipetakan dari width/height (gcd → tabel 19 nilai; di luar
    tabel → `'auto'`); `input_references` dari `providerOptions.referenceImages` sebagai data URL.
  - Parse `data[0]` (`b64_json`, `media_type`); `rawResponse` = body penuh (untuk `usage.cost`/token metadata).
  - Error via `toAiError` (timeout abort → `TimeoutError`; 4xx/5xx gateway → `ProviderError`/`AIGenerationError`).
  - **Dihapus**: parsing `message.images[]`, cast `modalities`, SDK `openai` (dependency dihapus dari `package.json`).
- Guard `requireAgentCredentials()` dipakai boundary AI (pesan jelas bila `AGENT_API_KEY` kosong).

### 4) Struktur & Service

```
src/ai/{esm,core,errors,tracing,content,completion}.ts
src/ai/models/{catalog,controls}.ts
src/ai/provider/{client,completion-model,images-api-model}.ts
src/ai/agents/video-sticker-pack/{agent,prompts,tools}.ts
src/services/image-generation.service.ts   ← ImageGenerationService { generateImage, generateImageWithInputs, normalizeGridImage }
src/services/vision-analysis.service.ts    ← VisionAnalysisService { buildImprovementPrompt, analyzeCellTextOutsideForeground, detectGridBoundaries }
```

- `openrouter.service.ts` dihapus; `grid-split.service.ts` impor tipe dari `utils/text-asset-decoration` langsung; `grid.controller` &
  `generate.controller` di-wire ke dua service baru.
- `ImageGenerationService`: tanpa param `model` / `allowTextOnlyFallback`; `GenerationResult.generationId` dihapus (tidak dikonsumsi);
  metadata (`model`, tokens, cost, latency) diisi dari baris katalog + `rawResponse`; `IMPROVEMENT_GRID_MAX_CELLS` **16→14**.
- `VisionAnalysisService`: konstanta prompt pindah ke sini; `detectGridBoundaries` AI-only (fallback dihapus); `validateBoundaries` +
  `validateGridCoverage` tetap (sanity output AI).
- Metadata respons: field `model`/`improvementAgentModel` diisi service (dari katalog), controller hanya merge.

### 5) Penghapusan Fallback & Legacy (target persis)

| # | Item | Aksi |
|---|---|---|
| 1 | `autoDetectGrid` + call site | hapus; AI gagal/coverage invalid → `GridDetectionError` 422 |
| 2 | `imageService.detectGridBoundaries` + `detectContentIntervals` | hapus; `grid-split.service` AI-only (tanpa rantai `??`) |
| 3 | `allowTextOnlyFallback` | hapus dari service baru |
| 4 | `removeBackgroundWithFallback` → `removeBackground`; `neutral-bright-fallback-animated-gif` | hapus fallback; gagal = error (grid-split tetap toleransi per-sel) |
| 5 | `aiDailyLimits`/`AI_DAILY_*`, `UseGoogleSignInError`, cabang string-prefix `error-handler` | hapus + rapikan konsumen |
| 6 | Default rahasia config | `requiredEnv` fail-fast |

### 6) Docs

- `docs/ARCHITECTURE.md` (baru): lapisan, alur AI (agent/analisis/image), katalog model DB (cara ganti model/effort), tracing, catatan Images API.
- README: Getting started (env tunggal + perintah docker profile), tabel env disegarkan, referensi `OPENROUTER_API_KEY` → `AGENT_API_KEY`.
- `docs/play-console/data-safety-mapping.md`: istilah provider disesuaikan (`AGENT_BASE_URL` gateway).

## Testing & Verification

**Unit (gate lokal: `npx vitest run tests/unit`):**
- Baru: `provider/images-api-model.test.ts` (mapping body — model/prompt/aspect_ratio/input_references data URL; parse b64; error/timeout),
  `models/catalog.test.ts` (mock prisma; baris absen → error), `prisma/seed` catalog test (validasi struktur tabel seed), update
  `image-generation.service.test.ts` (referensi → providerOptions, tanpa fallback, error mapping), update chunking 14, update
  `grid-split.service.test.ts` (stub service baru, AI-only), update test background-removal (tanpa fallback), hapus
  `openrouter-image.test.ts`.
- Tetap hijau: esm/errors/tracing/completion/agent-service/improvement/text-asset/grid-detection.

**Live smokes (wajib sebelum klaim selesai):** agent run (muse), 3 analisis (muse), image plain + dengan referensi (seedream via Images API),
trace Langfuse masuk; `docker compose config` valid untuk tiap profile; `prisma validate`; bila Docker engine tersedia: `migrate deploy` +
`db seed` sungguhan + smoke idempotensi seeder (jalankan 2×).

## Implementation Sequence

| M | Isi | Acceptance |
|---|---|---|
| M1 | Config/env/compose/gitignore/scripts/docs (Detailed Design §1) | dev boot ✓; `docker compose config` valid per profil; grep bebas `OPENROUTER_API_KEY` |
| M2 | Prisma AiModel + seed.ts + migrasi + models/loader/controls + provider refactor + wiring DB | unit ✓; live agent + 3 analisis dengan muse; seeder idempotent (bila DB ada) |
| M3 | Adapter Images API + ImageGenerationService (hapus chat adapter, dep `openai`, `generationId`, cap 14) | live image plain + referensi; unit adapter ✓ |
| M4 | VisionAnalysisService split + penghapusan 6 kategori + config fail-fast + update seluruh test | full unit ✓; live grid/improvement; build ✓ |
| M5 | ARCHITECTURE.md + README + sapuan akhir (`fallback`/`@deprecated`/`openrouter`) + verifikasi penuh + push | suite + smokes + trace Langfuse |

## Risks & Guardrails

| Risiko | Guardrail |
|---|---|
| Migrasi Prisma tanpa Docker hidup | Coba nyalakan Docker Desktop; fallback: SQL migrasi ditulis tangan + `prisma validate` + review; `migrate deploy` dijalankan saat Docker ada |
| Latensi muse (agent `high` ≈35 dtk) | Timeout analisis tetap 20–45 dtk; effort per peran dapat diturunkan dari DB tanpa deploy; ukur ulang saat smoke |
| Perilaku berubah: cap chunk 14, bg-removal/grid strictly-AI | Dicatat di spec; smoke per jalur; pesan error jelas |
| Env lama masih terpakai di deployment pengguna | Script migrasi `.env` lokal + dokumentasi perubahan env di README + catatan rilis di PR |
| Images API hanya mengikuti ekosistem OpenRouter | Didokumentasikan sebagai provider boundary; adapter terkurung di `src/ai/provider/` |

## Contingencies (diputuskan saat eksekusi, dengan bukti)

1. Bila `docker compose config` tidak tersedia tanpa daemon di environment ini → validasi struktural via parser YAML + review manual, jalankan config penuh saat Docker ada.
2. Bila Muse Spark menolak skema strict agent pada kombinasi tools+vision+effort tinggi → turunkan effort default agent atau sederhanakan skema provider-facing (mekanisme kontingensi strict-schema dari spec migrasi tetap berlaku).
3. Bila gambar Seedream JPEG menyebabkan downstream (sharp) butuh penyesuaian → konversi ke PNG di boundary service (bukan fallback; normalisasi format).
