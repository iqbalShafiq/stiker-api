# Play Console Data Safety Mapping

App: **Setiker** | Developer: **Setiker** | Policy version: **2026-07-07**

Use this table when completing the Google Play Data Safety form. Values must match [Privacy Policy](/privacy) and backend implementation.

| Data type | Collected | Shared | Purpose | Required | Encrypted in transit | Retention | Deletion | Third party |
|-----------|-----------|--------|---------|----------|----------------------|-----------|----------|-------------|
| Email | Yes | No | Account, auth, deletion requests | Yes (account) | TLS | Until account deletion | In-app + web request | — |
| Username, display name | Yes | No | Profile, public packs | Yes (account) | TLS | Until account deletion | In-app + web request | — |
| Auth tokens | Yes | No | Session | Yes (signed-in use) | TLS | Access: ~15m; refresh: ~7d | Logout / delete account | — |
| Photos/videos (user-selected) | Yes | No* | Sticker creation, AI input | Optional | TLS | Until user deletes / account deletion | Delete account | Cloud host |
| AI prompts & outputs | Yes | No* | AI features | Optional | TLS | History: `HISTORY_EXPIRATION_DAYS` (default 7) | Auto-expire + delete account | OpenRouter / model APIs |
| Sticker packs (public) | Yes | Yes (public UGC) | Explore sharing | Optional | TLS | Until deleted / account deletion | Owner delete / moderation | — |
| Google Play purchase token | Yes | Yes (Google) | Billing verification | Optional (premium) | TLS | Legal/billing retention | Anonymized on delete | Google Play |
| Crash/diagnostics | If enabled | Per SDK | Stability | Optional | TLS | Per SDK policy | Per SDK | Firebase/etc. if added |
| Moderation reports | Yes | No | Safety | Optional | TLS | Until resolved + audit | Anonymized reporter on delete | — |

\*Shared only when user publishes packs publicly; not sold to third parties.

## Account deletion

- **In-app:** Settings → Delete account (password + type "Delete Account")
- **Web:** `{PUBLIC_WEB_BASE_URL}/account-deletion`
- **Processing:** Immediate in-app; web requests within 30 days

## Permissions (Android)

| Permission | Used | When requested |
|------------|------|----------------|
| POST_NOTIFICATIONS | AI job progress | First background AI job |
| FOREGROUND_SERVICE / DATA_SYNC | AI worker | Automatic with background AI |
| INTERNET | API, images | Always (no prompt) |
| Photo/video picker | User-selected files | System picker only; no READ_MEDIA_* |
