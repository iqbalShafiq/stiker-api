import { execSync } from 'node:child_process';

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5433/sticker_api_test';
process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6380';

// Migrate then seed: the suite needs roles, billing products and the AI model
// catalog, and `prisma db seed` is idempotent.
execSync('npx prisma migrate deploy', { stdio: 'inherit', env: process.env });
execSync('npx prisma db seed', { stdio: 'inherit', env: process.env });
