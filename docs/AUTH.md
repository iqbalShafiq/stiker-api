# Authentication

Setiker accepts email + password, Google, and Apple. This file is the reference for each path.

## Continuity rules

These are the rules that decide what happens when the same person arrives through a different door.

- **Never auto-link Google ↔ Apple by email.** A shared email is not proof of the same person.
- Password login without a `passwordHash` → `USE_OAUTH_OR_SET_PASSWORD`, with the available
  `providers` in the error body.
- OAuth sign-in when the email already exists under another OAuth provider and has no password →
  `ACCOUNT_EXISTS_OTHER_PROVIDER`.
- Forgot password works even when the account has no password (it is a first-time set). The magic
  link opens `setiker://auth/reset-password?token=…`, with `PASSWORD_RESET_URL_BASE` as the web
  fallback.
- A password is the cross-platform bridge. An Apple-only account has no password and no Apple button
  on Android, so it signs in on iOS and sets a password, or uses the magic link.

## Endpoints

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/auth/register` | Public | Create an account |
| `POST` | `/api/v1/auth/login` | Public | Email and password |
| `POST` | `/api/v1/auth/refresh` | Cookie or body | Rotate the access token |
| `POST` | `/api/v1/auth/logout` | Bearer | Revoke the session |
| `GET` | `/api/v1/auth/me` | Bearer | The current user |
| `PUT` | `/api/v1/auth/me` | Bearer | Update the profile |
| `POST` | `/api/v1/auth/change-password` | Bearer | Change the password |
| `POST` | `/api/v1/auth/set-password` | Bearer | Set a password on an OAuth-only account |
| `POST` | `/api/v1/auth/forgot-password` | Public | Send a reset link |
| `POST` | `/api/v1/auth/reset-password` | Public | Set a new password |
| `POST` | `/api/v1/auth/google` | Public | Login or register with an ID token |
| `POST` | `/api/v1/auth/google/link-with-password` | Public | Link Google when the email has a password |
| `POST` | `/api/v1/auth/google/link` | Bearer | Link Google while signed in |
| `DELETE` | `/api/v1/auth/google` | Bearer | Unlink Google (blocked if it is the only method) |
| `POST` | `/api/v1/auth/apple` | Public | Login or register with an identity token |
| `POST` | `/api/v1/auth/apple/link-with-password` | Public | Link Apple when the email has a password |
| `POST` | `/api/v1/auth/apple/link` | Bearer | Link while signed in |
| `DELETE` | `/api/v1/auth/apple` | Bearer | Unlink (blocked if it is the only method) |

## Google

Mobile clients send a Google **ID token** to `POST /api/v1/auth/google`. The API verifies it with
`google-auth-library` — a client-only identity is never trusted. The stable user key is the Google
`sub`, stored in `AuthIdentity`.

### Google Cloud Console checklist

1. Use **separate** Cloud projects for development and production.
2. Configure the **OAuth consent screen** (app name, logo, generic support email, Privacy Policy and
   ToS URLs).
3. Create OAuth client IDs in the same brand project:
   - **Web** application — this client ID is the Android Credential Manager `serverClientId` and the
     primary `aud` for server verification.
   - **Android** — package name `com.setiker.app`, plus SHA-1 fingerprints for the **debug**
     keystore and for **Play App Signing**.
4. Set the API env `GOOGLE_CLIENT_IDS` to a comma-separated list of accepted audiences (at minimum
   the Web client ID).

### Debug SHA-1 (local Android)

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android
```

On Windows the debug keystore is typically `%USERPROFILE%\.android\debug.keystore`.

## Apple

Clients send an Apple **identity token** to `POST /api/v1/auth/apple`. The API verifies the JWT
against Apple's JWKS (`iss` = `https://appleid.apple.com`, `aud` ∈ `APPLE_CLIENT_IDS`). The stable
key is the Apple `sub` in `AuthIdentity`, with provider `APPLE`.

## Environment

| Variable | Description |
| --- | --- |
| `GOOGLE_CLIENT_IDS` | Accepted Google ID token audiences |
| `APPLE_CLIENT_IDS` | Accepted Apple identity token audiences |
| `RESEND_API_KEY` | Resend API key (empty = log-only in tests and dev) |
| `RESEND_FROM` | From address |
| `PASSWORD_RESET_URL_BASE` | HTTPS fallback URL for the reset |
| `PASSWORD_RESET_TOKEN_TTL_MINUTES` | Token lifetime (default 60) |
| `APP_DEEP_LINK_SCHEME` | Default `setiker` |
| `JWT_SECRET`, `JWT_REFRESH_SECRET` | Required at boot, no placeholder defaults |

## Password reset by email

| Method | Path | Behaviour |
| --- | --- | --- |
| `POST` | `/api/v1/auth/forgot-password` | Body `{ email }`. Always **200**, so the endpoint cannot be used to discover whether an account exists. Sends the magic link if an active user exists, including OAuth-only accounts without a password. |
| `POST` | `/api/v1/auth/reset-password` | Body `{ token, newPassword }`. Sets the password and invalidates the token and every refresh token. |
