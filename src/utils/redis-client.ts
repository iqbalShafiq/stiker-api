import Redis from 'ioredis';
import { config } from '../config';

let redis: Redis | null = null;
const REDIS_READY_TIMEOUT_MS = 1000;

export function getRedis(): Redis | null {
  if (!config.redisEnabled) {
    return null;
  }
  if (redis?.status === 'end') {
    redis = null;
  }
  if (!redis) {
    redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  }
  return redis;
}

function waitForRedisReady(client: Redis): Promise<void> {
  if (client.status === 'ready') {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      client.off('ready', onReady);
      client.off('error', onError);
    };
    const onReady = (): void => {
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Redis connection timed out'));
    }, REDIS_READY_TIMEOUT_MS);

    client.once('ready', onReady);
    client.once('error', onError);
  });
}

export async function getReadyRedis(): Promise<Redis | null> {
  const client = getRedis();
  if (!client) {
    return null;
  }
  if (client.status === 'ready') {
    return client;
  }
  if (client.status === 'wait') {
    await client.connect();
  } else {
    await waitForRedisReady(client);
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit().catch(() => undefined);
    redis = null;
  }
}
