import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const imglyBgModelRaw = process.env.IMGLY_BG_MODEL;
const imglyBgModel: 'small' | 'medium' | 'large' =
  imglyBgModelRaw === 'small' || imglyBgModelRaw === 'large' ? imglyBgModelRaw : 'medium';
const imglyBgEnabled =
  process.env.IMGLY_BG_ENABLED === undefined
    ? (process.env.NODE_ENV ?? 'development') !== 'test'
    : process.env.IMGLY_BG_ENABLED !== 'false';

/** Bundled WASM/ONNX live here unless you override IMGLY_BG_PUBLIC_PATH and self-host assets. */
const defaultImglyAssetsDir = path.join(
  process.cwd(),
  'node_modules',
  '@imgly',
  'background-removal-node',
  'dist'
);

const animatedGifMaxFrames = Math.max(1, parseInt(process.env.ANIMATED_GIF_MAX_FRAMES ?? '120', 10));
/** Per-frame megapixel cap (width × height of one GIF frame); prevents huge single frames. */
const animatedGifMaxMegapixelsPerFrame = Math.max(
  0.25,
  parseFloat(process.env.ANIMATED_GIF_MAX_MEGAPIXELS_PER_FRAME ?? '12')
);

/** Floyd–Steinberg dither 0–1; lower preserves edges before GIF quantization. */
const animatedGifDitherRaw = parseFloat(process.env.ANIMATED_GIF_DITHER ?? '0');
const animatedGifDither =
  Number.isFinite(animatedGifDitherRaw) ? Math.min(1, Math.max(0, animatedGifDitherRaw)) : 0.4;
/** true = reuse one palette (smaller GIF); default false = sharper per-frame palette for stickers. */
const animatedGifReusePalette = process.env.ANIMATED_GIF_REUSE_PALETTE === 'true';
/** Lift semi-transparent ML edges before GIF encode (helps foreground survive palet GIF). */
const animatedGifAlphaBoostRaw = parseFloat(process.env.ANIMATED_GIF_ALPHA_BOOST_DIVISOR ?? '0.76');
const animatedGifAlphaBoostDivisor =
  Number.isFinite(animatedGifAlphaBoostRaw) && animatedGifAlphaBoostRaw > 0.5 && animatedGifAlphaBoostRaw < 1
    ? animatedGifAlphaBoostRaw
    : 0.76;
/** Odd kernel size 3–7 for morphological close on alpha; 0 = disabled. */
let animatedGifAlphaCloseKernel = parseInt(process.env.ANIMATED_GIF_ALPHA_CLOSE_KERNEL ?? '5', 10);
if (!Number.isFinite(animatedGifAlphaCloseKernel) || animatedGifAlphaCloseKernel <= 0) {
  animatedGifAlphaCloseKernel = 0;
} else {
  animatedGifAlphaCloseKernel = Math.min(7, animatedGifAlphaCloseKernel);
  if (animatedGifAlphaCloseKernel % 2 === 0) {
    animatedGifAlphaCloseKernel += 1;
  }
}

const cornerBgStripRaw = parseFloat(process.env.ANIMATED_GIF_CORNER_BG_STRIP_DIST ?? '64');
const animatedGifCornerBgStripDist =
  Number.isFinite(cornerBgStripRaw) && cornerBgStripRaw > 5 && cornerBgStripRaw < 120
    ? cornerBgStripRaw
    : 64;

/** Neighbour frames ±half on timeline for alpha=max (reduces per-frame silhouette flicker). */
const temporalAlphaHalf = Math.min(
  10,
  Math.max(0, parseInt(process.env.ANIMATED_GIF_TEMPORAL_ALPHA_MAX_HALF ?? '3', 10))
);
const temporalAlphaPasses = Math.min(
  5,
  Math.max(1, parseInt(process.env.ANIMATED_GIF_TEMPORAL_ALPHA_PASSES ?? '3', 10))
);
/** Dilate alpha after temporal merge to reconnect chipped edges; 0 = off. Odd 3–7. */
let temporalDilateAlphaKernel = parseInt(process.env.ANIMATED_GIF_TEMPORAL_DILATE_ALPHA ?? '5', 10);
if (!Number.isFinite(temporalDilateAlphaKernel) || temporalDilateAlphaKernel <= 0) {
  temporalDilateAlphaKernel = 0;
} else {
  temporalDilateAlphaKernel = Math.min(7, temporalDilateAlphaKernel);
  if (temporalDilateAlphaKernel % 2 === 0) {
    temporalDilateAlphaKernel += 1;
  }
}

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  host: process.env.HOST ?? '0.0.0.0',
  nodeEnv: process.env.NODE_ENV ?? 'development',
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10),
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  imglyBackgroundRemoval: {
    enabled: imglyBgEnabled,
    publicPath: process.env.IMGLY_BG_PUBLIC_PATH ?? defaultImglyAssetsDir,
    model: imglyBgModel,
    maxConcurrency: Math.max(1, parseInt(process.env.IMGLY_BG_MAX_CONCURRENCY ?? '2', 10)),
  },
  animatedGif: {
    maxFrames: animatedGifMaxFrames,
    maxMegapixelsPerFrame: animatedGifMaxMegapixelsPerFrame,
    gifDither: animatedGifDither,
    reusePalette: animatedGifReusePalette,
    /** Divide partial alpha by this (e.g. 0.9) to pull soft edges toward opaque before GIF. */
    alphaBoostDivisor: animatedGifAlphaBoostDivisor,
    /** Odd kernel size for alpha closing; 0 disables. */
    alphaCloseKernel: animatedGifAlphaCloseKernel,
    /** Max RGB distance to corner-averaged background to strip residual BG fringing. */
    cornerBackgroundStripDistance: animatedGifCornerBgStripDist,
    temporalAlphaMaxHalf: temporalAlphaHalf,
    temporalAlphaPasses: temporalAlphaPasses,
    temporalDilateAlphaKernel: temporalDilateAlphaKernel,
  },
  models: {
    imageGeneration: process.env.IMAGE_GENERATION_MODEL ?? 'google/gemini-2.5-flash-image',
    agent: process.env.AGENT_MODEL ?? 'google/gemini-2.5-flash-lite',
    videoStickerPackAgent: process.env.VIDEO_STICKER_PACK_AGENT_MODEL ?? 'openai/gpt-4.1-mini',
    improvementAgent: process.env.IMPROVEMENT_AGENT_MODEL ?? 'google/gemini-2.5-pro',
  },
  databaseUrl: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/sticker_api',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  jwtSecret: process.env.JWT_SECRET ?? 'your-jwt-secret-key-change-in-production',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? 'your-jwt-refresh-secret-key-change-in-production',
  jwtAccessExpiration: process.env.JWT_ACCESS_EXPIRATION ?? '15m',
  jwtRefreshExpiration: process.env.JWT_REFRESH_EXPIRATION ?? '7d',
  /** OAuth client IDs accepted as Google ID token `aud` (Web serverClientId + optional Android). */
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0),
  storageProvider: process.env.STORAGE_PROVIDER ?? 'local',
  appDeepLinkScheme: process.env.APP_DEEP_LINK_SCHEME ?? 'setiker',
  publicWebBaseUrl: process.env.PUBLIC_WEB_BASE_URL ?? process.env.APP_URL ?? 'http://localhost:3000',
  legal: {
    appName: process.env.APP_NAME ?? 'Setiker',
    developerName: process.env.DEVELOPER_NAME ?? 'Setiker',
    supportEmail: process.env.SUPPORT_EMAIL ?? 'support@setiker.app',
    privacyEmail: process.env.PRIVACY_EMAIL ?? process.env.SUPPORT_EMAIL ?? 'privacy@setiker.app',
    privacyNotificationWebhookUrl: process.env.PRIVACY_NOTIFICATION_WEBHOOK_URL ?? '',
    deletedAccountGraceDays: Math.max(1, parseInt(process.env.DELETED_ACCOUNT_GRACE_DAYS ?? '30', 10)),
    contentSafetyEnabled: process.env.CONTENT_SAFETY_ENABLED !== 'false',
  },
  historyExpirationDays: Math.max(1, parseInt(process.env.HISTORY_EXPIRATION_DAYS ?? '7', 10)),
  cleanupIntervalHours: Math.max(1, parseInt(process.env.CLEANUP_INTERVAL_HOURS ?? '24', 10)),
  redisEnabled: process.env.REDIS_ENABLED !== 'false',
  aiQuotaFailClosed: process.env.AI_QUOTA_FAIL_CLOSED === undefined
    ? (process.env.NODE_ENV ?? 'development') !== 'development'
    : process.env.AI_QUOTA_FAIL_CLOSED === 'true',
  /** @deprecated Use aiQuota.dailyPointLimit — kept for legacy env compatibility */
  aiDailyLimits: {
    generate: Math.max(1, parseInt(process.env.AI_DAILY_GENERATE_LIMIT ?? '50', 10)),
    gridSplit: Math.max(1, parseInt(process.env.AI_DAILY_GRID_SPLIT_LIMIT ?? '100', 10)),
    backgroundRemove: Math.max(1, parseInt(process.env.AI_DAILY_BACKGROUND_REMOVE_LIMIT ?? '100', 10)),
    videoStickerPack: Math.max(1, parseInt(process.env.AI_DAILY_VIDEO_PACK_LIMIT ?? '10', 10)),
    improve: Math.max(1, parseInt(process.env.AI_DAILY_IMPROVE_LIMIT ?? '50', 10)),
  },
  aiQuota: {
    dailyPointLimit: Math.max(1, parseInt(process.env.AI_DAILY_POINT_LIMIT ?? '100', 10)),
    reservationTtlSeconds: Math.max(60, parseInt(process.env.AI_RESERVATION_TTL_SECONDS ?? '3600', 10)),
    packImportEnabled: process.env.PACK_IMPORT_ENABLED !== 'false',
    operationCosts: ((): {
      generate: number;
      gridSplit: number;
      backgroundRemove: number;
      videoStickerPack: number;
      improve: number;
      packImport: number;
    } => {
      const defaults = {
        generate: 1,
        gridSplit: 1,
        backgroundRemove: 1,
        videoStickerPack: 1,
        improve: 1,
        packImport: 1,
      };
      if (process.env.AI_OPERATION_COSTS) {
        try {
          const parsed = JSON.parse(process.env.AI_OPERATION_COSTS) as Record<string, number>;
          return {
            generate: Math.max(0, parsed.generate ?? defaults.generate),
            gridSplit: Math.max(0, parsed.gridSplit ?? defaults.gridSplit),
            backgroundRemove: Math.max(0, parsed.backgroundRemove ?? defaults.backgroundRemove),
            videoStickerPack: Math.max(0, parsed.videoStickerPack ?? defaults.videoStickerPack),
            improve: Math.max(0, parsed.improve ?? defaults.improve),
            packImport: Math.max(0, parsed.packImport ?? defaults.packImport),
          };
        } catch {
          // fall through to per-key env
        }
      }
      return {
        generate: Math.max(0, parseInt(process.env.AI_COST_GENERATE ?? String(defaults.generate), 10)),
        gridSplit: Math.max(0, parseInt(process.env.AI_COST_GRID_SPLIT ?? String(defaults.gridSplit), 10)),
        backgroundRemove: Math.max(
          0,
          parseInt(process.env.AI_COST_BACKGROUND_REMOVE ?? String(defaults.backgroundRemove), 10)
        ),
        videoStickerPack: Math.max(
          0,
          parseInt(process.env.AI_COST_VIDEO_PACK ?? String(defaults.videoStickerPack), 10)
        ),
        improve: Math.max(0, parseInt(process.env.AI_COST_IMPROVE ?? String(defaults.improve), 10)),
        packImport: Math.max(
          0,
          parseInt(process.env.AI_COST_PACK_IMPORT ?? String(defaults.packImport), 10)
        ),
      };
    })(),
  },
  billing: {
    dailyResetTimezone: process.env.BILLING_DAILY_RESET_TIMEZONE ?? 'Asia/Jakarta',
    freeDailyPointLimit: Math.max(1, parseInt(process.env.BILLING_FREE_DAILY_POINT_LIMIT ?? '100', 10)),
    premiumDailyPointLimit: Math.max(1, parseInt(process.env.BILLING_PREMIUM_DAILY_POINT_LIMIT ?? '500', 10)),
    googlePlay: {
      packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME ?? 'com.setiker.app',
      serviceAccountJsonPath: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_PATH ?? '',
      rtdnVerificationToken: process.env.GOOGLE_PLAY_RTDN_VERIFICATION_TOKEN ?? '',
      mockMode: process.env.GOOGLE_PLAY_MOCK_MODE === 'true' || process.env.NODE_ENV === 'test',
    },
    apple: {
      bundleId: process.env.APPLE_BUNDLE_ID ?? 'com.setiker.app',
      issuerId: process.env.APPLE_APP_STORE_ISSUER_ID ?? '',
      keyId: process.env.APPLE_APP_STORE_KEY_ID ?? '',
      privateKeyPath: process.env.APPLE_APP_STORE_PRIVATE_KEY_PATH ?? '',
      appAppleId: process.env.APPLE_APP_STORE_APP_ID ?? '',
      environment: (process.env.APPLE_APP_STORE_ENVIRONMENT ?? 'Sandbox') as 'Sandbox' | 'Production',
      mockMode: process.env.APPLE_MOCK_MODE === 'true' || process.env.NODE_ENV === 'test',
    },
    xendit: {
      enabled: process.env.XENDIT_ENABLED === 'true',
      secretKey: process.env.XENDIT_SECRET_KEY ?? '',
      webhookToken: process.env.XENDIT_WEBHOOK_TOKEN ?? '',
      productPricesIdr: ((): Record<string, number> => {
        const defaults: Record<string, number> = {
          token_pack_s: 29000,
          token_pack_m: 79000,
          token_pack_l: 199000,
          premium_monthly: 49000,
          premium_yearly: 449000,
        };
        const raw = process.env.XENDIT_PRODUCT_PRICES_JSON;
        if (!raw) return defaults;
        try {
          const parsed = JSON.parse(raw) as Record<string, number>;
          return { ...defaults, ...parsed };
        } catch {
          return defaults;
        }
      })(),
    },
  },
} as const;

export type Config = typeof config;
