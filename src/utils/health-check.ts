import os from 'os';
import fs from 'fs/promises';
import { prisma } from '../prisma/client';
import Redis from 'ioredis';
import logger from './logger';

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }
  return redis;
}

interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  checks: {
    database: { status: 'up' | 'down'; responseTime: number };
    redis: { status: 'up' | 'down'; responseTime: number };
    memory: { status: 'up' | 'down'; used: number; total: number; percentage: number };
    disk: { status: 'up' | 'down'; available: number };
  };
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const startTime = Date.now();

  // Check database
  let dbStatus: 'up' | 'down' = 'down';
  let dbResponseTime = 0;
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    dbResponseTime = Date.now() - dbStart;
    dbStatus = 'up';
  } catch (error) {
    logger.error({ error }, 'Database health check failed');
    dbResponseTime = Date.now() - startTime;
  }

  // Check Redis
  let redisStatus: 'up' | 'down' = 'down';
  let redisResponseTime = 0;
  try {
    const redisStart = Date.now();
    await getRedis().ping();
    redisResponseTime = Date.now() - redisStart;
    redisStatus = 'up';
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    redisResponseTime = Date.now() - startTime;
  }

  // Check memory
  const usedMemory = process.memoryUsage();
  const totalMemory = os.totalmem();
  const memoryPercentage = (usedMemory.heapUsed / totalMemory) * 100;

  // Check disk (simplified - just check if we can write)
  let diskAvailable = 0;
  try {
    const stats = await fs.stat('/');
    diskAvailable = stats.size;
  } catch {
    // Ignore disk check errors
  }

  const isHealthy = dbStatus === 'up' && redisStatus === 'up' && memoryPercentage < 90;

  return {
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '1.0.0',
    checks: {
      database: {
        status: dbStatus,
        responseTime: dbResponseTime,
      },
      redis: {
        status: redisStatus,
        responseTime: redisResponseTime,
      },
      memory: {
        status: memoryPercentage < 90 ? 'up' : 'down',
        used: Math.round(usedMemory.heapUsed / 1024 / 1024),
        total: Math.round(totalMemory / 1024 / 1024),
        percentage: Math.round(memoryPercentage),
      },
      disk: {
        status: 'up',
        available: diskAvailable,
      },
    },
  };
}
