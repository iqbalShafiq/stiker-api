# AI: quota, gateway and models

Every AI capability is confined to `src/ai/`. This file is the operational reference.

## Daily quota

Each authenticated user has a **daily point pool** (default **100**). Each AI operation consumes
configurable points. Outstanding reservations count toward the limit, so concurrent requests from
several devices cannot overshoot the quota.

The rules are simple: a **2xx** on an AI route commits the reservation (points used), an **HTTP
error** releases it (no charge). The client can also finalize explicitly with `committed` (charged
even without a 2xx, e.g. the user cancelled) or `released` (not charged).

### Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/ai/usage` | Snapshot: `pointsUsed`, `pointsOutstanding`, `pointsRemaining`, `operationCosts` |
| `POST` | `/api/v1/ai/quota/reserve` | Body `{ "operation": "generate" }` |
| `POST` | `/api/v1/ai/quota/finalize` | Body `{ "reservationId", "outcome": "committed" \| "released" }` |

Protected AI routes accept an optional `X-AI-Reservation-Id` header, which the app sends after a
prior reserve.

### Environment

| Variable | Default | Description |
| --- | --- | --- |
| `AI_DAILY_POINT_LIMIT` | `100` | Total points per user per UTC day |
| `AI_OPERATION_COSTS` | _(see below)_ | JSON object, e.g. `{"generate":1,"gridSplit":1,"backgroundRemove":1,"videoStickerPack":1,"improve":1}` |
| `AI_COST_GENERATE` | `1` | Per-operation override when the JSON is not set |
| `AI_COST_GRID_SPLIT` | `1` | |
| `AI_COST_BACKGROUND_REMOVE` | `1` | |
| `AI_COST_VIDEO_PACK` | `1` | |
| `AI_COST_IMPROVE` | `1` | |
| `AI_RESERVATION_TTL_SECONDS` | `3600` | Auto-release stale reservations |
| `AI_QUOTA_FAIL_CLOSED` | `true` outside development | When `true`, a Redis error blocks quota instead of failing open. Keep it `true` in production and CI. |
| `REDIS_ENABLED` | `true` | Disable only for local development without Redis. Keep it enabled in production. |
| `IMGLY_BG_MODEL` | `medium` | IMG.LY ONNX model size (`small` / `medium` / `large`) |
| `IMGLY_BG_MAX_CONCURRENCY` | `2` | Parallel IMG.LY segmentations |

Redis is required for real quota enforcement.

## The gateway

AI flows run on [Anvia](https://docs.anvia.dev) with an OpenAI-compatible gateway
(`AGENT_BASE_URL`, default OpenRouter).

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_API_KEY` | _(empty)_ | Gateway API key. Required for the AI features. |
| `AGENT_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible gateway root |
| `LANGFUSE_BASE_URL` | `https://cloud.langfuse.com` | Langfuse host |
| `LANGFUSE_PUBLIC_KEY` | _(empty)_ | Enables agent-run tracing when set with the secret key |
| `LANGFUSE_SECRET_KEY` | _(empty)_ | Enables agent-run tracing when set with the public key |

Agent runs are traced to Langfuse when both keys are set; without them tracing is a no-op.

## What the AI actually does

- **Video sticker pack agent** — an Anvia `Agent` with typed tools and schema-validated structured
  output.
- **Vision analyses** (improvement prompt, grid detection, cell text) — Anvia parsed completions
  with zod schemas.
- **Image generation** — the Anvia `ImageGenerationModel` contract, backed by the OpenRouter Images
  API.

## Model catalog

Model selection is **data, not environment**. The `AiModel` table has one row per role, and each
row carries `modelId`, `reasoningEfforts[]`, `defaultReasoningEffort`, `temperature` and `maxTokens`.

| role | purpose |
| --- | --- |
| `agent` | video sticker pack agent (tools + structured output) |
| `vision` | cell-text OCR + grid boundary detection |
| `improvement` | improvement prompt planner |
| `image` | sticker image generation (Images API) |

Change a model without a deploy:

```sql
UPDATE "AiModel" SET "modelId" = '...', "reasoningEfforts" = ARRAY['low','medium','high'],
  "defaultReasoningEffort" = 'medium' WHERE role = 'agent';
```

Or edit `prisma/ai-models.seed.js` and run `npx prisma db seed` — the seeder upserts all roles and
deletes any other rows.

The runtime caches the catalog for the process lifetime, so **restart the service** to apply a
change. A missing role fails fast with a `prisma db seed` hint.

The full picture, including the ESM seam and the provider boundary, is in
[ARCHITECTURE.md](ARCHITECTURE.md).
