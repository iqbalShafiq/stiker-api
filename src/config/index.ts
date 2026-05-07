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

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
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
  models: {
    imageGeneration: 'sourceful/riverflow-v2-standard-preview',
    agent: 'google/gemma-4-31b-it',
  },
} as const;

export type Config = typeof config;
