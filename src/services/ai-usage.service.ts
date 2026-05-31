import { randomUUID } from 'crypto';
import { AiDailyQuotaExceededError, AppError, ValidationError } from '../errors';
import { config } from '../config';
import { getReadyRedis } from '../utils/redis-client';
import { logger } from '../utils/logger';

export type AiOperation =
  | 'generate'
  | 'gridSplit'
  | 'backgroundRemove'
  | 'videoStickerPack'
  | 'improve';

export type AiReservationOutcome = 'committed' | 'released';

export interface AiUsageCounts {
  generate: number;
  gridSplit: number;
  backgroundRemove: number;
  videoStickerPack: number;
  improve: number;
}

export interface AiUsageSnapshot {
  period: 'daily';
  periodStart: string;
  periodEnd: string;
  pointLimit: number;
  pointsUsed: number;
  pointsOutstanding: number;
  pointsRemaining: number;
  operationCosts: AiUsageCounts;
  resetsAt: string;
  serverNow: string;
}

export interface AiReservationResult {
  reservationId: string;
  operation: AiOperation;
  pointCost: number;
  pointLimit: number;
  pointsUsed: number;
  pointsOutstanding: number;
  pointsRemaining: number;
  resetsAt: string;
  reservationExpiresAt: string;
  serverNow: string;
  usage: AiUsageSnapshot;
}

const OPERATIONS: AiOperation[] = [
  'generate',
  'gridSplit',
  'backgroundRemove',
  'videoStickerPack',
  'improve',
];

function dayKeyForDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function nextUtcMidnight(from: Date): Date {
  const next = new Date(from);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

function periodBounds(date: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(date);
  periodStart.setUTCHours(0, 0, 0, 0);
  const periodEnd = nextUtcMidnight(periodStart);
  return { periodStart, periodEnd };
}

function usedPointsKey(userId: string, dayKey: string): string {
  return `ai:points:used:${userId}:${dayKey}`;
}

function outstandingPointsKey(userId: string, dayKey: string): string {
  return `ai:points:outstanding:${userId}:${dayKey}`;
}

function reservationKey(reservationId: string): string {
  return `ai:reservation:${reservationId}`;
}

function reservationIndexKey(userId: string, dayKey: string): string {
  return `ai:reservations:pending:${userId}:${dayKey}`;
}

function reservationKeyPrefix(): string {
  return 'ai:reservation:';
}

function getOperationCosts(): AiUsageCounts {
  return { ...config.aiQuota.operationCosts };
}

function getPointLimit(): number {
  return config.aiQuota.dailyPointLimit;
}

function getReservationTtlSeconds(): number {
  return config.aiQuota.reservationTtlSeconds;
}

function usageTtlSeconds(now: Date): number {
  const { periodEnd } = periodBounds(now);
  const secondsUntilReset = Math.ceil((periodEnd.getTime() - now.getTime()) / 1000);
  return Math.max(60, secondsUntilReset + 86_400);
}

function getCost(operation: AiOperation): number {
  return getOperationCosts()[operation];
}

function failOpenOnRedisError(): boolean {
  return !config.aiQuotaFailClosed;
}

function redisRequiredError(): AppError {
  return new AppError(
    'AI quota service is unavailable',
    503,
    'SERVICE_UNAVAILABLE',
    'AI_QUOTA_UNAVAILABLE'
  );
}

function parseNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? '0'), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseScriptResult(result: unknown): unknown[] {
  return Array.isArray(result) ? result : [];
}

const CLEANUP_EXPIRED_RESERVATIONS_SCRIPT = `
local outstandingKey = KEYS[1]
local indexKey = KEYS[2]
local reservationPrefix = ARGV[1]
local nowMs = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local expired = redis.call('ZRANGEBYSCORE', indexKey, '-inf', nowMs)
local released = 0
for _, reservationId in ipairs(expired) do
  local resKey = reservationPrefix .. reservationId
  local status = redis.call('HGET', resKey, 'status')
  if status == 'pending' then
    local cost = tonumber(redis.call('HGET', resKey, 'cost') or '0')
    if cost > 0 then
      redis.call('DECRBY', outstandingKey, cost)
      released = released + cost
    end
    redis.call('HSET', resKey, 'status', 'released', 'finalizedAt', tostring(nowMs), 'finalizeReason', 'expired')
    redis.call('EXPIRE', resKey, ttl)
  end
  redis.call('ZREM', indexKey, reservationId)
end

local outstanding = tonumber(redis.call('GET', outstandingKey) or '0')
if outstanding < 0 then
  redis.call('SET', outstandingKey, '0', 'EX', ttl)
  outstanding = 0
elseif outstanding > 0 then
  redis.call('EXPIRE', outstandingKey, ttl)
end
redis.call('EXPIRE', indexKey, ttl)
return {outstanding, released}
`;

const RESERVE_SCRIPT = `
local usedKey = KEYS[1]
local outstandingKey = KEYS[2]
local reservationKey = KEYS[3]
local indexKey = KEYS[4]
local reservationPrefix = ARGV[1]
local reservationId = ARGV[2]
local userId = ARGV[3]
local operation = ARGV[4]
local cost = tonumber(ARGV[5])
local pointLimit = tonumber(ARGV[6])
local dayKey = ARGV[7]
local nowMs = tonumber(ARGV[8])
local expiresAtMs = tonumber(ARGV[9])
local ttl = tonumber(ARGV[10])

local expired = redis.call('ZRANGEBYSCORE', indexKey, '-inf', nowMs)
for _, expiredReservationId in ipairs(expired) do
  local expiredKey = reservationPrefix .. expiredReservationId
  local status = redis.call('HGET', expiredKey, 'status')
  if status == 'pending' then
    local expiredCost = tonumber(redis.call('HGET', expiredKey, 'cost') or '0')
    if expiredCost > 0 then
      redis.call('DECRBY', outstandingKey, expiredCost)
    end
    redis.call('HSET', expiredKey, 'status', 'released', 'finalizedAt', tostring(nowMs), 'finalizeReason', 'expired')
    redis.call('EXPIRE', expiredKey, ttl)
  end
  redis.call('ZREM', indexKey, expiredReservationId)
end

local used = tonumber(redis.call('GET', usedKey) or '0')
local outstanding = tonumber(redis.call('GET', outstandingKey) or '0')
if outstanding < 0 then
  outstanding = 0
  redis.call('SET', outstandingKey, '0', 'EX', ttl)
end

if used + outstanding + cost > pointLimit then
  return {0, used, outstanding, math.max(0, pointLimit - used - outstanding)}
end

if cost > 0 then
  outstanding = redis.call('INCRBY', outstandingKey, cost)
end

redis.call('HSET', reservationKey,
  'userId', userId,
  'operation', operation,
  'cost', tostring(cost),
  'status', 'pending',
  'dayKey', dayKey,
  'createdAt', tostring(nowMs),
  'expiresAt', tostring(expiresAtMs)
)
redis.call('ZADD', indexKey, expiresAtMs, reservationId)
redis.call('EXPIRE', usedKey, ttl)
redis.call('EXPIRE', outstandingKey, ttl)
redis.call('EXPIRE', reservationKey, ttl)
redis.call('EXPIRE', indexKey, ttl)

return {1, used, outstanding, math.max(0, pointLimit - used - outstanding)}
`;

const FINALIZE_SCRIPT = `
local usedKey = KEYS[1]
local outstandingKey = KEYS[2]
local reservationKey = KEYS[3]
local indexKey = KEYS[4]
local reservationId = ARGV[1]
local outcome = ARGV[2]
local expectedUserId = ARGV[3]
local nowMs = ARGV[4]
local ttl = tonumber(ARGV[5])

local userId = redis.call('HGET', reservationKey, 'userId')
if not userId then
  return {0}
end
if expectedUserId ~= '' and userId ~= expectedUserId then
  return {-1}
end
local status = redis.call('HGET', reservationKey, 'status')
if status ~= 'pending' then
  return {2}
end

local cost = tonumber(redis.call('HGET', reservationKey, 'cost') or '0')
if outcome == 'committed' and cost > 0 then
  redis.call('INCRBY', usedKey, cost)
  redis.call('EXPIRE', usedKey, ttl)
end
if cost > 0 then
  redis.call('DECRBY', outstandingKey, cost)
end
local outstanding = tonumber(redis.call('GET', outstandingKey) or '0')
if outstanding < 0 then
  redis.call('SET', outstandingKey, '0', 'EX', ttl)
end
redis.call('HSET', reservationKey, 'status', outcome, 'finalizedAt', nowMs)
redis.call('ZREM', indexKey, reservationId)
redis.call('EXPIRE', outstandingKey, ttl)
redis.call('EXPIRE', reservationKey, ttl)
redis.call('EXPIRE', indexKey, ttl)
return {1}
`;

export class AiUsageService {
  private async cleanupExpiredReservations(userId: string, dayKey: string, now: Date): Promise<void> {
    const redis = await getReadyRedis();
    if (!redis) {
      if (!failOpenOnRedisError()) {
        throw redisRequiredError();
      }
      return;
    }
    await redis.eval(
      CLEANUP_EXPIRED_RESERVATIONS_SCRIPT,
      2,
      outstandingPointsKey(userId, dayKey),
      reservationIndexKey(userId, dayKey),
      reservationKeyPrefix(),
      String(now.getTime()),
      String(usageTtlSeconds(now))
    );
  }

  private async readPointTotals(
    userId: string,
    dayKey: string
  ): Promise<{ pointsUsed: number; pointsOutstanding: number }> {
    const redis = await getReadyRedis();
    if (!redis) {
      if (!failOpenOnRedisError()) {
        throw redisRequiredError();
      }
      return { pointsUsed: 0, pointsOutstanding: 0 };
    }
    try {
      await this.cleanupExpiredReservations(userId, dayKey, new Date());
      const [usedRaw, outstandingRaw] = await redis.mget(
        usedPointsKey(userId, dayKey),
        outstandingPointsKey(userId, dayKey)
      );
      const pointsUsed = usedRaw ? parseInt(usedRaw, 10) : 0;
      const pointsOutstanding = outstandingRaw ? parseInt(outstandingRaw, 10) : 0;
      return {
        pointsUsed: Number.isFinite(pointsUsed) ? pointsUsed : 0,
        pointsOutstanding: Math.max(0, Number.isFinite(pointsOutstanding) ? pointsOutstanding : 0),
      };
    } catch (error) {
      logger.warn({ err: error, userId }, 'AI quota read failed');
      if (failOpenOnRedisError()) {
        return { pointsUsed: 0, pointsOutstanding: 0 };
      }
      throw error;
    }
  }

  async getUsage(userId: string): Promise<AiUsageSnapshot> {
    const now = new Date();
    const dayKey = dayKeyForDate(now);
    const pointLimit = getPointLimit();
    const operationCosts = getOperationCosts();
    const { pointsUsed, pointsOutstanding } = await this.readPointTotals(userId, dayKey);
    const pointsRemaining = Math.max(0, pointLimit - pointsUsed - pointsOutstanding);
    const { periodStart, periodEnd } = periodBounds(now);
    return {
      period: 'daily',
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      pointLimit,
      pointsUsed,
      pointsOutstanding,
      pointsRemaining,
      operationCosts,
      resetsAt: periodEnd.toISOString(),
      serverNow: now.toISOString(),
    };
  }

  private throwQuotaExceeded(operation: AiOperation, snapshot: AiUsageSnapshot): never {
    throw new AiDailyQuotaExceededError('Daily AI limit reached', {
      operation,
      pointCost: getCost(operation),
      pointLimit: snapshot.pointLimit,
      pointsUsed: snapshot.pointsUsed,
      pointsOutstanding: snapshot.pointsOutstanding,
      pointsRemaining: snapshot.pointsRemaining,
      resetsAt: snapshot.resetsAt,
    });
  }

  async assertCanReserve(userId: string, operation: AiOperation): Promise<void> {
    const cost = getCost(operation);
    if (cost <= 0) {
      return;
    }
    const snapshot = await this.getUsage(userId);
    if (snapshot.pointsRemaining < cost) {
      this.throwQuotaExceeded(operation, snapshot);
    }
  }

  async reserve(userId: string, operation: AiOperation): Promise<AiReservationResult> {
    const cost = getCost(operation);
    const now = new Date();
    const dayKey = dayKeyForDate(now);
    const { periodEnd } = periodBounds(now);
    const resetsAt = periodEnd.toISOString();
    const pointLimit = getPointLimit();
    const reservationId = randomUUID();
    const reservationExpiresAt = new Date(now.getTime() + getReservationTtlSeconds() * 1000);
    const ttl = usageTtlSeconds(now);

    if (cost <= 0) {
      const snapshot = await this.getUsage(userId);
      return {
        reservationId,
        operation,
        pointCost: 0,
        pointLimit,
        pointsUsed: snapshot.pointsUsed,
        pointsOutstanding: snapshot.pointsOutstanding,
        pointsRemaining: snapshot.pointsRemaining,
        resetsAt,
        reservationExpiresAt: reservationExpiresAt.toISOString(),
        serverNow: now.toISOString(),
        usage: snapshot,
      };
    }

    const redis = await getReadyRedis();
    if (!redis) {
      if (!failOpenOnRedisError()) {
        throw redisRequiredError();
      }
      const snapshot = await this.getUsage(userId);
      return {
        reservationId,
        operation,
        pointCost: cost,
        pointLimit,
        pointsUsed: snapshot.pointsUsed,
        pointsOutstanding: snapshot.pointsOutstanding,
        pointsRemaining: snapshot.pointsRemaining,
        resetsAt,
        reservationExpiresAt: reservationExpiresAt.toISOString(),
        serverNow: now.toISOString(),
        usage: snapshot,
      };
    }

    try {
      const outstandingKey = outstandingPointsKey(userId, dayKey);
      const usedKey = usedPointsKey(userId, dayKey);
      const resKey = reservationKey(reservationId);
      const indexKey = reservationIndexKey(userId, dayKey);
      const raw = parseScriptResult(await redis.eval(
        RESERVE_SCRIPT,
        4,
        usedKey,
        outstandingKey,
        resKey,
        indexKey,
        reservationKeyPrefix(),
        reservationId,
        userId,
        operation,
        String(cost),
        String(pointLimit),
        dayKey,
        String(now.getTime()),
        String(reservationExpiresAt.getTime()),
        String(ttl)
      ));

      const applied = parseNumber(raw[0]) === 1;
      const pointsUsed = parseNumber(raw[1]);
      const pointsOutstanding = Math.max(0, parseNumber(raw[2]));
      const pointsRemaining = Math.max(0, parseNumber(raw[3]));
      const snapshot: AiUsageSnapshot = {
        period: 'daily',
        periodStart: periodBounds(now).periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        pointLimit,
        pointsUsed,
        pointsOutstanding,
        pointsRemaining,
        operationCosts: getOperationCosts(),
        resetsAt,
        serverNow: now.toISOString(),
      };
      if (!applied) {
        this.throwQuotaExceeded(operation, snapshot);
      }

      return {
        reservationId,
        operation,
        pointCost: cost,
        pointLimit,
        pointsUsed: snapshot.pointsUsed,
        pointsOutstanding: snapshot.pointsOutstanding,
        pointsRemaining: snapshot.pointsRemaining,
        resetsAt,
        reservationExpiresAt: reservationExpiresAt.toISOString(),
        serverNow: now.toISOString(),
        usage: snapshot,
      };
    } catch (error) {
      if (error instanceof AiDailyQuotaExceededError) {
        throw error;
      }
      logger.warn({ err: error, userId, operation }, 'AI quota reserve failed');
      if (failOpenOnRedisError()) {
        const snapshot = await this.getUsage(userId);
        return {
          reservationId,
          operation,
          pointCost: cost,
          pointLimit,
          pointsUsed: snapshot.pointsUsed,
          pointsOutstanding: snapshot.pointsOutstanding,
          pointsRemaining: snapshot.pointsRemaining,
          resetsAt,
          reservationExpiresAt: reservationExpiresAt.toISOString(),
          serverNow: now.toISOString(),
          usage: snapshot,
        };
      }
      throw error;
    }
  }

  async validateReservation(
    userId: string,
    reservationId: string,
    operation: AiOperation
  ): Promise<void> {
    const cost = getCost(operation);
    if (cost <= 0) {
      return;
    }
    const redis = await getReadyRedis();
    if (!redis) {
      if (!failOpenOnRedisError()) {
        throw redisRequiredError();
      }
      return;
    }
    try {
      const data = await redis.hgetall(reservationKey(reservationId));
      if (!data.userId || data.userId !== userId) {
        throw new ValidationError('Invalid AI reservation');
      }
      if (data.operation !== operation) {
        throw new ValidationError('AI reservation operation mismatch');
      }
      if (data.status !== 'pending') {
        throw new ValidationError('AI reservation is no longer active');
      }
      const expiresAt = parseNumber(data.expiresAt);
      if (expiresAt > 0 && expiresAt <= Date.now()) {
        await this.cleanupExpiredReservations(userId, data.dayKey ?? dayKeyForDate(new Date()), new Date());
        throw new ValidationError('AI reservation is no longer active');
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.warn({ err: error, userId, reservationId }, 'AI reservation validation failed');
      if (!failOpenOnRedisError()) {
        throw error;
      }
    }
  }

  async finalize(
    reservationId: string,
    outcome: AiReservationOutcome,
    expectedUserId?: string
  ): Promise<'applied' | 'already_finalized' | 'not_found'> {
    const redis = await getReadyRedis();
    if (!redis) {
      if (!failOpenOnRedisError()) {
        throw redisRequiredError();
      }
      return 'applied';
    }
    try {
      const key = reservationKey(reservationId);
      const data = await redis.hgetall(key);
      if (!data.userId) {
        return 'not_found';
      }
      if (expectedUserId && data.userId !== expectedUserId) {
        throw new ValidationError('Invalid AI reservation');
      }
      if (data.status !== 'pending') {
        return 'already_finalized';
      }

      const userId = data.userId;
      const dayKey = data.dayKey ?? dayKeyForDate(new Date());
      const now = new Date();
      const ttl = usageTtlSeconds(now);
      const usedKey = usedPointsKey(userId, dayKey);
      const outstandingKey = outstandingPointsKey(userId, dayKey);
      const indexKey = reservationIndexKey(userId, dayKey);
      const raw = parseScriptResult(await redis.eval(
        FINALIZE_SCRIPT,
        4,
        usedKey,
        outstandingKey,
        key,
        indexKey,
        reservationId,
        outcome,
        expectedUserId ?? '',
        String(now.getTime()),
        String(ttl)
      ));
      const result = parseNumber(raw[0]);
      if (result === -1) {
        throw new ValidationError('Invalid AI reservation');
      }
      if (result === 0) {
        return 'not_found';
      }
      if (result === 2) {
        return 'already_finalized';
      }
      return 'applied';
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      logger.warn({ err: error, reservationId, outcome }, 'AI quota finalize failed');
      if (failOpenOnRedisError()) {
        return 'applied';
      }
      throw error;
    }
  }

  async reserveForRequest(userId: string, operation: AiOperation): Promise<string> {
    const result = await this.reserve(userId, operation);
    return result.reservationId;
  }
}

export const aiUsageService = new AiUsageService();

export { OPERATIONS };
