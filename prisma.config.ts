import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// Read DATABASE_URL from environment (set by docker-compose env_file or .env)
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  console.warn('DATABASE_URL is not set. Please check your .env.production file.')
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
  },
})
