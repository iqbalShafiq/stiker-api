import * as dotenv from 'dotenv'
import * as path from 'path'

// Try to load from multiple env files
const envPaths = ['.env.production', '.env']
for (const envFile of envPaths) {
  const envPath = path.resolve(process.cwd(), envFile)
  dotenv.config({ path: envPath })
}

export default {
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL,
  },
}
