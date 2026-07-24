# Foreground Service Declaration (Google Play)

App: **Setiker** (`com.setiker.app`)

## Service used

| Component | Type | Purpose |
|-----------|------|---------|
| `androidx.work.impl.foreground.SystemForegroundService` | `dataSync` | WorkManager foreground notification for AI job processor |
| Worker: `AiJobProcessorWorker` | — | Processes queued on-device AI jobs with server calls |

## Manifest

```xml
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<service
    android:name="androidx.work.impl.foreground.SystemForegroundService"
    android:foregroundServiceType="dataSync" />
```

## Why foreground service?

AI sticker jobs (generate, background removal, grid split, video pack) can run several minutes. Without a foreground service, Android may kill the worker when the app is backgrounded. FGS shows a progress notification so users know processing continues.

**Note:** Cloud sync (`SyncWorker`) does **not** use FGS — only the AI job processor does.

## User flow (for Play demo video)

1. User opens Setiker and starts an AI action (e.g. generate stickers).
2. User backgrounds the app.
3. Notification appears showing AI progress.
4. User taps notification → returns to AI Jobs screen.
5. Job completes or fails with in-app status.

## User impact if delayed

Without FGS + notification permission, background AI jobs may be interrupted; user sees retry/failed state in AI Jobs.

## Play Console declaration

- **Type:** Data sync (processing user-initiated AI work)
- **User-visible:** Yes (notification)
- **Starts:** User initiates AI job that runs in background worker
