import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AiUsageService } from '../../../src/services/ai-usage.service';
import { AiDailyQuotaExceededError } from '../../../src/errors';

const store = new Map<string, string>();
const hashStore = new Map<string, Record<string, string>>();
const quotaConfig = vi.hoisted(() => ({
  failClosed: false,
}));

function mockRedis() {
  return {
    eval: vi.fn(async (script: string, _keyCount: number, ...args: string[]) => {
      if (script.includes('local expired = redis.call') && !script.includes('local reservationKey = KEYS[3]')) {
        return [0, 0];
      }
      if (script.includes('local reservationKey = KEYS[3]') && script.includes('local pointLimit')) {
        const [
          usedKey,
          outstandingKey,
          reservationKey,
          _indexKey,
          _reservationPrefix,
          reservationId,
          userId,
          operation,
          costRaw,
          pointLimitRaw,
          dayKey,
          nowMs,
          expiresAtMs,
        ] = args;
        const cost = parseInt(costRaw, 10);
        const pointLimit = parseInt(pointLimitRaw, 10);
        const used = parseInt(store.get(usedKey) ?? '0', 10);
        const outstanding = Math.max(0, parseInt(store.get(outstandingKey) ?? '0', 10));
        if (used + outstanding + cost > pointLimit) {
          return [0, used, outstanding, Math.max(0, pointLimit - used - outstanding)];
        }
        const nextOutstanding = outstanding + cost;
        store.set(outstandingKey, String(nextOutstanding));
        hashStore.set(reservationKey, {
          userId,
          operation,
          cost: String(cost),
          status: 'pending',
          dayKey,
          createdAt: nowMs,
          expiresAt: expiresAtMs,
          reservationId,
        });
        return [1, used, nextOutstanding, Math.max(0, pointLimit - used - nextOutstanding)];
      }
      if (script.includes('local outcome = ARGV[2]')) {
        const [usedKey, outstandingKey, reservationKey] = args;
        const [, outcome, expectedUserId] = args.slice(4);
        const data = hashStore.get(reservationKey);
        if (!data?.userId) return [0];
        if (expectedUserId && data.userId !== expectedUserId) return [-1];
        if (data.status !== 'pending') return [2];
        const cost = parseInt(data.cost ?? '0', 10);
        if (outcome === 'committed') {
          store.set(usedKey, String(parseInt(store.get(usedKey) ?? '0', 10) + cost));
        }
        store.set(outstandingKey, String(Math.max(0, parseInt(store.get(outstandingKey) ?? '0', 10) - cost)));
        data.status = outcome;
        hashStore.set(reservationKey, data);
        return [1];
      }
      return [0];
    }),
    mget: vi.fn(async (...keys: string[]) => keys.map((k) => store.get(k) ?? null)),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    incrby: vi.fn(async (key: string, amount: number) => {
      const current = parseInt(store.get(key) ?? '0', 10);
      const next = current + amount;
      store.set(key, String(next));
      return next;
    }),
    decrby: vi.fn(async (key: string, amount: number) => {
      const current = parseInt(store.get(key) ?? '0', 10);
      const next = current - amount;
      store.set(key, String(next));
      return next;
    }),
    expire: vi.fn(async () => 1),
    hset: vi.fn(async (key: string, data: Record<string, string> | string, value?: string) => {
      const existing = hashStore.get(key) ?? {};
      if (typeof data === 'string' && value !== undefined) {
        existing[data] = value;
      } else if (typeof data === 'object') {
        Object.assign(existing, data);
      }
      hashStore.set(key, existing);
      return 1;
    }),
    hget: vi.fn(async (key: string, field: string) => hashStore.get(key)?.[field] ?? null),
    hgetall: vi.fn(async (key: string) => hashStore.get(key) ?? {}),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      hashStore.delete(key);
      return 1;
    }),
  };
}

vi.mock('../../../src/utils/redis-client', () => ({
  getRedis: vi.fn(),
  getReadyRedis: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
  config: {
    get aiQuotaFailClosed() {
      return quotaConfig.failClosed;
    },
    aiQuota: {
      dailyPointLimit: 100,
      reservationTtlSeconds: 3600,
      operationCosts: {
        generate: 1,
        gridSplit: 1,
        backgroundRemove: 1,
        videoStickerPack: 1,
        improve: 1,
      },
    },
  },
}));

import { getReadyRedis } from '../../../src/utils/redis-client';

describe('AiUsageService', () => {
  const service = new AiUsageService();
  const userId = 'user-test';

  beforeEach(() => {
    store.clear();
    hashStore.clear();
    quotaConfig.failClosed = false;
    vi.mocked(getReadyRedis).mockResolvedValue(mockRedis() as never);
  });

  it('returns full point limit when nothing used', async () => {
    const usage = await service.getUsage(userId);
    expect(usage.pointLimit).toBe(100);
    expect(usage.pointsUsed).toBe(0);
    expect(usage.pointsOutstanding).toBe(0);
    expect(usage.pointsRemaining).toBe(100);
  });

  it('reserve increases outstanding and reduces remaining', async () => {
    const reservation = await service.reserve(userId, 'generate');
    expect(reservation.pointCost).toBe(1);
    const usage = await service.getUsage(userId);
    expect(usage.pointsOutstanding).toBe(1);
    expect(usage.pointsRemaining).toBe(99);
    expect(usage.pointsUsed).toBe(0);
  });

  it('commit moves outstanding to used', async () => {
    const { reservationId } = await service.reserve(userId, 'generate');
    await service.finalize(reservationId, 'committed', userId);
    const usage = await service.getUsage(userId);
    expect(usage.pointsUsed).toBe(1);
    expect(usage.pointsOutstanding).toBe(0);
    expect(usage.pointsRemaining).toBe(99);
  });

  it('release does not increase used', async () => {
    const { reservationId } = await service.reserve(userId, 'generate');
    await service.finalize(reservationId, 'released', userId);
    const usage = await service.getUsage(userId);
    expect(usage.pointsUsed).toBe(0);
    expect(usage.pointsOutstanding).toBe(0);
    expect(usage.pointsRemaining).toBe(100);
  });

  it('cancel-style commit charges without HTTP success', async () => {
    const { reservationId } = await service.reserve(userId, 'improve');
    await service.finalize(reservationId, 'committed', userId);
    const usage = await service.getUsage(userId);
    expect(usage.pointsUsed).toBe(1);
  });

  it('blocks reserve when limit exhausted', async () => {
    store.set(`ai:points:used:${userId}:${new Date().toISOString().slice(0, 10)}`, '100');
    await expect(service.reserve(userId, 'generate')).rejects.toBeInstanceOf(
      AiDailyQuotaExceededError
    );
  });

  it('finalize is idempotent when already finalized', async () => {
    const { reservationId } = await service.reserve(userId, 'generate');
    await service.finalize(reservationId, 'committed', userId);
    const second = await service.finalize(reservationId, 'committed', userId);
    expect(second).toBe('already_finalized');
    const usage = await service.getUsage(userId);
    expect(usage.pointsUsed).toBe(1);
  });

  it('fails closed when validating a client reservation without Redis', async () => {
    quotaConfig.failClosed = true;
    vi.mocked(getReadyRedis).mockResolvedValue(null);
    await expect(
      service.validateReservation(userId, 'client-supplied-reservation', 'generate')
    ).rejects.toMatchObject({
      statusCode: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});
