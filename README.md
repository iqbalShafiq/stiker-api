# stiker-api

Express API for Setiker sticker generation and cloud sync.

## AI quota (daily points)

Each authenticated user has a **daily point pool** (default **100**). Each AI operation consumes configurable points. Outstanding reservations count toward the limit so concurrent requests from multiple devices cannot overshoot quota.

### Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `AI_DAILY_POINT_LIMIT` | `100` | Total points per user per UTC day |
| `AI_OPERATION_COSTS` | (see below) | JSON object, e.g. `{"generate":1,"gridSplit":1,"backgroundRemove":1,"videoStickerPack":1,"improve":1}` |
| `AI_COST_GENERATE` | `1` | Per-operation override when JSON not set |
| `AI_COST_GRID_SPLIT` | `1` | |
| `AI_COST_BACKGROUND_REMOVE` | `1` | |
| `AI_COST_VIDEO_PACK` | `1` | |
| `AI_COST_IMPROVE` | `1` | |
| `AI_RESERVATION_TTL_SECONDS` | `3600` | Auto-release stale reservations |
| `AI_QUOTA_FAIL_CLOSED` | `true` outside development | When `true`, Redis errors block quota instead of fail-open. Keep `true` in production and CI. |
| `REDIS_ENABLED` | `true` | Disable only for local dev without Redis. Keep enabled in production. |
| `IMGLY_BG_ENABLED` | `true` | Enables IMG.LY ONNX background removal. Tests set this to `false` and use the local fallback. |

### Endpoints

- `GET /api/v1/ai/usage` — snapshot (`pointsUsed`, `pointsOutstanding`, `pointsRemaining`, `operationCosts`)
- `POST /api/v1/ai/quota/reserve` — body `{ "operation": "generate" }`
- `POST /api/v1/ai/quota/finalize` — body `{ "reservationId", "outcome": "committed" | "released" }`

Protected AI routes accept optional header `X-AI-Reservation-Id` from the app after a prior reserve.

Redis is required for real quota enforcement. The Docker Compose files include Redis for dev, test,
and production. Use `npm run test:up` for the isolated test stack; it starts Redis on
`redis://localhost:6380` and Postgres on `localhost:5433`.

### Billing rules

- **HTTP 2xx** on an AI route → reservation committed (points used).
- **HTTP error** → reservation released (no charge).
- **Client finalize `committed`** (e.g. user cancel) → charged even without 2xx.
- **Client finalize `released`** → not charged.
