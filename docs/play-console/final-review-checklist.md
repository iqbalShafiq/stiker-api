# Final Play Review Checklist

## Legal & privacy

- [ ] Privacy Policy URL live: `{PUBLIC_WEB_BASE_URL}/privacy` (HTTPS, HTML, public)
- [ ] Terms URL live: `{PUBLIC_WEB_BASE_URL}/terms`
- [ ] Account deletion URL live: `{PUBLIC_WEB_BASE_URL}/account-deletion` (actionable form)
- [ ] App/developer name in policy matches Play listing
- [ ] Privacy Policy accessible in-app (Profile → Legal)
- [ ] Terms accessible in-app

## Account deletion

- [ ] In-app: Settings → Delete account (password + "Delete Account" phrase)
- [ ] Web: POST `/api/v1/legal/account-deletion/request` works
- [ ] Play Console deletion URL set to `/account-deletion`

## Data Safety

- [ ] Form completed using [data-safety-mapping.md](./data-safety-mapping.md)
- [ ] Declarations match actual API + retention config

## UGC & AI safety

- [ ] Report public pack in-app
- [ ] Block creator in-app
- [ ] Report AI output (Processing History, Editor, Create Pack AI results)
- [ ] Content policy shown before publish to Explore
- [ ] Backend content safety on PUBLIC visibility

## Android permissions

- [ ] No `READ_MEDIA_IMAGES` / `READ_MEDIA_VIDEO` / `READ_EXTERNAL_STORAGE` in release manifest
- [ ] `POST_NOTIFICATIONS` requested only when starting background AI job
- [ ] FGS declaration doc + demo video ready ([foreground-service-declaration.md](./foreground-service-declaration.md))

## Engineering

- [ ] `npm run typecheck && npm run lint && npm test` pass (backend)
- [ ] `./gradlew :composeApp:compileDebugKotlinAndroid :composeApp:testDebugUnitTest` pass (app)
- [ ] Prisma migration `play_compliance_legal` applied
- [ ] OpenAPI updated for new endpoints
