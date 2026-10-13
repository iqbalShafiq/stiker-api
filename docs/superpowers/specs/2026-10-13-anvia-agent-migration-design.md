# Migrasi Agent LangChain → Anvia + Tracing Langfuse — Design Specification

> **Date:** 2026-10-13
> **Status:** Approved (design)
> **Author:** AI Assistant
> **Scope:** Backend `stiker-api` (agent & seluruh permukaan LLM reasoning)

## Overview

Migrasi seluruh permukaan AI di backend `stiker-api` dari LangChain + SDK `openai` mentah ke
runtime **Anvia** (`@anvia/core`, `@anvia/openai`, `@anvia/langfuse`), memakai API semantik Anvia:
`Agent` + `createTool` + `outputSchema`, `generateCompletion` + `outputSchema`, dan kontrak
`ImageGenerationModel` + `generateImage`. Tracing agent run dipindahkan ke Langfuse via
`@anvia/langfuse`. Model tetap OpenRouter (diakses sebagai *OpenAI-compatible API*); model ID dan
konfigurasi produk tidak berubah.

## Goals

1. Agent video sticker pack (`VideoStickerPackAgentService`) berjalan di Anvia `Agent` dengan 4 tool
   `createTool` dan structured output tervalidasi `outputSchema` — tanpa LangChain.
2. Tiga analisis vision single-shot (`buildImprovementPrompt`, `analyzeCellTextOutsideForeground`,
   `detectGridBoundaries`) memakai `generateCompletion` + zod `outputSchema` (hapus pola
   prompt → `JSON.parse` → normalisasi defensif manual).
3. Image generation (5 jalur pemakaian) berjalan lewat `generateImage()` Anvia melalui adapter
   `ImageGenerationModel` app-owned untuk wire format OpenRouter chat-image.
4. Tracing Langfuse untuk agent run via `@anvia/langfuse` (`AgentObserver`), no-op tanpa kredensial,
   graceful flush/close saat shutdown.
5. API publik service & bentuk respons HTTP tidak berubah (kontrak Android app aman).
6. Dependency Anvia versi terbaru; semua akses `@anvia/*` terkurung di satu boundary (`src/ai/`).

## Non-Goals

1. Konversi seluruh backend ke ESM (`"type": "module"`) — kandidat project terpisah.
2. Upgrade Node 20 → 22 LTS — task terpisah (Node 20 sudah EOL; shim tetap berjalan di Node ≥20).
3. Manual span `@langfuse/tracing` untuk completion/image gen — core Anvia 1.14.0 tidak punya
   observer hook untuk keduanya; seam disiapkan agar mudah ditambah nanti.
4. Perubahan model OpenRouter, prompt produk, biaya, atau perilaku kuota AI.
5. Test suite baru yang luas — testing menyusul; hanya suite existing yang dijaga hijau.

## Current State

| Area | Sekarang |
|---|---|
| Agent | `src/services/video-sticker-pack-agent.service.ts` — LangChain `createAgent` + `tool` + `toolStrategy(videoStickerPackPlanSchema)`, model `openai/gpt-4.1-mini`, temperature 0.2, maxTokens 3500, 4 tool lokal (`read_candidate_inventory`, `rank_clear_static_candidates`, `propose_animated_loops`, `validate_sticker_pack_plan`) |
| Analisis vision | `src/services/openrouter.service.ts` — `chatCompletion()` via SDK `openai` mentah ke OpenRouter; prompt panjang + `response_format json_object` + `JSON.parse` manual |
| Image gen | `src/services/openrouter.service.ts` — chat completions dengan image output (`message.images[]`), termasuk fallback text-only dan dekoder gambar defensif; `normalizeGridImage` + `sharp` |
| Konsumen | `GenerateController` (generate, sticker-pack, improve, video-sticker-pack), `GridSplitService` (detect/normalize/analyze) — semua lewat `OpenRouterService` + `VideoStickerPackAgentService` |
| Tracing | Tidak ada (hanya pino logging) |
| Test terkait | `tests/unit/services/video-sticker-pack-agent.service.test.ts` (mock `langchain`) — akan di-rewrite; `grid-split.service.test.ts` (stub struktural) — aman |

## Findings (dasar keputusan — sudah diverifikasi empiris)

1. **Tidak ada `@anvia/openrouter`.** OpenRouter didukung lewat `@anvia/openai` dengan
   `baseUrl: 'https://openrouter.ai/api/v1'` + `api: 'chat'` (pola *OpenAI-compatible APIs*).
2. **`@anvia/*` ESM-only dan `exports` map-nya tanpa kondisi `require`.**
   `require('@anvia/core')` gagal `ERR_PACKAGE_PATH_NOT_EXPORTED` bahkan di Node 25 (diuji).
   Dynamic `import()` native dari CJS berhasil.
3. **`tsc` menurunkan `import()` menjadi `require()`** di `module: commonjs` (diuji dengan
   TS 5.4.5, target ES2022) — sehingga butuh shim import native di satu helper.
4. **Adapter chat Anvia** (`@anvia/openai` 1.3.0) mendeklarasikan `imageInput: true`,
   `tools`, `toolChoice`, `outputSchema: true`; memetakan image part →
   `image_url` data URL; mengirim `response_format.json_schema.strict` untuk `outputSchema`;
   `abortSignal` diteruskan ke SDK (`maxRetries: 0`); usage dinormalisasi ke
   `inputTokens/outputTokens` **tanpa cost** (cost dibaca dari `rawResponse` bila perlu).
5. **Response mapping chat tidak membawa `message.images[]`** → image generation OpenRouter
   tidak bisa lewat `generateCompletion`; dipakai kontrak `ImageGenerationModel`.
6. **`ImageGenerationRequest`** Anvia = `{ prompt, width, height, providerOptions }`
   (tanpa input image) → input image dilewatkan `providerOptions.referenceImages`
   (pola resmi "provider-specific request fields").
7. **`generateCompletion` tidak punya observer surface** di core 1.14.0;
   `@anvia/langfuse` menyediakan `LangfuseClient.observer()` → `AgentObserver` (agent run saja).
8. **Versi terbaru (terverifikasi npm):** `@anvia/core` 1.14.0, `@anvia/openai` 1.3.0
   (membawa `openai ^7.30.0` sendiri), `@anvia/langfuse` 1.2.1 (deps `@langfuse/otel`+`@langfuse/tracing`).
   Peer `@anvia/core`: `zod ^4.6.5`.
9. **Type resolution aman** dengan `moduleResolution: node` klasik karena paket Anvia menyediakan
   top-level `types`/`main`; subpath `exports` tidak boleh dipakai — semua impor tipe dari root
   paket (`typeof import('@anvia/core')`, `import type`).
10. `@openrouter/sdk` tidak dipakai di `src/` (dependency basi).

## Architecture Decision

**Pendekatan A (dipilih): tetap CommonJS + boundary `src/ai/` + shim native dynamic import.**

- Semua akses `@anvia/*` hanya dari `src/ai/**`, dimuat lazy via satu helper `importEsm`.
- Tipe tetap penuh lewat `typeof import('@anvia/core')` / `import type` (terhapus saat compile,
  tidak memicu `require`).
- Alternatif ditolak: **konversi ESM penuh** (blast radius besar: seluruh import relatif,
  script `.js`, tooling; layak project terpisah) dan **boundary `.mts`** (mencampur format,
  bergantung `require(esm)` yang bergantung versi Node).

Prinsip turunan:

- **Anvia semantic first**: structured output tervalidasi, tool tiped, observer — bukan prompt+parse manual.
- **Reuse maksimal**: schema zod & normalizer existing dipertahankan sebagai sumber kebenaran
  (`videoStickerPackPlanSchema`, `normalizeVideoStickerPackPlan`, `rankStaticCandidates`,
  `proposeAnimatedLoops`, `validatePlanForRequest`, `normalizeImprovementPromptPlan`,
  `autoDetectGrid`, validasi coverage, `buildTextAssetDecoration`).
- **Public API service tidak berubah** kecuali penambahan opsional (`userId?`) dan penghapusan
  field mati (`generationId` yang tidak dikonsumsi).

## Ownership Map

| Layer | Pemilik | Isi |
|---|---|---|
| Route/Controller | existing | auth, quota, upload, validasi request — tidak berubah |
| Services (`src/services`) | existing | orkestrasi produk: validasi bentuk, normalisasi, metadata, error mapping |
| `src/ai/` (baru) | app | provider boundary OpenRouter↔Anvia, agent factory + tools, completion helper, image adapter, tracing Langfuse |
| Utils (`src/utils`) | existing + schema baru | schema zod output model, normalizer lama tetap |
| Config | existing | env & model mapping (tanpa perubahan model) |

## Proposed Structure

```
src/ai/
  esm.ts                        # importEsm<T>() — native dynamic import, satu-satunya trik
  openrouter.ts                 # OpenAIClient Anvia → OpenRouter + factory completionModel per peran (cache)
  openrouter-image.ts           # OpenRouterChatImageModel implements ImageGenerationModel
  completion.ts                 # generateStructuredCompletion() — pesan+images, outputSchema, timeout, usage/cost
  tracing.ts                    # LangfuseClient lazy singleton + observer + flush/close
  video-sticker-pack-agent.ts   # factory Agent Anvia (instructions, createTool, outputSchema, observability)
src/services/
  video-sticker-pack-agent.service.ts  # di-rewrite: orkestrasi + normalisasi + metadata + error mapping
  openrouter.service.ts                # di-rewrite internal: 3 analisis → generateCompletion; image gen → generateImage
src/utils/
  improvement.ts                # + improvementPlanOutputSchema (model-facing, reuse normalizer)
  text-asset-decoration.ts      # + cellTextAnalysisOutputSchema (+ tipe hasil di-derive dari schema)
  grid-detection.ts             # baru: gridDetectionOutputSchema + tipe
  video-sticker-pack.ts         # (kemungkinan) + varian schema model-facing jika probe M2 menuntut
src/config/index.ts             # + blok langfuse
src/server.ts                   # + flush/close tracing saat shutdown
```

## Detailed Design

### 1. Integrasi modul — `src/ai/esm.ts`

```ts
/**
 * Native dynamic import yang bertahan di emit CommonJS.
 * `import()` diturunkan `tsc` menjadi `require()` pada module=commonjs, sementara
 * paket `@anvia/*` ESM-only tanpa kondisi `require` pada exports map.
 */
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>;

export function importEsm<T>(specifier: string): Promise<T> {
  return nativeImport(specifier) as Promise<T>;
}
```

Pola pemakaian (contoh `openrouter.ts`):

```ts
let corePromise: Promise<typeof import('@anvia/core')> | undefined;
function anviaCore() {
  corePromise ??= importEsm<typeof import('@anvia/core')>('@anvia/core');
  return corePromise;
}
```

Konsekuensi test: `vi.mock('@anvia/core')` **tidak** mengintersepsi modul ini — mocking dilakukan
di module app-owned (`src/ai/video-sticker-pack-agent.ts`).

### 2. Provider boundary — `src/ai/openrouter.ts`

- Lazy singleton `OpenAIClient` (`@anvia/openai`) dengan `apiKey: config.openRouterApiKey`,
  `baseUrl: 'https://openrouter.ai/api/v1'`, `headers: { 'HTTP-Referer': config.appUrl, 'X-Title': 'Setiker API' }`.
- Factory + cache per peran:
  - `agentCompletionModel()` → `config.models.videoStickerPackAgent`
  - `improvementCompletionModel()` → `config.models.improvementAgent`
  - `visionCompletionModel()` → `config.models.agent`
  - Semua: `client.completionModel({ modelId, api: 'chat' })`.
- Model di-cache per `modelId` (sekarang model dibuat ulang tiap request).

### 3. Agent — `src/ai/video-sticker-pack-agent.ts` + rewrite service

Factory `createVideoStickerPackAgent(input)`:

- `new Agent({ id: 'video-sticker-pack', model, instructions, tools, outputSchema, temperature: 0.2, maxTokens: 3500, maxTurns: 8, retries: { maxAttempts: 2 }, observability })`,
  di mana `observability = { observers: { langfuse }, primaryTrace: 'langfuse' }` bila observer aktif.
- `instructions`: teks system prompt existing dipindah apa adanya.
- `tools`: 4 tool existing di-port dengan `createTool` — name/description/schema/JSON-string hasil identik.
- `outputSchema`: `videoStickerPackPlanSchema` (reuse). Kontingensi: bila probe M2 menunjukkan
  provider menolak keyword `default`/properti opsional pada `strict`, tambah varian
  *model-facing* tanpa `default`/`coerce`; normalisasi tetap lewat schema lama.

Service (`generatePlan`) mempertahankan:

- Cek `config.openRouterApiKey` → `ValidationError`.
- Pesan user: teks (style prompt, rentang terpilih, manifest kandidat) + image part per grid
  (`{ type: 'image', image: { type: 'data', data: base64 }, mediaType }`).
- `trace: { name: 'video-sticker-pack', userId, metadata: { candidateCount, candidateGridCount, selectedStartMs, selectedEndMs, hasStylePrompt } }` —
  tanpa teks prompt user (privasi) dan tanpa gambar.
- Outcome `response` → `normalizeVideoStickerPackPlan(outcome.output, candidates)`;
  `interaction`/`blocked`/error → `AIGenerationError` (502).
- Metadata hasil: `model`, `mode`, counts, layouts, timestamps,
  `tokensPrompt = outcome.usage.inputTokens`, `tokensCompletion = outcome.usage.outputTokens`, `latencyMs`.
- `VideoStickerPackAgentInput` + `userId?: string` (opsional); controller mengisi `req.user.id`.

### 4. Analisis vision — `src/ai/completion.ts` + `OpenRouterService`

Helper:

```ts
generateStructuredCompletion({
  roleModel,            // completion model dari openrouter.ts
  instructions?,        // di-map ke system
  prompt,               // teks
  images?,              // [{ buffer, mimeType }] → image part data URL
  outputSchema,         // zod (Standard Schema)
  timeoutMs,            // AbortSignal.timeout
}) => { output, usage, cost?, latencyMs }
```

Pemetaan error: abort/timeout → `TimeoutError`; pola provider error → `ProviderError`; lainnya → `AIGenerationError`.

Migrasi method `OpenRouterService` (signature publik tetap):

| Method | Timeout | Schema | Catatan |
|---|---|---|---|
| `buildImprovementPrompt` | 45s | `improvementPlanOutputSchema` di `utils/improvement.ts` | `normalizeImprovementPromptPlan` diperluas menerima `string \| object`; `generationId` dihapus (tidak dikonsumsi) |
| `analyzeCellTextOutsideForeground` | 20s | `cellTextAnalysisOutputSchema` di `utils/text-asset-decoration.ts` | logika 2-pass recall + rekonsiliasi `hasTextOutsideForeground` dipertahankan; tipe hasil di-derive dari schema dan tetap di-export dari service |
| `detectGridBoundaries` | 30s | `gridDetectionOutputSchema` di `utils/grid-detection.ts` (baru) | `validateBoundaries` + `validateGridCoverage` + fallback `autoDetectGrid` dipertahankan |

`chatCompletion()` publik yang hanya dipakai internal dihapus.

### 5. Image generation — `src/ai/openrouter-image.ts` + `OpenRouterService`

- `OpenRouterChatImageModel implements ImageGenerationModel` (`provider: 'openrouter'`):
  - Request Anvia: `{ prompt, width, height, providerOptions }`; `providerOptions.referenceImages` =
    `Array<{ base64, mimeType }>` (app-owned, typed).
  - Memanggil `chat.completions.create` (SDK `openai` yang sudah ada) ke OpenRouter dengan
    `modalities: ['image', 'text']`; konten = teks + reference images (data URL).
  - Parse `message.images[]` (data URL / b64 / http(s) URL) → `GeneratedImage`
    (`Uint8Array` + `mediaType`); logika dekoder defensif existing dipindah ke sini.
  - `width/height` diabaikan (chat API tidak menerima size; perilaku sekarang sama);
    hasil di-resize 512 downstream seperti sekarang.
- `OpenRouterService.generateImageWithInputs` → `generateImage({ model, prompt, providerOptions: { referenceImages }, abortSignal })`;
  fallback text-only dipertahankan (catch error provider + ada images → retry tanpa referenceImages).
- Metadata `tokensPrompt/tokensCompletion/cost/latencyMs` tetap dibaca dari `rawResponse.usage` OpenRouter.
- `normalizeGridImage` tetap: `generateImage` → `sharp().resize(target).png()`.

### 6. Tracing — `src/ai/tracing.ts`

- `LangfuseClient` dibuat lazy **hanya** bila `LANGFUSE_PUBLIC_KEY` dan `LANGFUSE_SECRET_KEY` ada;
  `baseUrl` dari `LANGFUSE_BASE_URL` (fallback bawaan paket), `environment` dari config nodeEnv.
- `getLangfuseObserver()` → `client.observer({ captureMode: 'safe' })` atau `null`.
- `flushAiTracing()` / `closeAiTracing()` idempoten; dipanggil di `server.ts` pada SIGTERM/SIGINT
  dan best-effort pada `uncaughtException`.
- Tanpa kredensial: semua no-op, zero overhead.

### 7. Config & env

- `config.langfuse = { baseUrl, publicKey, secretKey, environment }` dari env.
- `.env.example` tambah: `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
  `VIDEO_STICKER_PACK_AGENT_MODEL`, `IMPROVEMENT_AGENT_MODEL` (dua terakhir sudah dibaca config tapi belum terdaftar).

## Error Handling

| Jalur | Mapping |
|---|---|
| Agent (API key kosong) | `ValidationError` (existing) |
| Agent (run/structured output gagal, interaction/blocked anomali) | `AIGenerationError` 502 (perilaku sekarang) |
| Analisis timeout | `TimeoutError` 504 |
| Analisis provider error terdeteksi | `ProviderError` 502 |
| Analisis lainnya | `AIGenerationError` 502 |
| Grid AI gagal | fallback `autoDetectGrid`; gagal total → `GridDetectionError` 422 (existing) |
| Image gen | `ProviderError`/`AIGenerationError` seperti sekarang; fallback text-only tidak berubah |

## Dependencies & Versions

- **Tambah:** `@anvia/core@1.14.0`, `@anvia/openai@1.3.0`, `@anvia/langfuse@1.2.1`.
- **Naikkan:** `zod` → `^4.6.5` (peer `@anvia/core`).
- **Hapus (setelah rewrite selesai):** `langchain`, `@langchain/core`, `@langchain/openrouter`,
  `@openrouter/sdk` (tidak terpakai).
- **Tetap:** `openai` v6 (dipakai adapter image + sudah selaras dengan SDK `openai ^7` milik
  `@anvia/openai` yang nested — tidak dikonsumsi langsung).
- **Tidak berubah:** Dockerfile, engines Node ≥20, TypeScript 5.4.5 (compile probe Anvia lolos;
  bump hanya bila muncul kebutuhan nyata).

## Testing & Verification

- Rewrite `tests/unit/services/video-sticker-pack-agent.service.test.ts` → mock module
  `src/ai/video-sticker-pack-agent`; semantik 3 kasus existing dipertahankan
  (output tervalidasi → plan ternormalisasi + metadata token; error → `AI_GENERATION_FAILED`).
- `grid-split.service.test.ts` & test utils tetap hijau tanpa perubahan.
- Verifikasi wajib sebelum klaim selesai:
  1. `npm run typecheck` & `npm run lint` hijau.
  2. `npm test` (vitest) hijau.
  3. `npm run build` hijau.
  4. Smoke live manual dengan `OPENROUTER_API_KEY` asli (script ad-hoc, tidak dikomit):
     agent run nyata, satu completion vision, image gen dengan dan tanpa input image,
     fallback text-only.
  5. Bila kredensial Langfuse tersedia: verifikasi trace muncul di dashboard.

## Implementation Sequence

| Milestone | Isi | Acceptance |
|---|---|---|
| **M1** | Deps Anvia + bump zod + `config.langfuse` + `.env.example` (LangChain masih terpasang) | `npm install`, typecheck, tests hijau |
| **M2** | `src/ai/esm.ts` + `openrouter.ts` + probe live: text, `outputSchema`, image input | Probe sukses / jalur kontingensi strict-schema diputuskan & terdokumentasi |
| **M3** | `completion.ts` + migrasi 3 analisis + schema output di utils | typecheck/lint/tests hijau + smoke live 3 analisis |
| **M4** | `openrouter-image.ts` + migrasi image gen | Smoke: generate murni, dengan input, fallback text-only — semua menghasilkan gambar valid |
| **M5** | `tracing.ts` + `video-sticker-pack-agent.ts` + rewrite service agent + update unit test | Smoke agent end-to-end + unit test baru hijau |
| **M6** | Cleanup: hapus deps LangChain & `@openrouter/sdk`, `chatCompletion`, wiring shutdown `server.ts`, update README/env docs | typecheck/lint/tests/build hijau; `grep -ri langchain src tests package.json` bersih |

## Risks & Guardrails

| Risiko | Guardrail |
|---|---|
| Provider menolak `strict` JSON schema (keyword `default` / properti opsional dari schema plan) | Probe live M2; fallback varian model-facing tanpa `default`/`coerce` (normalisasi tetap di schema lama) |
| Gemini via OpenRouter berbeda perilaku untuk `response_format json_schema` | Probe live M2; fallback `providerOptions` OpenRouter / instruksi + validasi Anvia |
| Shim native import tidak terlihat `vi.mock` | Mock di boundary app-owned (`src/ai/video-sticker-pack-agent`), bukan package Anvia |
| Payload gambar besar memenuhi trace | `captureMode: 'safe'` + `captureMaxBytes` default; metadata trace tanpa gambar & prompt |
| `cost` tidak tersedia pada usage ternormalisasi | Field `cost` opsional; jalur image tetap membaca `rawResponse` |
| Perbedaan minor output model akibat perubahan mekanisme structured output (tool-based → json_schema) | Prompt & temperature dipertahankan; normalizer existing menjaga bentuk akhir; smoke live M5 |
| Node 20 EOL & ESM-only ecosystem jangka panjang | Catatan follow-up: upgrade Node 22 LTS + evaluasi konversi ESM penuh sebagai project terpisah |

## Contingency Decisions (diputuskan saat eksekusi, dengan bukti probe)

1. Varian schema model-facing untuk agent bila `strict` ditolak provider.
2. Strategi structured output Gemini (schema native vs providerOptions) bila OpenRouter tidak
   meneruskan `response_format json_schema` dengan benar.
3. Hapus/bump `openai` v6 hanya bila terbukti perlu (default: tetap).
