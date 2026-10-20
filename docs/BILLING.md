# Billing

Setiker's Play Store and App Store builds use **Google Play Billing** and **StoreKit** for digital
goods (token packs and subscriptions). Xendit is optional for non-store builds only
(`XENDIT_ENABLED=true`).

## Compliance

- Do not expose Xendit/QRIS checkout in a Google Play or App Store build for in-app digital goods.
- Purchases are verified **server-side** before any entitlement is granted.
- The purchased token balance lives in Postgres (`UserCreditBalance` and `TokenLedgerEntry`).
- The daily AI quota resets in `BILLING_DAILY_RESET_TIMEZONE` (default `Asia/Jakarta`).
- Consumption order: the subscription or free daily allowance first, then the purchased tokens.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/billing/products` | Product catalog (no localized prices) |
| `POST` | `/api/v1/billing/google-play/verify` | Verify a Play purchase token |
| `POST` | `/api/v1/billing/apple/verify` | Verify a StoreKit transaction |
| `GET` | `/api/v1/billing/purchases` | Purchase history |
| `GET` | `/api/v1/billing/subscription/me` | The active subscription |
| `POST` | `/api/v1/billing/restore` | Restore entitlements |
| `POST` | `/api/v1/billing/google-play/rtdn` | Play Real-time Developer Notifications |
| `POST` | `/api/v1/billing/apple/notifications` | App Store Server Notifications |
| `POST` | `/api/v1/billing/xendit/checkout` | Optional checkout for non-store builds |
| `POST` | `/api/v1/billing/xendit/webhook` | Xendit webhook |

## Environment

| Variable | Default | Description |
| --- | --- | --- |
| `BILLING_DAILY_RESET_TIMEZONE` | `Asia/Jakarta` | Daily quota reset timezone |
| `BILLING_FREE_DAILY_POINT_LIMIT` | `100` | Free tier daily points |
| `BILLING_PREMIUM_DAILY_POINT_LIMIT` | `500` | Premium tier daily points |
| `GOOGLE_PLAY_PACKAGE_NAME` | `com.setiker.app` | Android package name |
| `GOOGLE_PLAY_MOCK_MODE` | `false` | Mock verifier for dev and test |
| `APPLE_MOCK_MODE` | `false` | Mock Apple verifier for dev and test |
| `XENDIT_ENABLED` | `false` | Non-store checkout only |
| `XENDIT_SECRET_KEY`, `XENDIT_CHECKOUT_URL`, `XENDIT_WEBHOOK_TOKEN` | _(empty)_ | Xendit, when enabled |

## How the AI quota is charged

The billing points and the AI quota are the same pool.

- **HTTP 2xx** on an AI route → the reservation is committed (points used).
- **HTTP error** → the reservation is released (no charge).
- The client can finalize `committed` (for example the user cancelled) → charged even without a 2xx.
- The client can finalize `released` → not charged.

See [AI.md](AI.md) for the quota endpoints and the cost configuration.
