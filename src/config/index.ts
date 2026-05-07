import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT ?? '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE ?? '10485760', 10),
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  models: {
    imageGeneration: 'sourceful/riverflow-v2-standard-preview',
    agent: 'google/gemma-4-31b-it',
  },
} as const;

export type Config = typeof config;
