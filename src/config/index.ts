import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const imglyBgModelRaw = process.env.IMGLY_BG_MODEL;
const imglyBgModel: 'small' | 'medium' | 'large' =
  imglyBgModelRaw === 'small' || imglyBgModelRaw === 'large' ? imglyBgModelRaw : 'medium';

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
    imageGeneration: 'google/gemini-2.5-flash-image',
    agent: 'google/gemini-2.5-flash-lite',
  },
} as const;

export type Config = typeof config;
