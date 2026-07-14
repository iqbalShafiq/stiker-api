# stiker-api

Express API for Setiker sticker generation and cloud sync.

## Sign in with Google

Mobile clients send a Google **ID token** to `POST /api/v1/auth/google`. The API verifies the token with `google-auth-library` (never trust client-only identity). Stable user key is Google **`sub`**, stored in `AuthIdentity`.

### Google Cloud Console checklist

1. Use **separate** Cloud projects for development and production.
2. Configure the **OAuth consent screen** (app name, logo, generic support email, Privacy Policy / ToS URLs).
3. Create OAuth client IDs in the same brand project:
   - **Web** application — this client ID is the Android Credential Manager `serverClientId` and the primary `aud` for server verification.
   - **Android** — package name `com.setiker.app` plus SHA-1 fingerprints for **debug** keystore and **Play App Signing**.
4. Set API env `GOOGLE_CLIENT_IDS` to a comma-separated list of accepted audiences (at minimum the Web client ID).

### Debug SHA-1 (local Android)

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android
```

On Windows the debug keystore is typically `%USERPROFILE%\.android\debug.keystore`.

### Auth endpoints (Google)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/v1/auth/google` | Public | Login or register with ID token |
| `POST` | `/api/v1/auth/google/link-with-password` | Public | Link Google when email already has a password |
| `POST` | `/api/v1/auth/google/link` | Bearer | Link Google while signed in |
| `DELETE` | `/api/v1/auth/google` | Bearer | Unlink Google (blocked if sole login method) |
| `POST` | `/api/v1/auth/set-password` | Bearer | Set a password on a Google-only account |

### Environment

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_IDS` | Comma-separated OAuth client IDs accepted as ID token `aud` |

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

## Store-compliant billing (Google Play / Apple IAP)

Setiker Play Store and App Store builds must use **Google Play Billing** and **StoreKit** for digital goods (token packs, subscriptions). Xendit is optional for non-store builds only (`XENDIT_ENABLED=true`).

### Compliance

- Do not expose Xendit/QRIS checkout in Google Play or App Store builds for in-app digital goods.
- Purchases are verified server-side before entitlements are granted.
- Purchased token balance is stored in Postgres (`UserCreditBalance` + `TokenLedgerEntry`).
- Daily AI quota resets in `BILLING_DAILY_RESET_TIMEZONE` (default `Asia/Jakarta`).
- Consumption order: subscription/free daily allowance first, then purchased tokens.

### Billing endpoints

- `GET /api/v1/billing/products` — product catalog (no localized prices)
- `POST /api/v1/billing/google-play/verify` — verify Play purchase token
- `POST /api/v1/billing/apple/verify` — verify StoreKit transaction
- `GET /api/v1/billing/purchases` — purchase history
- `GET /api/v1/billing/subscription/me` — active subscription
- `POST /api/v1/billing/restore` — restore entitlements
- `POST /api/v1/billing/google-play/rtdn` — Play Real-time Developer Notifications
- `POST /api/v1/billing/apple/notifications` — App Store Server Notifications

### Billing environment

| Variable | Default | Description |
|----------|---------|-------------|
| `BILLING_DAILY_RESET_TIMEZONE` | `Asia/Jakarta` | Daily quota reset timezone |
| `BILLING_FREE_DAILY_POINT_LIMIT` | `100` | Free tier daily points |
| `BILLING_PREMIUM_DAILY_POINT_LIMIT` | `500` | Premium tier daily points |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.setiker.app` | Android package name |
| `GOOGLE_PLAY_MOCK_MODE` | `false` | Mock verifier for dev/test |
| `APPLE_MOCK_MODE` | `false` | Mock Apple verifier for dev/test |
| `XENDIT_ENABLED` | `false` | Non-store checkout only |
- **Client finalize `committed`** (e.g. user cancel) → charged even without 2xx.
- **Client finalize `released`** → not charged.
