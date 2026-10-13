# Architecture

Setiker API is a single Express + TypeScript service. Routes are thin, controllers own HTTP
concerns, services own product behavior, and every AI capability is confined to `src/ai/`.

## Layers

```
routes (src/app.ts)
  └─ middleware        auth, quota, upload, validation, error handling
      └─ controllers   HTTP translation only
          └─ services  product logic (stickers, packs, billing, grid split, image/vision AI)
              └─ src/ai  Anvia runtime boundary (models, agents, tracing)
                  └─ AI gateway (AGENT_BASE_URL — OpenAI-compatible, default OpenRouter)
```

- **`src/ai/`** is the only place allowed to import `@anvia/*`. The packages are ESM-only and
  their `exports` maps declare no `require` condition, so they are loaded lazily through
  `src/ai/esm.ts` (`importEsm`) and every module there keeps its runtime dependencies behind that
  seam. `src/ai/core.ts` caches the `@anvia/core` module for the process.
- **Provider boundary** — `src/ai/provider/`:
  - `client.ts`: Anvia `OpenAIClient` bound to `AGENT_BASE_URL`/`AGENT_API_KEY`, plus
    `requireAgentCredentials()` (the clear error when the gateway key is missing).
  - `completion-model.ts`: builds one provider model per catalog role (reasoning controls declared
    from the catalog row).
  - `images-api-model.ts`: `ImageGenerationModel` for the OpenRouter **Images API**
    (`POST {base}/images`, `input_references` ≤ 14, aspect ratios). This is not a chat adapter —
    image models like Seedream are only served there.

## Model catalog (Postgres)

Model selection is data, not environment: the `AiModel` table has one row per role.

| role | purpose |
| --- | --- |
| `agent` | video sticker pack agent (tools + structured output) |
| `vision` | cell-text OCR + grid boundary detection |
| `improvement` | improvement prompt planner |
| `image` | sticker image generation (Images API) |

Each row carries `modelId`, `reasoningEfforts[]`, `defaultReasoningEffort`, `temperature`,
`maxTokens`. The runtime reads rows through `src/ai/models/catalog.ts` (cached for the process
lifetime — **restart the service to apply changes**) and fails fast with a `prisma db seed` hint
when a role is missing.

**Changing a model** (no deploy):

```sql
UPDATE "AiModel" SET "modelId" = '...', "reasoningEfforts" = ARRAY['low','medium','high'],
  "defaultReasoningEffort" = 'medium' WHERE role = 'agent';
```

…or edit `prisma/ai-models.seed.js` and run `npx prisma db seed` (the seeder upserts all roles
and deletes any other rows). Reasoning effort is passed through Anvia controls per run; the
chat adapter maps it to the provider's `reasoning_effort` parameter.

## AI flows

- **Video sticker pack** — `VideoStickerPackAgentService` orchestrates;
  `src/ai/agents/video-sticker-pack/` holds the Anvia `Agent` factory, prompts, and the four typed
  tools. Output is validated against `videoStickerPackAgentPlanSchema` (strict-provider variant:
  every property required, no `default`/`oneOf` keywords) and normalized afterwards.
  Live result metadata carries `tokensPrompt`/`tokensCompletion` from the run usage.
- **Vision analyses** — `VisionAnalysisService` uses `generateStructuredCompletion` (parsed
  completions with zod output schemas). Failure is honest: grid detection throws
  `GridDetectionError` (422) instead of guessing; the cell-text pass-2 is a recall strategy, not a
  fallback.
- **Image generation** — `ImageGenerationService` calls the Images API adapter. `IMPROVEMENT_GRID_MAX_CELLS`
  is 14 to respect the model's `input_references` cap.

## Tracing (Langfuse)

Agent runs are traced when `LANGFUSE_PUBLIC_KEY`/`LANGFUSE_SECRET_KEY` are set (no-op otherwise);
`server.ts` flushes and closes the client on shutdown. `@anvia/langfuse@1.2.1` tags spans with the
tracer name `@anvia/langfuse`, which the Langfuse SDK's default export filter drops — the repository
ships `patches/@anvia+langfuse+1.2.1.patch` (applied by `patch-package` in `postinstall`) that
renames the tracer scope to `langfuse-sdk`. Docker builds copy `patches/` before `npm ci` so the
patch reaches production images.

## Configuration & deployment

- One env file: copy `.env.example` to `.env`. `JWT_SECRET`, `JWT_REFRESH_SECRET`, and
  `DATABASE_URL` are required at boot (fail fast, no placeholder defaults).
- One compose file with profiles:
  - `docker compose --profile dev up -d` — local api + postgres + redis
  - `docker compose --profile test up -d --wait postgres-test redis-test` — isolated test stack
  - `docker compose --profile prod up -d` — image from GHCR + migrate + seed + nginx
- Production scripts: `scripts/setup-production.sh` (env + JWT generation + migrate + seed) and
  `scripts/init-ssl.sh` (certbot).
