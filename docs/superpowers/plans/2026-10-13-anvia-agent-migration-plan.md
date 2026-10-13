# Migrasi Agent LangChain → Anvia + Tracing Langfuse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memindahkan seluruh permukaan LLM backend `stiker-api` (agent video sticker pack, 3 analisis vision, image generation) dari LangChain + SDK `openai` mentah ke runtime Anvia (`@anvia/core`, `@anvia/openai`, `@anvia/langfuse`) dengan tracing agent run ke Langfuse, tanpa mengubah kontrak HTTP/service yang ada.

**Architecture:** Pendekatan A — backend tetap CommonJS; semua akses `@anvia/*` (ESM-only) terkurung di boundary `src/ai/**` dan dimuat via satu shim native dynamic import (`src/ai/esm.ts`). Agent memakai `Agent` + `createTool` + `outputSchema`; analisis memakai `generateCompletion` + zod `outputSchema`; image generation memakai kontrak `ImageGenerationModel` + `generateImage` dengan adapter app-owned untuk wire format chat-image OpenRouter; tracing memakai `@anvia/langfuse` observer (no-op tanpa kredensial).

**Tech Stack:** Node ≥20 (CommonJS, `tsc`), TypeScript 5.4, zod 4, Express 4, OpenRouter (OpenAI-compatible), `@anvia/core` 1.14.0, `@anvia/openai` 1.3.0, `@anvia/langfuse` 1.2.1, vitest 1.

**Spec:** `docs/superpowers/specs/2026-10-13-anvia-agent-migration-design.md`

## Global Constraints

- Versi dependency persis: `@anvia/core@1.14.0`, `@anvia/openai@1.3.0`, `@anvia/langfuse@1.2.1`; `zod` → `^4.6.5` (peer `@anvia/core`).
- Backend tetap CommonJS — jangan ubah `"type"`, `tsconfig.module`, atau `moduleResolution`.
- Impor `@anvia/*` HANYA dari root package (tanpa subpath seperti `@anvia/core/observability` — `moduleResolution: node` klasik tidak mendukung `exports`); runtime-nya HANYA via `importEsm` dari `src/ai/esm.ts`.
- Semua akses `@anvia/*` hanya boleh berada di `src/ai/**`.
- Signature publik method `OpenRouterService` dan `VideoStickerPackAgentService.generatePlan` tidak berubah (konsumen: `GenerateController`, `GridSplitService`).
- Model ID & mapping env tidak berubah: `videoStickerPackAgent`, `agent`, `improvementAgent`, `imageGeneration` (di `src/config/index.ts`).
- Tanpa kredensial Langfuse → tracing no-op (bukan error).
- Setelah Task 6: tidak boleh ada referensi `langchain`, `@langchain/*`, `@openrouter/sdk` di `src/`, `tests/`, `package.json`.
- Setiap task diakhiri commit; `npm run typecheck` + `npm run lint` + `npm test` harus hijau sebelum commit.
- Test file tidak terkena ESLint (`eslint src` saja); kode di `src/` harus lolos `no-new-func` (shim memakai disable comment ber-alasan).

## Review Focus

Kelima hal berikut tidak diekspresikan penuh oleh desain spec namun paling mungkin menggigit; masing-masing sudah punya test di task pemiliknya:

1. Output model yang melanggar zod schema (field hilang/invalid) harus **ditolak** (`AIGenerationError` 502), bukan diterima sebagian — Task 3 (test `normalizeImprovementPromptPlan` objek kosong) + Task 5 (test output invalid).
2. Provider menolak strict JSON schema untuk `outputSchema` (gpt-4.1-mini / gemini via OpenRouter) — probe live Task 2 wajib merekam keputusan; mitigasi kontingensi di Task 5.
3. Timeout (20s/30s/45s/60s) harus jadi `TimeoutError` 504, bukan error generik — Task 3 (`tests/unit/ai/errors.test.ts`).
4. Response chat-image tanpa gambar yang bisa didekode (kosong / URL mati / hanya markdown) harus jadi `AIGenerationError`, bukan crash — Task 4 (`tests/unit/ai/openrouter-image.test.ts`).
5. Tanpa kredensial Langfuse aplikasi harus berjalan normal (observer `null`, flush/close resolve) — Task 5 (`tests/unit/ai/tracing.test.ts` + edit `tests/setup.ts`).

---

## File Map

**Dibuat:**
- `src/ai/esm.ts` — shim `importEsm`
- `src/ai/errors.ts` — pemetaan error AI bersama
- `src/ai/openrouter.ts` — client Anvia→OpenRouter + factory completion model (cache)
- `src/ai/completion.ts` — `buildUserContent`, `generateStructuredCompletion`
- `src/ai/openrouter-image.ts` — adapter `ImageGenerationModel` + `extractImagesFromAssistantMessage`
- `src/ai/tracing.ts` — Langfuse lazy singleton + observer + flush/close
- `src/ai/video-sticker-pack-agent.ts` — factory `Agent` + tools + user message
- `src/utils/grid-detection.ts` — `gridDetectionOutputSchema`
- `tests/unit/ai/esm.test.ts`
- `tests/unit/ai/errors.test.ts`
- `tests/unit/ai/openrouter-image.test.ts`
- `tests/unit/ai/tracing.test.ts`
- `tests/unit/utils/grid-detection.test.ts`

**Dimodifikasi:**
- `package.json`, `.env.example`, `src/config/index.ts`
- `src/utils/improvement.ts`, `src/utils/text-asset-decoration.ts` (+ test masing-masing)
- `src/services/openrouter.service.ts` (rewrite internal; Task 3 & 4)
- `src/services/video-sticker-pack-agent.service.ts` (rewrite; Task 5)
- `src/controllers/generate.controller.ts` (userId; Task 5)
- `src/server.ts` (shutdown tracing; Task 5)
- `tests/setup.ts` (hapus env Langfuse; Task 5)
- `tests/unit/services/video-sticker-pack-agent.service.test.ts` (rewrite; Task 5)
- `README.md` (bagian AI engine; Task 6)

---

### Task 1: Dependencies, `config.langfuse`, `.env.example`

**Files:**
- Modify: `package.json`
- Modify: `src/config/index.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `config.langfuse = { baseUrl: string; publicKey: string; secretKey: string }` untuk Task 5.

- [ ] **Step 1: Tambah dependency Anvia & bump zod di `package.json`**

Pada blok `dependencies`, sisipkan setelah baris `"@apple/app-store-server-library": "^3.1.0",`:

```json
    "@anvia/core": "1.14.0",
    "@anvia/langfuse": "1.2.1",
    "@anvia/openai": "1.3.0",
```

Ubah baris `"zod": "^4.4.3"` menjadi:

```json
    "zod": "^4.6.5"
```

(JANGAN sentuh `langchain`, `@langchain/*`, `@openrouter/sdk` — dihapus di Task 6.)

- [ ] **Step 2: Install & verifikasi lockfile**

Run: `npm install`
Expected: sukses tanpa peer-dep warning error; `package-lock.json` berubah.

- [ ] **Step 3: Tambah blok `langfuse` di `src/config/index.ts`**

Sisipkan setelah baris `redisEnabled: process.env.REDIS_ENABLED !== 'false',`:

```ts
  langfuse: {
    baseUrl: process.env.LANGFUSE_BASE_URL ?? '',
    publicKey: process.env.LANGFUSE_PUBLIC_KEY ?? '',
    secretKey: process.env.LANGFUSE_SECRET_KEY ?? '',
  },
```

- [ ] **Step 4: Tambah env baru di `.env.example`**

Di dekat blok `# AI Model Configuration`, ubah menjadi:

```
# AI Model Configuration
IMAGE_GENERATION_MODEL=google/gemini-2.5-flash-image
AGENT_MODEL=google/gemini-2.5-flash-lite
VIDEO_STICKER_PACK_AGENT_MODEL=openai/gpt-4.1-mini
IMPROVEMENT_AGENT_MODEL=google/gemini-2.5-pro

# Langfuse tracing (optional — leave empty to disable agent tracing)
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_PUBLIC_KEY=
LANGFUSE_SECRET_KEY=
```

- [ ] **Step 5: Verifikasi**

Run: `npm run typecheck` → Expected: PASS
Run: `npm test` → Expected: PASS (suite lama masih hijau; LangChain masih terpasang)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/config/index.ts .env.example
git commit -m "chore(ai): add @anvia dependencies, zod bump, langfuse config"
```

---

### Task 2: `src/ai/esm.ts` + `src/ai/openrouter.ts` + probe live kompatibilitas

**Files:**
- Create: `src/ai/esm.ts`
- Create: `src/ai/openrouter.ts`
- Test: `tests/unit/ai/esm.test.ts`
- Temporary (dihapus di step akhir): `scripts/tmp-anvia-probe.ts`

**Interfaces:**
- Produces (dipakai Task 3–5):
  - `importEsm<T>(specifier: string): Promise<T>`
  - `OPENROUTER_BASE_URL: string`
  - `getOpenRouterCompletionModel(modelId: string): Promise<CompletionModel>`
  - `getAgentCompletionModel() / getVisionCompletionModel() / getImprovementCompletionModel(): Promise<CompletionModel>`
  - (`CompletionModel` = type-only import dari `@anvia/core`)

- [ ] **Step 1: Tulis test yang gagal — `tests/unit/ai/esm.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { importEsm } from '../../../src/ai/esm';

describe('importEsm', () => {
  it('loads a builtin ESM module from CommonJS-compiled code', async () => {
    const os = await importEsm<typeof import('node:os')>('node:os');
    expect(typeof os.platform()).toBe('string');
  });

  it('loads the ESM-only @anvia/core package', async () => {
    const core = await importEsm<typeof import('@anvia/core')>('@anvia/core');
    expect(typeof core.Agent).toBe('function');
    expect(typeof core.createTool).toBe('function');
    expect(typeof core.generateCompletion).toBe('function');
    expect(typeof core.generateImage).toBe('function');
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `npx vitest run tests/unit/ai/esm.test.ts`
Expected: FAIL — `Cannot find module '../../../src/ai/esm'`

- [ ] **Step 3: Implementasi `src/ai/esm.ts`**

```ts
/**
 * Native dynamic import that survives TypeScript's CommonJS emit.
 *
 * `tsc` lowers `import()` to `require()` under `module: commonjs`, but the
 * `@anvia/*` packages are ESM-only and their `exports` maps declare no
 * `require` condition, so `require()` fails with ERR_PACKAGE_PATH_NOT_EXPORTED.
 * The Function constructor keeps the runtime's native ESM loader in play.
 */
// eslint-disable-next-line no-new-func -- required to keep a native ESM import in CJS emit
const nativeImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string
) => Promise<unknown>;

export function importEsm<T>(specifier: string): Promise<T> {
  return nativeImport(specifier) as Promise<T>;
}
```

- [ ] **Step 4: Jalankan test — pastikan pass**

Run: `npx vitest run tests/unit/ai/esm.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Implementasi `src/ai/openrouter.ts`**

```ts
import type { CompletionModel } from '@anvia/core';
import { config } from '../config';
import { importEsm } from './esm';

type AnviaOpenAIModule = typeof import('@anvia/openai');

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

let openaiModulePromise: Promise<AnviaOpenAIModule> | undefined;

function anviaOpenAI(): Promise<AnviaOpenAIModule> {
  openaiModulePromise ??= importEsm<AnviaOpenAIModule>('@anvia/openai');
  return openaiModulePromise;
}

type OpenAIClientHandle = InstanceType<AnviaOpenAIModule['OpenAIClient']>;

let clientPromise: Promise<OpenAIClientHandle> | undefined;

function getClient(): Promise<OpenAIClientHandle> {
  clientPromise ??= anviaOpenAI().then(
    ({ OpenAIClient }) =>
      new OpenAIClient({
        apiKey: config.openRouterApiKey,
        baseUrl: OPENROUTER_BASE_URL,
        headers: {
          'HTTP-Referer': config.appUrl,
          'X-Title': 'Setiker API',
        },
      })
  );
  return clientPromise;
}

const modelCache = new Map<string, CompletionModel>();

export async function getOpenRouterCompletionModel(modelId: string): Promise<CompletionModel> {
  const cached = modelCache.get(modelId);
  if (cached !== undefined) {
    return cached;
  }
  const client = await getClient();
  const model: CompletionModel = client.completionModel({ modelId, api: 'chat' });
  modelCache.set(modelId, model);
  return model;
}

export function getAgentCompletionModel(): Promise<CompletionModel> {
  return getOpenRouterCompletionModel(config.models.videoStickerPackAgent);
}

export function getVisionCompletionModel(): Promise<CompletionModel> {
  return getOpenRouterCompletionModel(config.models.agent);
}

export function getImprovementCompletionModel(): Promise<CompletionModel> {
  return getOpenRouterCompletionModel(config.models.improvementAgent);
}
```

- [ ] **Step 6: Verifikasi kompilasi**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Tulis probe live `scripts/tmp-anvia-probe.ts` (temporary)**

```ts
import sharp from 'sharp';
import { z } from 'zod';
import { importEsm } from '../src/ai/esm';
import {
  getAgentCompletionModel,
  getVisionCompletionModel,
} from '../src/ai/openrouter';

async function buildTinyPng(): Promise<Buffer> {
  return sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
}

async function main(): Promise<void> {
  const { generateCompletion } = await importEsm<typeof import('@anvia/core')>('@anvia/core');
  const visionModel = await getVisionCompletionModel();
  const agentModel = await getAgentCompletionModel();

  // Probe A — plain text completion on the vision model.
  const a = await generateCompletion({
    model: visionModel,
    instructions: 'Answer in one short sentence.',
    prompt: 'Reply with the single word: pong',
  });
  console.log('A(text):', JSON.stringify(a.text).slice(0, 200));

  // Probe B — structured output with defaults/coerce (mirrors the agent plan schema style).
  const probeSchema = z.object({
    title: z.string().default('Untitled'),
    scores: z.array(z.coerce.number()).default([]),
  });
  for (const [name, model] of [
    ['B1(agent-model)', agentModel],
    ['B2(vision-model)', visionModel],
  ] as const) {
    const result = await generateCompletion({
      model,
      prompt: 'Return JSON with title "probe" and scores [1, 2].',
      outputSchema: probeSchema,
    });
    console.log(`${name}:`, JSON.stringify(result.output));
  }

  // Probe C — image input on the vision model.
  const image = await buildTinyPng();
  const c = await generateCompletion({
    model: visionModel,
    instructions: 'Describe the dominant color of the image in one word.',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is the dominant color of this image?' },
          {
            type: 'image',
            image: { type: 'data', data: image.toString('base64') },
            mediaType: 'image/png',
          },
        ],
      },
    ],
  });
  console.log('C(vision):', JSON.stringify(c.text).slice(0, 200));
}

main().catch((error) => {
  console.error('PROBE FAILED:', error);
  process.exitCode = 1;
});
```

- [ ] **Step 8: Jalankan probe dengan API key asli**

Run: `npx tsx scripts/tmp-anvia-probe.ts`
Expected:
- `A(text)` berisi jawaban teks;
- `B1`/`B2` menghasilkan `{ title: 'probe', scores: [1, 2] }`;
- `C(vision)` menyebut warna merah.

**Keputusan yang WAJIB direkam:**
- Jika semua probe sukses → skema default (dengan `default`/`coerce`) aman; Task 5 memakai `videoStickerPackPlanSchema` apa adanya.
- Jika `B1`/`B2` gagal dengan error schema/strict → Task 5 WAJIB mengaktifkan langkah kontingensi "strict-friendly schema" (lihat Task 5 Step 8).
- Jika `C` gagal karena image input tidak didukung endpoint → catat; agent vision tergantung pada ini. Mitigasi: ganti model `AGENT_MODEL`/`VIDEO_STICKER_PACK_AGENT_MODEL` di env ke model OpenRouter yang mendukung vision + structured output (perubahan config, tanpa perubahan kode).
- Jika structured output tidak didukung model tertentu sama sekali → mitigasi config model (idem), bukan perubahan kode.

- [ ] **Step 9: Hapus script probe & cek working tree**

Run: `Remove-Item scripts/tmp-anvia-probe.ts` (PowerShell)
Run: `git status --short`
Expected: hanya `src/ai/*` + test baru yang muncul.

- [ ] **Step 10: Lint + test penuh**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add src/ai/esm.ts src/ai/openrouter.ts tests/unit/ai/esm.test.ts
git commit -m "feat(ai): add ESM import shim and OpenRouter provider boundary via @anvia/openai"
```

---

### Task 3: Shared error mapping + completion helper + migrasi 3 analisis vision

**Files:**
- Create: `src/ai/errors.ts`
- Create: `src/ai/completion.ts`
- Create: `src/utils/grid-detection.ts`
- Create: `tests/unit/ai/errors.test.ts`
- Create: `tests/unit/utils/grid-detection.test.ts`
- Modify: `src/utils/improvement.ts`
- Modify: `src/utils/text-asset-decoration.ts`
- Modify: `src/services/openrouter.service.ts`
- Modify: `tests/unit/utils/improvement.test.ts`
- Modify: `tests/unit/utils/text-asset-decoration.test.ts`
- Temporary (dihapus): `scripts/tmp-analyses-smoke.ts`

**Interfaces:**
- Consumes: `importEsm`, `getVisionCompletionModel`, `getImprovementCompletionModel` (Task 2).
- Produces (dipakai Task 4–5):
  - `src/ai/errors.ts`: `isProviderError(error: unknown): boolean`, `extractProviderErrorMessage(error: unknown): string`, `toAiError(error: unknown, context?: { abortSignal?: AbortSignal }): AppError`
  - `src/ai/completion.ts`: `normalizeImageMediaType(mimeType: string): string`, `buildUserContent(input: { text: string; images?: ReadonlyArray<{ buffer: Buffer; mimeType: string }> }): UserMessage['content']`, `generateStructuredCompletion<Output>(input: StructuredCompletionInput<Output>): Promise<StructuredCompletionResult<Output>>` dengan `role: 'vision' | 'improvement' | 'agent'`
  - `src/utils/improvement.ts`: `improvementPlanOutputSchema`; `normalizeImprovementPromptPlan(content: unknown, options)` (menerima object atau string)
  - `src/utils/text-asset-decoration.ts`: `cellTextAnalysisOutputSchema` + tipe `TextStyleMetadata`, `OutsideForegroundTextDetection`, `CellTextAnalysisResult`
  - `src/utils/grid-detection.ts`: `gridDetectionOutputSchema`
  - `src/services/openrouter.service.ts`: tetap export `OpenRouterService` + re-export tipe analisis.

- [ ] **Step 1: Tulis test yang gagal — `tests/unit/ai/errors.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { AIGenerationError, ProviderError, TimeoutError } from '../../../src/errors';
import { extractProviderErrorMessage, isProviderError, toAiError } from '../../../src/ai/errors';

describe('ai error mapping', () => {
  it('maps an aborted signal to TimeoutError', () => {
    const controller = new AbortController();
    controller.abort();
    expect(toAiError(new Error('aborted'), { abortSignal: controller.signal })).toBeInstanceOf(
      TimeoutError
    );
  });

  it('maps an AbortError by name to TimeoutError', () => {
    const error = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
    expect(toAiError(error)).toBeInstanceOf(TimeoutError);
  });

  it('maps provider error messages to ProviderError', () => {
    expect(toAiError(new Error('Provider returned error'))).toBeInstanceOf(ProviderError);
    expect(toAiError(new Error('Upstream 502 bad gateway'))).toBeInstanceOf(ProviderError);
    expect(isProviderError(new Error('Upstream 502 bad gateway'))).toBe(true);
  });

  it('passes through AppError instances untouched', () => {
    const original = new AIGenerationError('already mapped');
    expect(toAiError(original)).toBe(original);
  });

  it('falls back to AIGenerationError', () => {
    expect(toAiError(new Error('boom'))).toBeInstanceOf(AIGenerationError);
    expect(extractProviderErrorMessage(new Error('boom'))).toBe('boom');
  });
});
```

- [ ] **Step 2: Jalankan test — pastikan gagal**

Run: `npx vitest run tests/unit/ai/errors.test.ts`
Expected: FAIL — module `src/ai/errors` tidak ada.

- [ ] **Step 3: Implementasi `src/ai/errors.ts`**

```ts
import { AIGenerationError, AppError, ProviderError, TimeoutError } from '../errors';

interface ProviderErrorResponse {
  status?: number;
  error?: {
    metadata?: {
      raw?: string;
    };
  };
}

export function isProviderError(error: unknown): boolean {
  if (error instanceof ProviderError) {
    return true;
  }
  if (error instanceof AppError) {
    return false;
  }
  if (error instanceof Error) {
    const providerError = error as ProviderErrorResponse;
    return (
      error.message.includes('Provider returned error') ||
      error.message.includes('502') ||
      providerError.status === 502
    );
  }
  return false;
}

export function extractProviderErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const providerError = error as ProviderErrorResponse;
    if (providerError.error?.metadata?.raw) {
      return `${error.message}: ${providerError.error.metadata.raw}`;
    }
    return error.message;
  }
  return 'Provider error';
}

/** Maps a provider/runtime failure to the application's AI error taxonomy. */
export function toAiError(error: unknown, context: { abortSignal?: AbortSignal } = {}): AppError {
  if (error instanceof AppError) {
    return error;
  }
  if (
    context.abortSignal?.aborted === true ||
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError'))
  ) {
    return new TimeoutError();
  }
  if (isProviderError(error)) {
    return new ProviderError(extractProviderErrorMessage(error));
  }
  const message =
    error instanceof Error && error.message.trim().length > 0 ? error.message : 'AI request failed';
  return new AIGenerationError(message);
}
```

- [ ] **Step 4: Jalankan test — pastikan pass**

Run: `npx vitest run tests/unit/ai/errors.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Tulis test yang gagal — `tests/unit/utils/grid-detection.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { gridDetectionOutputSchema } from '../../../src/utils/grid-detection';

describe('gridDetectionOutputSchema', () => {
  it('accepts a rows x cols layout with positive boundaries', () => {
    const result = gridDetectionOutputSchema.safeParse({
      gridLayout: '2x2',
      boundaries: [
        { x: 0, y: 0, width: 100, height: 100 },
        { x: 100, y: 0, width: 100, height: 100 },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a layout without the RxC form', () => {
    expect(
      gridDetectionOutputSchema.safeParse({ gridLayout: 'grid', boundaries: [{ x: 0, y: 0, width: 1, height: 1 }] })
        .success
    ).toBe(false);
  });

  it('rejects empty boundaries and non-positive sizes', () => {
    expect(gridDetectionOutputSchema.safeParse({ gridLayout: '2x2', boundaries: [] }).success).toBe(false);
    expect(
      gridDetectionOutputSchema.safeParse({
        gridLayout: '2x2',
        boundaries: [{ x: 0, y: 0, width: 0, height: 10 }],
      }).success
    ).toBe(false);
  });
});
```

- [ ] **Step 6: Jalankan test — pastikan gagal, lalu implementasi `src/utils/grid-detection.ts`**

Run: `npx vitest run tests/unit/utils/grid-detection.test.ts` → Expected: FAIL (module tidak ada)

```ts
import { z } from 'zod';
import type { GridDetectionResult } from '../types';

/** Model-facing schema for AI grid boundary detection (validated locally by Anvia too). */
export const gridDetectionOutputSchema: z.ZodType<GridDetectionResult> = z.object({
  gridLayout: z.string().trim().regex(/^\d{1,2}\s*[x×]\s*\d{1,2}$/i),
  boundaries: z
    .array(
      z.object({
        x: z.number().int().nonnegative(),
        y: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
    )
    .min(1),
});
```

Run: `npx vitest run tests/unit/utils/grid-detection.test.ts` → Expected: PASS (3 tests)

- [ ] **Step 7: Tulis test yang gagal — tambahan `tests/unit/utils/improvement.test.ts`**

Tambahkan di dalam `describe('improvement utils')` yang ada:

```ts
  it('normalizes an object plan from structured output', () => {
    const result = normalizeImprovementPromptPlan(
      {
        improvementPrompt: 'Polish the sticker.',
        textAssetDecoration: {
          text: 'Hi',
          style: { fontFamily: 'serif', color: '#000000', weight: 'bold' },
        },
      },
      { allowTextAssetDecoration: true }
    );

    expect(result).toEqual({
      improvementPrompt: 'Polish the sticker.',
      textAssetDecoration: {
        text: 'Hi',
        style: { fontFamily: 'serif', color: '#000000', weight: 'bold' },
        source: 'detected',
      },
    });
  });

  it('throws when the structured output has no improvementPrompt', () => {
    expect(() => normalizeImprovementPromptPlan({}, { allowTextAssetDecoration: false })).toThrow(
      'Improvement agent did not return improvementPrompt'
    );
  });
```

- [ ] **Step 8: Jalankan — pastikan gagal, lalu modifikasi `src/utils/improvement.ts`**

Run: `npx vitest run tests/unit/utils/improvement.test.ts` → Expected: FAIL (`normalizeImprovementPromptPlan` menerima object? type error/behavior salah)

Tambahkan di atas file (setelah imports):

```ts
import { z } from 'zod';
```

Tambahkan schema tepat sebelum `normalizeImprovementPromptPlan`:

```ts
/** Model-facing schema for the improvement prompt planner (validated by Anvia before returning). */
export const improvementPlanOutputSchema = z.object({
  improvementPrompt: z.string().trim().min(1).max(4000),
  textAssetDecoration: z
    .object({
      text: z.string().trim().min(1).max(64),
      style: z.object({
        fontFamily: z.string().trim().min(1).max(80),
        color: z.string().trim().min(1).max(40),
        weight: z.string().trim().min(1).max(40),
      }),
    })
    .optional(),
});
```

Ubah `normalizeImprovementPromptPlan` menjadi menerima `unknown` (string tetap didukung untuk kompatibilitas):

```ts
export function normalizeImprovementPromptPlan(
  content: unknown,
  options: { allowTextAssetDecoration: boolean }
): ImprovementPromptPlan {
  const parsed =
    typeof content === 'string'
      ? parseJsonObject(content)
      : isRecord(content)
        ? content
        : {};

  const prompt =
    typeof parsed.improvementPrompt === 'string'
      ? parsed.improvementPrompt.trim()
      : '';

  if (!prompt) {
    throw new Error('Improvement agent did not return improvementPrompt');
  }
  // ... sisa fungsi TIDAK berubah (buildTextAssetDecoration & return)
```

Dan tambahkan helper di bawah `parseJsonObject`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
```

Run: `npx vitest run tests/unit/utils/improvement.test.ts` → Expected: PASS (5 tests: 2 lama + 1 lama + 2 baru; total menyesuaikan)

- [ ] **Step 9: Tambah schema cell-text — `src/utils/text-asset-decoration.ts` + test**

Tambahkan test di `tests/unit/utils/text-asset-decoration.test.ts`:

```ts
import { cellTextAnalysisOutputSchema } from '../../../src/utils/text-asset-decoration';

// di dalam describe:
  it('validates cell text analysis output and preserves detections', () => {
    const result = cellTextAnalysisOutputSchema.safeParse({
      hasTextOutsideForeground: false,
      textOutsideForeground: [
        { text: '  Hello  ', style: { fontFamily: 'serif', color: '#111111', weight: 'bold' } },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.textOutsideForeground[0].text).toBe('Hello');
    }
  });

  it('rejects malformed detections', () => {
    expect(
      cellTextAnalysisOutputSchema.safeParse({
        hasTextOutsideForeground: 'yes',
        textOutsideForeground: [],
      }).success
    ).toBe(false);
  });
```

Tambahkan di `src/utils/text-asset-decoration.ts` (setelah imports):

```ts
import { z } from 'zod';
```

Tambahkan setelah `DEFAULT_STYLE`:

```ts
/**
 * Model-facing schema for per-cell caption detection. String fields allow empty
 * values on purpose: the service drops incomplete detections (recall-first),
 * matching the previous tolerant parsing behavior.
 */
export const cellTextAnalysisOutputSchema = z.object({
  hasTextOutsideForeground: z.boolean(),
  textOutsideForeground: z
    .array(
      z.object({
        text: z.string().trim().max(120),
        style: z.object({
          fontFamily: z.string().trim().max(80),
          color: z.string().trim().max(40),
          weight: z.string().trim().max(40),
        }),
      })
    )
    .max(16),
});

export type CellTextAnalysisResult = z.infer<typeof cellTextAnalysisOutputSchema>;
export type OutsideForegroundTextDetection = CellTextAnalysisResult['textOutsideForeground'][number];
export type TextStyleMetadata = OutsideForegroundTextDetection['style'];
```

Run: `npx vitest run tests/unit/utils/text-asset-decoration.test.ts` → Expected: PASS

- [ ] **Step 10: Implementasi `src/ai/completion.ts`**

```ts
import type { CompletionModel, StandardSchemaV1, UserMessage } from '@anvia/core';
import {
  getAgentCompletionModel,
  getImprovementCompletionModel,
  getVisionCompletionModel,
} from './openrouter';
import { importEsm } from './esm';
import { toAiError } from './errors';

type AnviaCoreModule = typeof import('@anvia/core');

let corePromise: Promise<AnviaCoreModule> | undefined;

function anviaCore(): Promise<AnviaCoreModule> {
  corePromise ??= importEsm<AnviaCoreModule>('@anvia/core');
  return corePromise;
}

export type CompletionRole = 'agent' | 'vision' | 'improvement';

export interface UserContentImage {
  buffer: Buffer;
  mimeType: string;
}

export interface StructuredCompletionInput<Output> {
  role: CompletionRole;
  instructions: string;
  prompt: string;
  images?: ReadonlyArray<UserContentImage>;
  outputSchema: StandardSchemaV1<unknown, Output>;
  timeoutMs: number;
  temperature?: number;
}

export interface StructuredCompletionUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StructuredCompletionResult<Output> {
  output: Output;
  usage: StructuredCompletionUsage;
  cost?: number;
  latencyMs: number;
}

const MODEL_BY_ROLE: Record<CompletionRole, () => Promise<CompletionModel>> = {
  agent: getAgentCompletionModel,
  vision: getVisionCompletionModel,
  improvement: getImprovementCompletionModel,
};

export function normalizeImageMediaType(mimeType: string): string {
  return /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'image/png';
}

export function buildUserContent(input: {
  text: string;
  images?: ReadonlyArray<UserContentImage>;
}): UserMessage['content'] {
  const content: Array<
    | { type: 'text'; text: string }
    | { type: 'image'; image: { type: 'data'; data: string }; mediaType: string }
  > = [{ type: 'text', text: input.text }];

  for (const image of input.images ?? []) {
    content.push({
      type: 'image',
      image: { type: 'data', data: image.buffer.toString('base64') },
      mediaType: normalizeImageMediaType(image.mimeType),
    });
  }

  return content;
}

export async function generateStructuredCompletion<Output>(
  input: StructuredCompletionInput<Output>
): Promise<StructuredCompletionResult<Output>> {
  const [{ generateCompletion }, model] = await Promise.all([
    anviaCore(),
    MODEL_BY_ROLE[input.role](),
  ]);

  const abortSignal = AbortSignal.timeout(input.timeoutMs);
  const startedAt = Date.now();

  try {
    const result = await generateCompletion({
      model,
      instructions: input.instructions,
      messages: [
        {
          role: 'user',
          content: buildUserContent({ text: input.prompt, images: input.images }),
        },
      ],
      outputSchema: input.outputSchema,
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
      abortSignal,
    });

    const cost = extractOpenRouterCost(result.rawResponse);

    return {
      output: result.output,
      usage: {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
      },
      ...(cost !== undefined ? { cost } : {}),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    throw toAiError(error, { abortSignal });
  }
}

function extractOpenRouterCost(rawResponse: unknown): number | undefined {
  const response = rawResponse as
    | { usage?: { cost?: number }; cost?: number }
    | null
    | undefined;
  return response?.usage?.cost ?? response?.cost;
}
```

- [ ] **Step 11: Rewrite 3 analisis di `src/services/openrouter.service.ts`**

Lakukan perubahan berikut pada file (bagian lain yang tidak disebut TIDAK diubah):

1. Sisipkan impor baru setelah impor `sharp`:

```ts
import { buildUserContent, generateStructuredCompletion } from '../ai/completion';
import { gridDetectionOutputSchema } from '../utils/grid-detection';
import {
  cellTextAnalysisOutputSchema,
  type CellTextAnalysisResult,
  type OutsideForegroundTextDetection,
  type TextStyleMetadata,
} from '../utils/text-asset-decoration';
```

2. Impor `normalizeImprovementPromptPlan` **tetap dipertahankan** (masih dipakai). Tambahkan `improvementPlanOutputSchema` ke blok impor dari `../utils/improvement`.

3. Hapus interface `ChatMessage` dan `ChatCompletionOptions` (baris ~18–28).

4. Hapus interface lokal `TextStyleMetadata`, `OutsideForegroundTextDetection`, `CellTextAnalysisResult` (baris ~54–68) dan ganti dengan re-export:

```ts
export type { TextStyleMetadata, OutsideForegroundTextDetection, CellTextAnalysisResult } from '../utils/text-asset-decoration';
```

5. Hapus method `chatCompletion` sepenuhnya (baris ~87–154).

6. Ganti seluruh method `buildImprovementPrompt` dengan:

```ts
  async buildImprovementPrompt(
    images: ImageGenerationInput[],
    mode: 'single' | 'grid'
  ): Promise<{
    plan: ImprovementPromptPlan;
    metadata: {
      tokensPrompt?: number;
      tokensCompletion?: number;
      cost?: number;
      latencyMs?: number;
    };
  }> {
    const { output, usage, cost, latencyMs } = await generateStructuredCompletion({
      role: 'improvement',
      instructions:
        'You are a senior sticker art director and prompt engineer. Return ONLY JSON. Do not include markdown.',
      prompt:
        mode === 'single'
          ? this.buildSingleImprovementAgentPrompt()
          : this.buildGridImprovementAgentPrompt(images.length),
      images,
      outputSchema: improvementPlanOutputSchema,
      timeoutMs: 45000,
    });

    return {
      plan: normalizeImprovementPromptPlan(output, {
        allowTextAssetDecoration: mode === 'single',
      }),
      metadata: {
        tokensPrompt: usage.inputTokens,
        tokensCompletion: usage.outputTokens,
        cost,
        latencyMs,
      },
    };
  }
```

(`buildSingleImprovementAgentPrompt` & `buildGridImprovementAgentPrompt` tetap verbatim.)

7. Ganti method `analyzeCellTextOutsideForeground` beserta `normalizeCellTextAnalysis` dengan:

```ts
  private static readonly CELL_TEXT_INSTRUCTIONS =
    'You are a visual text extraction assistant for sticker cells. Return ONLY JSON. Do not include markdown.';

  private static readonly CELL_TEXT_PRIMARY_PROMPT = `Analyze this single sticker-grid cell image.

Task:
- Detect every caption/word that is visually outside the main foreground subject (usually the person/object cutout).
- Text around the subject on empty/background area counts as outside foreground and must be included.
- Text drawn on top of the subject itself (face/body/object) must NOT be included.

Return exact JSON:
{
  "hasTextOutsideForeground": boolean,
  "textOutsideForeground": [
    {
      "text": "string",
      "style": {
        "fontFamily": "string",
        "color": "string",
        "weight": "string"
      }
    }
  ]
}

Style metadata:
- fontFamily: best estimate such as "sans-serif", "serif", "script", "display", "monospace".
- color: dominant text color in hex when possible (e.g. "#FFAA00"), otherwise color name.
- weight: one of "light", "regular", "medium", "semibold", "bold", "heavy".

Rules:
- Prioritize recall for outside-foreground captions.
- Keep textOutsideForeground empty only when truly no outside text exists.
- No additional keys.`;

  private static readonly CELL_TEXT_FALLBACK_PROMPT = `Second pass OCR check for this sticker cell.

If there is ANY readable caption text around (not covering the face/body main subject), return it.
If no such text exists, return an empty list.

Return exact JSON only:
{
  "hasTextOutsideForeground": boolean,
  "textOutsideForeground": [
    {
      "text": "string",
      "style": {
        "fontFamily": "string",
        "color": "string",
        "weight": "string"
      }
    }
  ]
}`;

  async analyzeCellTextOutsideForeground(imageBuffer: Buffer): Promise<CellTextAnalysisResult> {
    const images = [{ buffer: imageBuffer, mimeType: 'image/png' }];

    const primary = await generateStructuredCompletion({
      role: 'vision',
      instructions: OpenRouterService.CELL_TEXT_INSTRUCTIONS,
      prompt: OpenRouterService.CELL_TEXT_PRIMARY_PROMPT,
      images,
      outputSchema: cellTextAnalysisOutputSchema,
      timeoutMs: 20000,
    });

    const primaryResult = this.reconcileCellTextAnalysis(primary.output);
    if (primaryResult.textOutsideForeground.length > 0) {
      return primaryResult;
    }

    const fallback = await generateStructuredCompletion({
      role: 'vision',
      instructions: OpenRouterService.CELL_TEXT_INSTRUCTIONS,
      prompt: OpenRouterService.CELL_TEXT_FALLBACK_PROMPT,
      images,
      outputSchema: cellTextAnalysisOutputSchema,
      timeoutMs: 20000,
    });

    return this.reconcileCellTextAnalysis(fallback.output);
  }

  private reconcileCellTextAnalysis(output: CellTextAnalysisResult): CellTextAnalysisResult {
    const items = output.textOutsideForeground
      .map((item) => ({
        text: item.text.trim(),
        style: {
          fontFamily: item.style.fontFamily.trim(),
          color: item.style.color.trim(),
          weight: item.style.weight.trim(),
        },
      }))
      .filter(
        (item) =>
          Boolean(item.text) &&
          Boolean(item.style.fontFamily) &&
          Boolean(item.style.color) &&
          Boolean(item.style.weight)
      );

    return {
      hasTextOutsideForeground: output.hasTextOutsideForeground || items.length > 0,
      textOutsideForeground: items,
    };
  }
```

8. Ganti blok AI call di `detectGridBoundaries` (bagian `// Coba AI detection dulu`) dengan:

```ts
    // Coba AI detection dulu
    try {
      const { output } = await generateStructuredCompletion({
        role: 'vision',
        instructions:
          'You are an image analysis assistant. Analyze grid images and identify cell boundaries. You must detect ALL cells including those with stickers/images and text overlays. Account for padding and gaps between cells. Return ONLY a JSON object.',
        prompt: `Analyze this grid image carefully. The image contains a grid layout with multiple cells arranged in rows and columns.

IMPORTANT INSTRUCTIONS:
1. Count the total number of rows and columns
2. Identify the boundaries of EACH individual cell
3. Include the FULL cell area including any white space, borders, or gaps between cells
4. Do NOT crop too tightly - include some margin around each cell content
5. Return exact pixel coordinates based on the image dimensions

Return a JSON object with this exact format:
{
  "gridLayout": "ROWSxCOLS",
  "boundaries": [
    { "x": 0, "y": 0, "width": 100, "height": 100 },
    ...
  ]
}

Make sure boundaries cover the ENTIRE image without gaps or overlaps.`,
        images: [{ buffer: Buffer.from(imageBase64, 'base64'), mimeType: 'image/png' }],
        outputSchema: gridDetectionOutputSchema,
        timeoutMs: 30000,
      });

      this.validateBoundaries(output.boundaries);

      // Validasi: cek apakah boundaries cover gambar dengan baik
      if (imageWidth && imageHeight) {
        const isValid = this.validateGridCoverage(output.boundaries, imageWidth, imageHeight);
        if (!isValid) {
          throw new Error('Grid coverage invalid');
        }
      }

      return output;
    } catch (aiError) {
      // ... blok fallback existing TIDAK berubah
```

Hapus juga import `OpenAI` mentah HANYA jika masih dipakai method image (Task 4 akan menghapusnya) — pada task ini `import OpenAI from 'openai'` MASIH DIPAKAI `generateImageWithInputs`, JANGAN dihapus.

- [ ] **Step 12: Verifikasi penuh**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS — termasuk `grid-split.service.test.ts` (stub tidak berubah) dan semua test util.

- [ ] **Step 13: Smoke live 3 analisis — `scripts/tmp-analyses-smoke.ts` (temporary)**

```ts
import sharp from 'sharp';
import { OpenRouterService } from '../src/services/openrouter.service';

async function main(): Promise<void> {
  const service = new OpenRouterService();

  const cellPng = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 240, g: 240, b: 240 } },
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="256" height="256"><text x="20" y="220" font-size="36" fill="#111111">HELLO</text></svg>`
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();

  const improvement = await service.buildImprovementPrompt(
    [{ buffer: cellPng, mimeType: 'image/png' }],
    'single'
  );
  console.log('improvementPrompt:', improvement.plan.improvementPrompt.slice(0, 120));
  console.log('improvement metadata:', improvement.metadata);

  const cellText = await service.analyzeCellTextOutsideForeground(cellPng);
  console.log('cellText:', JSON.stringify(cellText));

  const gridPng = await sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite(
      [0, 1].flatMap((row) =>
        [0, 1].map((col) => ({
          input: Buffer.from(
            `<svg width="230" height="230"><rect width="230" height="230" fill="#f2b" /><circle cx="115" cy="115" r="60" fill="#333"/></svg>`
          ),
          top: row * 256 + 13,
          left: col * 256 + 13,
        }))
      )
    )
    .png()
    .toBuffer();

  const detection = await service.detectGridBoundaries(gridPng.toString('base64'), 512, 512);
  console.log('detection:', JSON.stringify(detection).slice(0, 300));
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error);
  process.exitCode = 1;
});
```

Run: `npx tsx scripts/tmp-analyses-smoke.ts`
Expected: `improvementPrompt` non-kosong; `cellText` adalah struktur valid `{ hasTextOutsideForeground, textOutsideForeground }` (boleh kosong bila model tidak menemukan caption, yang penting tidak error); `detection` memberi `{ gridLayout: '2x2', boundaries: [...] }`.

- [ ] **Step 14: Hapus script smoke, commit**

Run: `Remove-Item scripts/tmp-analyses-smoke.ts`
Run: `git status --short` → Expected: hanya file src/test yang relevan.

```bash
git add src/ai/errors.ts src/ai/completion.ts src/utils/grid-detection.ts src/utils/improvement.ts src/utils/text-asset-decoration.ts src/services/openrouter.service.ts tests/unit/ai/errors.test.ts tests/unit/utils/grid-detection.test.ts tests/unit/utils/improvement.test.ts tests/unit/utils/text-asset-decoration.test.ts
git commit -m "feat(ai): migrate vision analyses to Anvia parsed completions with zod output schemas"
```

---

### Task 4: Adapter image generation OpenRouter + migrasi image gen

**Files:**
- Create: `src/ai/openrouter-image.ts`
- Test: `tests/unit/ai/openrouter-image.test.ts`
- Modify: `src/services/openrouter.service.ts`
- Temporary (dihapus): `scripts/tmp-image-smoke.ts`

**Interfaces:**
- Consumes: `OPENROUTER_BASE_URL` (Task 2), `toAiError`, `isProviderError` (Task 3).
- Produces:
  - `getOpenRouterImageModel(modelId: string): ImageGenerationModel<unknown>` (Object kontrak Anvia; dipakai `generateImage`)
  - `buildReferenceImagesProviderOptions(images: ReadonlyArray<{ base64: string; mimeType: string }>): JsonObject | undefined`
  - `extractImagesFromAssistantMessage(message: unknown): Promise<readonly [GeneratedImage, ...GeneratedImage[]]>`

- [ ] **Step 1: Tulis test yang gagal — `tests/unit/ai/openrouter-image.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractImagesFromAssistantMessage } from '../../../src/ai/openrouter-image';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('extractImagesFromAssistantMessage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('decodes a data URL image from message.images', async () => {
    const images = await extractImagesFromAssistantMessage({
      images: [{ image_url: { url: `data:image/png;base64,${PNG_BASE64}` } }],
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('decodes b64_json fields', async () => {
    const images = await extractImagesFromAssistantMessage({
      images: [{ b64_json: PNG_BASE64 }],
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('fetches http image URLs', async () => {
    const bytes = Buffer.from(PNG_BASE64, 'base64');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 }))
    );
    const images = await extractImagesFromAssistantMessage({
      images: [{ image_url: { url: 'https://example.com/image.png' } }],
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('decodes markdown image URLs inside content strings', async () => {
    const bytes = Buffer.from(PNG_BASE64, 'base64');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(bytes, { status: 200 }))
    );
    const images = await extractImagesFromAssistantMessage({
      content: `Here is your sticker: ![sticker](https://example.com/sticker.png)`,
    });
    expect(Buffer.from(images[0].data).toString('base64')).toBe(PNG_BASE64);
  });

  it('throws AIGenerationError when no image can be decoded', async () => {
    await expect(extractImagesFromAssistantMessage({ content: 'no image here' })).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });
});
```

- [ ] **Step 2: Jalankan — pastikan gagal**

Run: `npx vitest run tests/unit/ai/openrouter-image.test.ts`
Expected: FAIL — module tidak ada.

- [ ] **Step 3: Implementasi `src/ai/openrouter-image.ts`**

```ts
import OpenAI from 'openai';
import type {
  GeneratedImage,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  JsonObject,
  ModelCallOptions,
} from '@anvia/core';
import { config } from '../config';
import { AIGenerationError } from '../errors';
import { toAiError } from './errors';
import { OPENROUTER_BASE_URL } from './openrouter';

export interface ReferenceImageInput {
  base64: string;
  mimeType: string;
}

const REFERENCE_IMAGES_KEY = 'referenceImages';

let imageClient: OpenAI | undefined;

function getImageClient(): OpenAI {
  imageClient ??= new OpenAI({
    baseURL: OPENROUTER_BASE_URL,
    apiKey: config.openRouterApiKey,
    defaultHeaders: {
      'HTTP-Referer': config.appUrl,
      'X-Title': 'Setiker API',
    },
    timeout: 60000,
  });
  return imageClient;
}

export function buildReferenceImagesProviderOptions(
  images: ReadonlyArray<ReferenceImageInput>
): JsonObject | undefined {
  if (images.length === 0) {
    return undefined;
  }
  return {
    [REFERENCE_IMAGES_KEY]: images.map((image) => ({
      base64: image.base64,
      mimeType: image.mimeType,
    })),
  };
}

function readReferenceImages(providerOptions: JsonObject | undefined): ReferenceImageInput[] {
  const raw = providerOptions?.[REFERENCE_IMAGES_KEY];
  if (!Array.isArray(raw)) {
    return [];
  }
  const images: ReferenceImageInput[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    if (typeof record.base64 === 'string' && typeof record.mimeType === 'string') {
      images.push({ base64: record.base64, mimeType: record.mimeType });
    }
  }
  return images;
}

const imageModelCache = new Map<string, ImageGenerationModel<unknown>>();

/**
 * Anvia ImageGenerationModel backed by OpenRouter's chat-image models
 * (image output arrives in `message.images[]` of a chat completion).
 */
export function getOpenRouterImageModel(modelId: string): ImageGenerationModel<unknown> {
  const cached = imageModelCache.get(modelId);
  if (cached !== undefined) {
    return cached;
  }

  const model: ImageGenerationModel<unknown> = {
    provider: 'openrouter',
    modelId,
    async imageGeneration(
      request: ImageGenerationRequest,
      options?: ModelCallOptions
    ): Promise<ImageGenerationResult<unknown>> {
      const referenceImages = readReferenceImages(request.providerOptions);
      const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
        { type: 'text', text: request.prompt },
      ];
      for (const image of referenceImages) {
        const mime = /^image\/[a-z0-9.+-]+$/i.test(image.mimeType)
          ? image.mimeType
          : 'image/png';
        content.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${image.base64}` },
        });
      }

      try {
        const response = await getImageClient().chat.completions.create(
          {
            model: modelId,
            messages: [
              {
                role: 'user',
                content: content as unknown as OpenAI.Chat.Completions.ChatCompletionContentPart[],
              },
            ],
          },
          { signal: options?.abortSignal, maxRetries: 0 }
        );

        const message = response.choices[0]?.message;
        const images = await extractImagesFromAssistantMessage(message);

        return { images, rawResponse: response };
      } catch (error) {
        throw toAiError(error, { abortSignal: options?.abortSignal });
      }
    },
  };

  imageModelCache.set(modelId, model);
  return model;
}

/**
 * Decodes image payloads from an OpenRouter chat-image assistant message:
 * `images[]` entries (data URL / raw base64 / b64_json / http URL) and
 * markdown/data-URL images embedded in `content` strings.
 */
export async function extractImagesFromAssistantMessage(
  message: unknown
): Promise<readonly [GeneratedImage, ...GeneratedImage[]]> {
  const assistantMsg = message as {
    images?: unknown;
    content?: unknown;
  };

  const decodeCandidates = async (value: unknown): Promise<Buffer | null> => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'string') {
      return tryDecodeFromString(value);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const fromItem = await decodeCandidates(item);
        if (fromItem) {
          return fromItem;
        }
      }
      return null;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const directFields = [
        obj.image_url,
        obj.url,
        obj.b64_json,
        obj.image_base64,
        obj.base64,
        obj.data,
      ];
      for (const field of directFields) {
        const fromField = await decodeCandidates(field);
        if (fromField) {
          return fromField;
        }
      }
    }
    return null;
  };

  const fromImages = await decodeCandidates(assistantMsg.images);
  if (fromImages) {
    return [{ data: fromImages, mediaType: 'image/png' }];
  }

  const fromContent = await decodeCandidates(assistantMsg.content);
  if (fromContent) {
    return [{ data: fromContent, mediaType: 'image/png' }];
  }

  throw new AIGenerationError('No image data in response');
}

async function tryDecodeFromString(value: string): Promise<Buffer | null> {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('data:image')) {
    return decodeImageUrl(trimmed);
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return decodeImageUrl(trimmed);
  }

  const dataUriMatch = trimmed.match(/data:image\/[^;]+;base64,([^"\s)]+)/i);
  if (dataUriMatch?.[1]) {
    return Buffer.from(dataUriMatch[1], 'base64');
  }

  const markdownUrlMatch = trimmed.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownUrlMatch?.[1]) {
    return decodeImageUrl(markdownUrlMatch[1]);
  }

  if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length > 128) {
    try {
      return Buffer.from(trimmed, 'base64');
    } catch {
      return null;
    }
  }

  return null;
}

async function decodeImageUrl(url: string): Promise<Buffer> {
  if (url.startsWith('data:image')) {
    const match = url.match(/data:image\/[^;]+;base64,([^"\s]+)/);
    if (match?.[1]) {
      return Buffer.from(match[1], 'base64');
    }
    throw new AIGenerationError('Invalid base64 image data');
  }

  if (/^https?:\/\//i.test(url)) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new AIGenerationError(`Failed to fetch generated image URL: ${response.status}`);
    }
    const bytes = await response.arrayBuffer();
    return Buffer.from(bytes);
  }

  throw new AIGenerationError('Unsupported image URL format');
}
```

- [ ] **Step 4: Jalankan test — pastikan pass**

Run: `npx vitest run tests/unit/ai/openrouter-image.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Migrasi method image di `src/services/openrouter.service.ts`**

1. Sisipkan impor runtime yang dibutuhkan (`generateImage` adalah value ESM dari `@anvia/core` — harus lewat `importEsm`, bukan `import` statis):

```ts
import { importEsm } from '../ai/esm';
import {
  buildReferenceImagesProviderOptions,
  getOpenRouterImageModel,
} from '../ai/openrouter-image';
import { isProviderError } from '../ai/errors';

type AnviaCoreModule = typeof import('@anvia/core');
let corePromise: Promise<AnviaCoreModule> | undefined;
function anviaCore(): Promise<AnviaCoreModule> {
  corePromise ??= importEsm<AnviaCoreModule>('@anvia/core');
  return corePromise;
}
```

2. Ganti `generateImage` dan `generateImageWithInputs` dengan:

```ts
  async generateImage(
    prompt: string,
    base64Image?: string,
    imageMimeType: string = 'image/png',
    model: string = config.models.imageGeneration,
    allowTextOnlyFallback: boolean = true
  ): Promise<GenerationResult> {
    const images = base64Image
      ? [{ base64: base64Image, mimeType: imageMimeType }]
      : [];

    return this.generateImageWithInputs(prompt, images, model, allowTextOnlyFallback);
  }

  async generateImageWithInputs(
    prompt: string,
    images: Array<{ base64: string; mimeType: string }> = [],
    model: string = config.models.imageGeneration,
    allowTextOnlyFallback: boolean = true
  ): Promise<GenerationResult> {
    const startedAt = Date.now();

    const run = async (referenceImages: Array<{ base64: string; mimeType: string }>) => {
      const { generateImage } = await anviaCore();
      return generateImage({
        model: getOpenRouterImageModel(model),
        prompt,
        width: 1024,
        height: 1024,
        ...(referenceImages.length > 0
          ? { providerOptions: buildReferenceImagesProviderOptions(referenceImages) }
          : {}),
        abortSignal: AbortSignal.timeout(this.defaultTimeout),
      });
    };

    try {
      const result = await run(images);
      return this.toGenerationResult(result.rawResponse, result.images[0], startedAt);
    } catch (error) {
      if (allowTextOnlyFallback && images.length > 0 && isProviderError(error)) {
        logger.warn('Image input not supported, falling back to text-only');
        const result = await run([]);
        return this.toGenerationResult(result.rawResponse, result.images[0], startedAt);
      }
      if (error instanceof TimeoutError || error instanceof AIGenerationError) {
        throw error;
      }
      if (isProviderError(error)) {
        throw new ProviderError(error instanceof Error ? error.message : 'Provider error');
      }
      throw new AIGenerationError(
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  private toGenerationResult(
    rawResponse: unknown,
    image: { data: Uint8Array; mediaType?: string | undefined },
    startedAt: number
  ): GenerationResult {
    const response = rawResponse as {
      id?: string;
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    return {
      imageBuffer: Buffer.from(image.data),
      generationId: response.id ?? '',
      metadata: {
        tokensPrompt: response.usage?.prompt_tokens,
        tokensCompletion: response.usage?.completion_tokens,
        cost: response.usage?.cost,
        latencyMs: Date.now() - startedAt,
      },
    };
  }
```

3. Ganti body `normalizeGridImage` agar memakai jalur baru (tetap fallback text-only default true — perilaku lama memakai `generateImage` default):

```ts
  async normalizeGridImage(
    imageBase64: string,
    gridLayout: string,
    targetWidth: number,
    targetHeight: number
  ): Promise<Buffer> {
    const prompt = `You are normalizing a sticker grid image for precise automated splitting.
... (prompt lama VERBATIM tidak berubah) ...
`;

    const { imageBuffer } = await this.generateImage(prompt, imageBase64);

    return sharp(imageBuffer)
      .resize(targetWidth, targetHeight, {
        fit: 'fill',
      })
      .png()
      .toBuffer();
  }
```

4. Hapus yang sudah tidak dipakai: method `extractImageFromMessage`, `tryDecodeFromString`, `decodeImageUrl`, `isProviderError`, `extractProviderErrorMessage`, interface `ExtractedImage`, interface `ProviderErrorResponse` (logika mereka sudah pindah ke `src/ai/openrouter-image.ts` + `src/ai/errors.ts`).

5. Hapus impor `import OpenAI from 'openai';` dari service (satu-satunya pemakai kini adapter).

- [ ] **Step 6: Verifikasi penuh**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 7: Smoke live image gen — `scripts/tmp-image-smoke.ts` (temporary)**

```ts
import sharp from 'sharp';
import { OpenRouterService } from '../src/services/openrouter.service';

async function main(): Promise<void> {
  const service = new OpenRouterService();

  const pure = await service.generateImageWithInputs(
    'A cute red cartoon cat face sticker with transparent background'
  );
  console.log('pure bytes:', pure.imageBuffer.length, 'metadata:', pure.metadata);

  const input = await sharp({
    create: { width: 256, height: 256, channels: 3, background: { r: 20, g: 120, b: 220 } },
  })
    .png()
    .toBuffer();

  const withInput = await service.generateImageWithInputs(
    'Turn this into a sticker, keep the blue color',
    [{ base64: input.toString('base64'), mimeType: 'image/png' }]
  );
  console.log('with-input bytes:', withInput.imageBuffer.length, 'metadata:', withInput.metadata);
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error);
  process.exitCode = 1;
});
```

- [ ] **Step 8: Jalankan smoke**

Run: `npx tsx scripts/tmp-image-smoke.ts`
Expected: dua baris output dengan `bytes` > 1000 dan metadata token terisi (cost bila disediakan OpenRouter).

- [ ] **Step 9: Hapus script smoke, commit**

Run: `Remove-Item scripts/tmp-image-smoke.ts`

```bash
git add src/ai/openrouter-image.ts src/services/openrouter.service.ts tests/unit/ai/openrouter-image.test.ts
git commit -m "feat(ai): migrate image generation to Anvia ImageGenerationModel with OpenRouter adapter"
```

---

### Task 5: Tracing Langfuse + agent factory + rewrite service agent

**Files:**
- Create: `src/ai/tracing.ts`
- Create: `src/ai/video-sticker-pack-agent.ts`
- Test: `tests/unit/ai/tracing.test.ts`
- Modify: `tests/setup.ts`
- Modify: `src/services/video-sticker-pack-agent.service.ts` (rewrite penuh)
- Modify: `src/controllers/generate.controller.ts` (userId)
- Modify: `src/server.ts` (shutdown)
- Modify: `tests/unit/services/video-sticker-pack-agent.service.test.ts` (rewrite)
- Temporary (dihapus): `scripts/tmp-agent-smoke.ts`

**Interfaces:**
- Consumes: `config.langfuse` (Task 1), `importEsm` (Task 2), `buildUserContent` (Task 3), `toAiError` (Task 3).
- Produces:
  - `getLangfuseObserver(): Promise<AgentObserver | null>`, `flushAiTracing(): Promise<void>`, `closeAiTracing(): Promise<void>`
  - `VIDEO_STICKER_PACK_AGENT_ID = 'video-sticker-pack'`
  - `createVideoStickerPackAgent(input: VideoStickerPackAgentInput): Promise<Agent<VideoStickerPackPlan>>`
  - `buildVideoStickerPackAgentUserMessage(input: VideoStickerPackAgentInput): UserMessage`
  - `VideoStickerPackAgentInput` (pindah dari service)

- [ ] **Step 1: Edit `tests/setup.ts` — pastikan env Langfuse tidak bocor dari shell**

Tambahkan setelah baris `process.env.IMGLY_BG_ENABLED = 'false';`:

```ts
delete process.env.LANGFUSE_PUBLIC_KEY;
delete process.env.LANGFUSE_SECRET_KEY;
delete process.env.LANGFUSE_BASE_URL;
```

- [ ] **Step 2: Tulis test yang gagal — `tests/unit/ai/tracing.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { closeAiTracing, flushAiTracing, getLangfuseObserver } from '../../../src/ai/tracing';

describe('AI tracing without Langfuse credentials', () => {
  it('returns a null observer and resolves flush/close as no-ops', async () => {
    expect(await getLangfuseObserver()).toBeNull();
    await expect(flushAiTracing()).resolves.toBeUndefined();
    await expect(closeAiTracing()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Jalankan — pastikan gagal, lalu implementasi `src/ai/tracing.ts`**

Run: `npx vitest run tests/unit/ai/tracing.test.ts` → Expected: FAIL (module tidak ada)

```ts
import { config } from '../config';
import { importEsm } from './esm';

type AnviaLangfuseModule = typeof import('@anvia/langfuse');
type LangfuseClientHandle = InstanceType<AnviaLangfuseModule['LangfuseClient']>;
type LangfuseObserverHandle = ReturnType<LangfuseClientHandle['observer']>;

function tracingEnabled(): boolean {
  return config.langfuse.publicKey.length > 0 && config.langfuse.secretKey.length > 0;
}

let clientPromise: Promise<LangfuseClientHandle | null> | undefined;

function getClient(): Promise<LangfuseClientHandle | null> {
  if (!tracingEnabled()) {
    return Promise.resolve(null);
  }
  clientPromise ??= importEsm<AnviaLangfuseModule>('@anvia/langfuse').then(
    ({ LangfuseClient }) =>
      new LangfuseClient({
        publicKey: config.langfuse.publicKey,
        secretKey: config.langfuse.secretKey,
        ...(config.langfuse.baseUrl.length > 0 ? { baseUrl: config.langfuse.baseUrl } : {}),
        environment: config.nodeEnv,
      })
  );
  return clientPromise;
}

let observerPromise: Promise<LangfuseObserverHandle | null> | undefined;

/** Langfuse AgentObserver, or null when credentials are not configured. */
export function getLangfuseObserver(): Promise<LangfuseObserverHandle | null> {
  observerPromise ??= getClient().then((client) =>
    client ? client.observer({ captureMode: 'safe' }) : null
  );
  return observerPromise;
}

/** Flushes queued traces; safe to call when tracing is disabled. */
export async function flushAiTracing(): Promise<void> {
  const client = await (clientPromise ?? Promise.resolve(null));
  if (client) {
    await client.flush();
  }
}

let closePromise: Promise<void> | null = null;

/** Flushes and closes the tracing client once; safe when tracing is disabled. */
export function closeAiTracing(): Promise<void> {
  closePromise ??= (async () => {
    const client = await (clientPromise ?? Promise.resolve(null));
    if (client) {
      await client.close();
    }
  })();
  return closePromise;
}
```

Run: `npx vitest run tests/unit/ai/tracing.test.ts` → Expected: PASS

- [ ] **Step 4: Implementasi `src/ai/video-sticker-pack-agent.ts`**

```ts
import { z } from 'zod';
import type { Agent as AnviaAgent, AnyTool, UserMessage } from '@anvia/core';
import { importEsm } from './esm';
import { getAgentCompletionModel } from './openrouter';
import { getLangfuseObserver } from './tracing';
import { buildUserContent } from './completion';

export const VIDEO_STICKER_PACK_AGENT_ID = 'video-sticker-pack';

export interface VideoStickerPackAgentInput {
  candidateGrids: Array<{
    buffer: Buffer;
    mimeType: string;
  }>;
  candidates: VideoStickerCandidate[];
  selectedStartMs: number;
  selectedEndMs: number;
  sourceDurationMs?: number;
  prompt?: string;
  maxStaticStickers?: number;
  maxAnimatedStickers?: number;
}
```

(Tambahkan impor util yang dibutuhkan:)

```ts
import {
  VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT,
  VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT,
  rankStaticCandidates,
  proposeAnimatedLoops,
  validatePlanForRequest,
  videoStickerPackPlanSchema,
  type VideoStickerCandidate,
  type VideoStickerPackPlan,
} from '../utils/video-sticker-pack';
```

```ts
type AnviaCoreModule = typeof import('@anvia/core');

let corePromise: Promise<AnviaCoreModule> | undefined;

function anviaCore(): Promise<AnviaCoreModule> {
  corePromise ??= importEsm<AnviaCoreModule>('@anvia/core');
  return corePromise;
}

export async function createVideoStickerPackAgent(
  input: VideoStickerPackAgentInput
): Promise<AnviaAgent<VideoStickerPackPlan>> {
  const [{ Agent, createTool }, model, observer] = await Promise.all([
    anviaCore(),
    getAgentCompletionModel(),
    getLangfuseObserver(),
  ]);

  const candidateInventory = createTool({
    name: 'read_candidate_inventory',
    description: 'Read all frame candidates and their quality/timestamp metadata.',
    inputSchema: z.object({}),
    execute: () =>
      JSON.stringify({
        candidates: input.candidates,
        selectedStartMs: input.selectedStartMs,
        selectedEndMs: input.selectedEndMs,
        sourceDurationMs: input.sourceDurationMs,
      }),
  });

  const rankClearStaticCandidatesTool = createTool({
    name: 'rank_clear_static_candidates',
    description:
      'Return sharp, bright, visually distinct candidates that are good static sticker choices.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .max(16)
        .default(input.maxStaticStickers ?? VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT),
    }),
    execute: ({ limit }) =>
      JSON.stringify({
        candidates: rankStaticCandidates(input.candidates, limit),
      }),
  });

  const proposeAnimatedLoopsTool = createTool({
    name: 'propose_animated_loops',
    description:
      'Return lightweight timeline proposals made from consecutive frame candidates.',
    inputSchema: z.object({
      limit: z
        .number()
        .int()
        .nonnegative()
        .max(4)
        .default(input.maxAnimatedStickers ?? VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT),
    }),
    execute: ({ limit }) =>
      JSON.stringify({
        loops: proposeAnimatedLoops(input.candidates, limit),
      }),
  });

  const validateStickerPackPlanTool = createTool({
    name: 'validate_sticker_pack_plan',
    description:
      'Validate that a proposed video sticker pack plan references existing candidates and obeys limits.',
    inputSchema: z.object({
      plan: videoStickerPackPlanSchema,
    }),
    execute: ({ plan }) => JSON.stringify(validatePlanForRequest(plan, input.candidates)),
  });

  const tools: AnyTool[] = [
    candidateInventory,
    rankClearStaticCandidatesTool,
    proposeAnimatedLoopsTool,
    validateStickerPackPlanTool,
  ];

  return new Agent({
    id: VIDEO_STICKER_PACK_AGENT_ID,
    model,
    instructions: buildSystemPrompt(input),
    tools,
    outputSchema: videoStickerPackPlanSchema,
    temperature: 0.2,
    maxTokens: 3500,
    maxTurns: 8,
    retries: { maxAttempts: 2 },
    ...(observer
      ? {
          observability: {
            observers: { langfuse: observer },
            primaryTrace: 'langfuse' as const,
          },
        }
      : {}),
  });
}

export function buildVideoStickerPackAgentUserMessage(input: VideoStickerPackAgentInput): UserMessage {
  const stylePrompt = input.prompt?.trim();
  const text = `Create a video sticker pack manifest.

Optional user style prompt: ${stylePrompt && stylePrompt.length > 0 ? stylePrompt : '(none)'}

Selected range: ${input.selectedStartMs}ms to ${input.selectedEndMs}ms.
Source duration: ${input.sourceDurationMs ?? 'unknown'}ms.
Candidate count: ${input.candidates.length}.
Candidate manifest:
${JSON.stringify(input.candidates, null, 2)}`;

  return {
    role: 'user',
    content: buildUserContent({ text, images: input.candidateGrids }),
  };
}

function buildSystemPrompt(input: VideoStickerPackAgentInput): string {
  const maxStatic = input.maxStaticStickers ?? VIDEO_STICKER_PACK_DEFAULT_STATIC_COUNT;
  const maxAnimated = input.maxAnimatedStickers ?? VIDEO_STICKER_PACK_DEFAULT_ANIMATED_COUNT;

  return `You are Setiker's video-to-WhatsApp-sticker art director.

Goal:
- Analyze labeled candidate grid images and metadata.
- Select the best clear frames for static stickers.
- Select short coherent frame timelines for animated stickers only when motion looks useful.
- Return a JSON manifest only. Do not generate or edit images.

Rules:
- Prefer clear, expressive, non-blurry, non-duplicate frames.
- Use candidateId references from metadata exactly.
- Static sticker count target: up to ${maxStatic}.
- Animated sticker count target: up to ${maxAnimated}; use zero animated stickers if no good motion exists.
- Total stickers must be at most 16.
- Animated timelines should be 2-24 frames, ordered by timestamp, and <= 10 seconds total.
- Keep text decorations short and readable. Use bottom-caption placement unless there is a strong reason not to.
- Keep backend work cheap: use the provided tools and visual reasoning; do not ask for image generation.
- Before final answer, call validate_sticker_pack_plan and fix any validation errors.`;
}
```

- [ ] **Step 5: Rewrite penuh `src/services/video-sticker-pack-agent.service.ts`**

```ts
import { config } from '../config';
import { AIGenerationError, ValidationError } from '../errors';
import {
  VIDEO_STICKER_PACK_INPUT_LAYOUT,
  VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
  normalizeVideoStickerPackPlan,
  type VideoStickerPackPlan,
} from '../utils/video-sticker-pack';
import {
  VIDEO_STICKER_PACK_AGENT_ID,
  buildVideoStickerPackAgentUserMessage,
  createVideoStickerPackAgent,
  type VideoStickerPackAgentInput,
} from '../ai/video-sticker-pack-agent';

export type { VideoStickerPackAgentInput } from '../ai/video-sticker-pack-agent';

export interface VideoStickerPackAgentResult {
  plan: VideoStickerPackPlan;
  metadata: {
    model: string;
    mode: 'video-sticker-pack';
    candidateGridCount: number;
    candidateCount: number;
    inputLayout: string;
    outputLayout: string;
    selectedStartMs: number;
    selectedEndMs: number;
    sourceDurationMs?: number;
    tokensPrompt?: number;
    tokensCompletion?: number;
    latencyMs?: number;
  };
}

export class VideoStickerPackAgentService {
  async generatePlan(
    input: VideoStickerPackAgentInput & { userId?: string }
  ): Promise<VideoStickerPackAgentResult> {
    if (!config.openRouterApiKey) {
      throw new ValidationError('OPENROUTER_API_KEY is required for video sticker pack generation');
    }

    const startedAt = Date.now();

    try {
      const agent = await createVideoStickerPackAgent(input);
      const outcome = await agent.generate({
        messages: [buildVideoStickerPackAgentUserMessage(input)],
        trace: {
          name: VIDEO_STICKER_PACK_AGENT_ID,
          ...(input.userId ? { userId: input.userId } : {}),
          metadata: {
            candidateCount: input.candidates.length,
            candidateGridCount: input.candidateGrids.length,
            selectedStartMs: input.selectedStartMs,
            selectedEndMs: input.selectedEndMs,
            ...(input.sourceDurationMs != null
              ? { sourceDurationMs: input.sourceDurationMs }
              : {}),
            hasStylePrompt: Boolean(input.prompt?.trim()),
          },
        },
      });

      if (outcome.type !== 'response') {
        throw new AIGenerationError(
          outcome.type === 'blocked'
            ? `Video sticker pack agent blocked: ${outcome.reason}`
            : 'Video sticker pack agent requires a human interaction'
        );
      }

      const plan = normalizeVideoStickerPackPlan(outcome.output, input.candidates);

      return {
        plan,
        metadata: {
          model: config.models.videoStickerPackAgent,
          mode: 'video-sticker-pack',
          candidateGridCount: input.candidateGrids.length,
          candidateCount: input.candidates.length,
          inputLayout: VIDEO_STICKER_PACK_INPUT_LAYOUT,
          outputLayout: VIDEO_STICKER_PACK_OUTPUT_LAYOUT,
          selectedStartMs: input.selectedStartMs,
          selectedEndMs: input.selectedEndMs,
          ...(input.sourceDurationMs != null ? { sourceDurationMs: input.sourceDurationMs } : {}),
          tokensPrompt: outcome.usage.inputTokens,
          tokensCompletion: outcome.usage.outputTokens,
          latencyMs: Date.now() - startedAt,
        },
      };
    } catch (error) {
      if (error instanceof AIGenerationError) {
        throw error;
      }

      const message =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : 'Video sticker pack agent failed';
      throw new AIGenerationError(message);
    }
  }
}
```

- [ ] **Step 6: Update `src/controllers/generate.controller.ts` — kirim `userId`**

Pada method `generateVideoStickerPack`, tambahkan `userId,` sebagai properti terakhir objek `generatePlan({...})`:

```ts
      const result = await this.videoStickerPackAgentService.generatePlan({
        candidateGrids: files.map(file => this.fileToImageInput(file)),
        candidates,
        selectedStartMs,
        selectedEndMs,
        ...(sourceDurationMs != null ? { sourceDurationMs } : {}),
        prompt: typeof body.prompt === 'string' ? body.prompt : undefined,
        maxStaticStickers: Number(body.maxStaticStickers),
        maxAnimatedStickers: Number(body.maxAnimatedStickers),
        userId,
      });
```

- [ ] **Step 7: Rewrite `tests/unit/services/video-sticker-pack-agent.service.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VideoStickerPackAgentService } from '../../../src/services/video-sticker-pack-agent.service';
import type { VideoStickerCandidate } from '../../../src/utils/video-sticker-pack';

const generateMock = vi.hoisted(() => vi.fn());
const createAgentMock = vi.hoisted(() => vi.fn());
const buildUserMessageMock = vi.hoisted(() =>
  vi.fn(() => ({ role: 'user', content: [{ type: 'text', text: 'built-message' }] }))
);

vi.mock('../../../src/ai/video-sticker-pack-agent', () => ({
  VIDEO_STICKER_PACK_AGENT_ID: 'video-sticker-pack',
  createVideoStickerPackAgent: createAgentMock,
  buildVideoStickerPackAgentUserMessage: buildUserMessageMock,
}));

const usage = {
  inputTokens: 123,
  outputTokens: 45,
  totalTokens: 168,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
};

const candidates: VideoStickerCandidate[] = [
  {
    candidateId: 'f_001',
    frameIndex: 1,
    gridIndex: 0,
    cellId: 'A1',
    timestampMs: 1_000,
    sharpnessScore: 0.8,
    brightnessScore: 0.5,
    differenceScore: 0.4,
  },
  {
    candidateId: 'f_002',
    frameIndex: 2,
    gridIndex: 0,
    cellId: 'A2',
    timestampMs: 1_500,
    sharpnessScore: 0.7,
    brightnessScore: 0.55,
    differenceScore: 0.3,
  },
];

const baseInput = {
  candidateGrids: [{ buffer: Buffer.from('grid'), mimeType: 'image/png' }],
  candidates,
  selectedStartMs: 0,
  selectedEndMs: 10_000,
  sourceDurationMs: 30_000,
};

describe('VideoStickerPackAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgentMock.mockResolvedValue({ generate: generateMock });
  });

  it('normalizes candidate references from the validated agent output and maps usage metadata', async () => {
    generateMock.mockResolvedValueOnce({
      type: 'response',
      output: {
        packTitle: 'Video Reactions',
        staticStickers: [
          {
            candidateId: 'f_001',
            frameIndex: 999,
            timestampMs: 999,
            cellId: 'D4',
            emojis: ['😀'],
            decorations: [],
          },
        ],
        animatedStickers: [
          {
            timeline: [
              { candidateId: 'f_002', frameIndex: 0, timestampMs: 0, durationMs: 120 },
              { candidateId: 'f_001', frameIndex: 0, timestampMs: 0, durationMs: 120 },
            ],
            emojis: ['🎬'],
            baseDecorations: [],
            frameDecorations: [],
          },
        ],
      },
      usage,
    });

    const service = new VideoStickerPackAgentService();
    const result = await service.generatePlan({ ...baseInput, userId: 'user-1' });

    expect(createAgentMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(buildUserMessageMock).toHaveBeenCalledTimes(1);
    expect(generateMock.mock.calls[0][0].trace.userId).toBe('user-1');
    expect(result.plan.staticStickers[0]).toMatchObject({
      candidateId: 'f_001',
      frameIndex: 1,
      timestampMs: 1_000,
      cellId: 'A1',
    });
    expect(result.plan.animatedStickers[0].timeline.map(frame => frame.candidateId)).toEqual([
      'f_001',
      'f_002',
    ]);
    expect(result.metadata).toMatchObject({
      model: 'openai/gpt-4.1-mini',
      mode: 'video-sticker-pack',
      candidateGridCount: 1,
      candidateCount: 2,
      tokensPrompt: 123,
      tokensCompletion: 45,
    });
  });

  it('fails when the agent run does not produce a response outcome', async () => {
    generateMock.mockResolvedValueOnce({
      type: 'interaction',
      interaction: { type: 'tool-approval' },
      usage,
    });

    const service = new VideoStickerPackAgentService();

    await expect(service.generatePlan(baseInput)).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });

  it('wraps invalid agent outputs as AI generation errors', async () => {
    generateMock.mockResolvedValueOnce({
      type: 'response',
      output: {
        packTitle: 'Bad',
        staticStickers: [
          {
            candidateId: 'missing',
            frameIndex: 1,
            timestampMs: 1,
            cellId: 'A1',
          },
        ],
      },
      usage,
    });

    const service = new VideoStickerPackAgentService();

    await expect(service.generatePlan(baseInput)).rejects.toMatchObject({
      code: 'AI_GENERATION_FAILED',
      statusCode: 502,
    });
  });
});
```

- [ ] **Step 8: KONTINGENSI (hanya jika probe Task 2 Step 8 memutuskan demikian): strict-friendly schema**

Jika `B1` (agent model) gagal karena provider menolak `default`/properti opsional:

1. Tambahkan di `src/utils/video-sticker-pack.ts`:

```ts
/**
 * Strict-provider variant of the agent output schema: no `default`, no
 * `coerce`, every field required. Numeric/array/string emptiness is modeled
 * with explicit values; `normalizeVideoStickerPackPlan` re-validates with the
 * full schema afterwards.
 */
export const videoStickerPackAgentPlanSchema = z.object({
  packTitle: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(1000),
  staticStickers: z.array(
    z.object({
      candidateId: z.string().trim().min(1).max(80),
      frameIndex: z.number().int().min(0).max(10_000),
      timestampMs: z.number().int().min(0),
      cellId: cellIdSchema,
      emojis: z.array(z.string().trim().min(1).max(16)).max(3),
      accessibilityText: z.string().trim().max(125),
      decorations: z.array(videoStickerDecorationSchema),
      rationale: z.string().trim().max(500),
    })
  ).max(VIDEO_STICKER_PACK_MAX_STATIC_COUNT),
  animatedStickers: z.array(
    z.object({
      timeline: z
        .array(
          z.object({
            candidateId: z.string().trim().min(1).max(80),
            frameIndex: z.number().int().min(0).max(10_000),
            timestampMs: z.number().int().min(0),
            durationMs: z.number().int().min(8).max(1000),
          })
        )
        .min(2)
        .max(VIDEO_STICKER_PACK_MAX_ANIMATED_FRAMES),
      fps: z.number().int().min(8).max(30),
      loopCount: z.number().int().min(0).max(10),
      emojis: z.array(z.string().trim().min(1).max(16)).max(3),
      accessibilityText: z.string().trim().max(255),
      baseDecorations: z.array(videoStickerDecorationSchema),
      frameDecorations: z.array(videoStickerFrameDecorationStrictSchema),
      rationale: z.string().trim().max(500),
    })
  ).max(VIDEO_STICKER_PACK_MAX_ANIMATED_COUNT),
  rejectedCandidates: z.array(
    z.object({
      candidateId: z.string().trim().min(1).max(80),
      reason: z.string().trim().min(1).max(240),
    })
  ).max(VIDEO_STICKER_PACK_MAX_CANDIDATES),
});

const videoStickerFrameDecorationStrictSchema = z.object({
  frameIndex: z.number().int().min(0).max(VIDEO_STICKER_PACK_MAX_ANIMATED_FRAMES - 1),
  decorations: z.array(videoStickerDecorationSchema),
});
```

Catatan: pindahkan deklarasi `videoStickerFrameDecorationStrictSchema` DI ATAS penggunaannya jika lint mengeluh `no-use-before-define`; dan `cellIdSchema` saat ini `const` non-exported di file yang sama — masih bisa dipakai.

2. Di `src/ai/video-sticker-pack-agent.ts`, ubah `outputSchema: videoStickerPackPlanSchema` menjadi `outputSchema: videoStickerPackAgentPlanSchema` (impor dari utils), dan tambahkan ke `buildSystemPrompt` baris tambahan di bagian akhir Rules:

```
- Always include every field of the JSON manifest, even when empty: use empty strings, empty arrays, or null placeholders rather than omitting keys.
```

3. Di service, TIDAK berubah — `normalizeVideoStickerPackPlan` tetap menerima output valid sebagai nilai biasa.

- [ ] **Step 9: Wiring shutdown di `src/server.ts`**

Tambahkan impor di atas:

```ts
import { closeAiTracing, flushAiTracing } from './ai/tracing';
```

Ganti kedua handler SIGTERM/SIGINT dengan:

```ts
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    logger.info('Server closed');
    try {
      await flushAiTracing();
      await closeAiTracing();
    } catch (tracingError) {
      logger.error({ error: tracingError }, 'Failed to close AI tracing');
    }
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void gracefulShutdown('SIGINT');
});
```

Dan ubah handler `uncaughtException` agar best-effort menutup tracing:

```ts
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  void closeAiTracing()
    .catch(() => undefined)
    .finally(() => process.exit(1));
});
```

- [ ] **Step 10: Verifikasi penuh**

Run: `npm run lint && npm run typecheck && npm test`
Expected: PASS — test service baru hijau, `grid-split.service.test.ts` tetap hijau.

- [ ] **Step 11: Smoke live agent — `scripts/tmp-agent-smoke.ts` (temporary)**

```ts
import sharp from 'sharp';
import { VideoStickerPackAgentService } from '../src/services/video-sticker-pack-agent.service';
import type { VideoStickerCandidate } from '../src/utils/video-sticker-pack';

async function gridPng(): Promise<Buffer> {
  return sharp({
    create: { width: 512, height: 512, channels: 3, background: { r: 245, g: 245, b: 245 } },
  })
    .composite(
      [0, 1].flatMap((row) =>
        [0, 1].map((col) => ({
          input: Buffer.from(
            `<svg width="236" height="236"><rect width="236" height="236" fill="hsl(${(row * 2 + col) * 60},70%,60%)"/><circle cx="118" cy="118" r="58" fill="#222"/></svg>`
          ),
          top: row * 256 + 10,
          left: col * 256 + 10,
        }))
      )
    )
    .png()
    .toBuffer();
}

const candidates: VideoStickerCandidate[] = [
  { candidateId: 'f_001', frameIndex: 1, gridIndex: 0, cellId: 'A1', timestampMs: 1_000, sharpnessScore: 0.8, brightnessScore: 0.5, differenceScore: 0.4 },
  { candidateId: 'f_002', frameIndex: 2, gridIndex: 0, cellId: 'A2', timestampMs: 1_500, sharpnessScore: 0.7, brightnessScore: 0.55, differenceScore: 0.3 },
  { candidateId: 'f_003', frameIndex: 3, gridIndex: 0, cellId: 'B1', timestampMs: 2_000, sharpnessScore: 0.75, brightnessScore: 0.52, differenceScore: 0.5 },
  { candidateId: 'f_004', frameIndex: 4, gridIndex: 0, cellId: 'B2', timestampMs: 2_500, sharpnessScore: 0.72, brightnessScore: 0.5, differenceScore: 0.45 },
];

async function main(): Promise<void> {
  const service = new VideoStickerPackAgentService();
  const result = await service.generatePlan({
    candidateGrids: [{ buffer: await gridPng(), mimeType: 'image/png' }],
    candidates,
    selectedStartMs: 0,
    selectedEndMs: 5_000,
    sourceDurationMs: 10_000,
    prompt: 'fun reaction stickers',
    userId: 'smoke-user',
  });
  console.log('plan:', JSON.stringify(result.plan).slice(0, 600));
  console.log('metadata:', result.metadata);
}

main().catch((error) => {
  console.error('SMOKE FAILED:', error);
  process.exitCode = 1;
});
```

- [ ] **Step 12: Jalankan smoke**

Run: `npx tsx scripts/tmp-agent-smoke.ts`
Expected: `plan` berisi minimal 1 sticker dengan `candidateId` dari manifest; `metadata.tokensPrompt` > 0.

- [ ] **Step 13: Hapus script, commit**

Run: `Remove-Item scripts/tmp-agent-smoke.ts`

```bash
git add src/ai/tracing.ts src/ai/video-sticker-pack-agent.ts src/services/video-sticker-pack-agent.service.ts src/controllers/generate.controller.ts src/server.ts tests/setup.ts tests/unit/ai/tracing.test.ts tests/unit/services/video-sticker-pack-agent.service.test.ts
git commit -m "feat(ai): migrate video sticker pack agent to Anvia Agent with Langfuse tracing"
```

---

### Task 6: Cleanup dependency LangChain + docs

**Files:**
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Tidak ada konsumen kode baru; task ini menghapus sisa dependency dan mendokumentasikan env.

- [ ] **Step 1: Hapus dependency LangChain & `@openrouter/sdk` dari `package.json`**

Hapus baris-baris berikut dari `dependencies`:

```json
    "@langchain/core": "^1.1.48",
    "@langchain/openrouter": "^0.3.0",
    "@openrouter/sdk": "^0.12.35",
    "langchain": "^1.4.2",
```

- [ ] **Step 2: Install ulang**

Run: `npm install`
Expected: sukses; `package-lock.json` bersih dari paket di atas.

- [ ] **Step 3: Pastikan tidak ada referensi tersisa**

Run: `grep -ri "langchain\|@langchain\|openrouter/sdk" src tests package.json`
Expected: **tidak ada hasil** (kata `openrouter` biasa masih boleh muncul di `src/ai/openrouter*.ts` — grep spesifik di atas hanya untuk paket lama).

- [ ] **Step 4: Tambah bagian AI engine di `README.md`**

Sisipkan setelah bagian `## AI quota (daily points)`:

```md
## AI engine (Anvia + Langfuse)

AI flows run on [Anvia](https://docs.anvia.dev) with OpenRouter as an OpenAI-compatible provider:

- **Video sticker pack agent** — Anvia `Agent` with typed tools and schema-validated structured output.
- **Vision analyses** (improvement prompt, grid detection, cell text) — Anvia parsed completions with zod schemas.
- **Image generation** — Anvia `ImageGenerationModel` contract backed by OpenRouter chat-image models.

| Env var | Default | Purpose |
| --- | --- | --- |
| `VIDEO_STICKER_PACK_AGENT_MODEL` | `openai/gpt-4.1-mini` | Agent model (OpenRouter id) |
| `IMPROVEMENT_AGENT_MODEL` | `google/gemini-2.5-pro` | Improvement prompt model |
| `AGENT_MODEL` | `google/gemini-2.5-flash-lite` | Vision analysis model |
| `IMAGE_GENERATION_MODEL` | `google/gemini-2.5-flash-image` | Sticker image model |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse host |
| `LANGFUSE_PUBLIC_KEY` | _(empty)_ | Enables agent-run tracing when set with the secret key |
| `LANGFUSE_SECRET_KEY` | _(empty)_ | Enables agent-run tracing when set with the public key |

Agent runs are traced to Langfuse when both keys are set; without them tracing is a no-op.
```

- [ ] **Step 5: Verifikasi final penuh**

Run: `npm run lint` → PASS
Run: `npm run typecheck` → PASS
Run: `npm test` → PASS
Run: `npm run build` → PASS (emit `dist/` sukses)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json README.md
git commit -m "chore(ai): drop LangChain dependencies and document Anvia + Langfuse setup"
```

---

## Catatan Eksekusi

- Probe dan smoke script adalah **temporary**: selalu hapus di step yang sama dan pastikan `git status --short` bersih sebelum commit.
- Jika `npm run lint` menandai `no-new-func`/`no-unsafe-*` pada file baru, perbaiki presisi tipe (bukan menambah disable kecuali pada shim `src/ai/esm.ts` yang memang butuh).
- Jika `npm run typecheck` menemui gesekan tipe pada `ReturnType<...>` untuk observer Langfuse (karena `@anvia/core/observability` adalah subpath), ganti anotasi dengan inferensi (`export const observer = ...` tanpa tipe eksplisit) — type-only yang gagal resolusi akan menjadi `any` karena `skipLibCheck` dan tidak boleh memblokir.
- Jangan mengubah `docker-compose*`, `Dockerfile`, atau `engines` — Node 20 tetap didukung (shim memakai native dynamic import yang tersedia sejak Node 12 untuk ESM relatif/paket).
