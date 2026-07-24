import crypto from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma/client';
import { config } from '../config';
import { ValidationError } from '../errors';
import { privacyNotificationService } from './privacy-notification.service';

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_IP_PER_HOUR = 5;
const MAX_REQUESTS_PER_EMAIL_PER_DAY = 3;

const recentIpRequests = new Map<string, number[]>();
const recentEmailRequests = new Map<string, number[]>();

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function pruneAndCount(map: Map<string, number[]>, key: string, windowMs: number): number {
  const now = Date.now();
  const existing = (map.get(key) ?? []).filter((ts) => now - ts < windowMs);
  map.set(key, existing);
  return existing.length;
}

function recordRequest(map: Map<string, number[]>, key: string, windowMs: number): void {
  const now = Date.now();
  const existing = (map.get(key) ?? []).filter((ts) => now - ts < windowMs);
  existing.push(now);
  map.set(key, existing);
}

export class AccountDeletionRequestService {
  async submitWebRequest(input: {
    email: string;
    reason?: string;
    confirmed: boolean;
    ip?: string;
  }): Promise<{ message: string; requestId: string }> {
    const email = input.email?.trim().toLowerCase();
    if (!email?.includes('@')) {
      throw new ValidationError('A valid account email is required');
    }
    if (!input.confirmed) {
      throw new ValidationError('You must confirm that you understand account deletion is permanent');
    }

    const emailHash = hashValue(email);
    const ipHash = input.ip ? hashValue(input.ip) : undefined;

    if (ipHash) {
      const ipCount = pruneAndCount(recentIpRequests, ipHash, RATE_LIMIT_WINDOW_MS);
      if (ipCount >= MAX_REQUESTS_PER_IP_PER_HOUR) {
        throw new ValidationError('Too many requests. Please try again later or contact support.');
      }
    }

    const emailCount = pruneAndCount(recentEmailRequests, emailHash, 24 * 60 * 60 * 1000);
    if (emailCount >= MAX_REQUESTS_PER_EMAIL_PER_DAY) {
      throw new ValidationError('A deletion request for this email was already submitted recently.');
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const reason = input.reason?.trim().slice(0, 1000) ?? null;

    const request = await prisma.accountDeletionRequest.create({
      data: {
        emailHash,
        reason,
        source: 'WEB',
        ipHash: ipHash ?? null,
        userId: user?.id ?? null,
        status: 'PENDING',
      },
    });

    if (ipHash) {
      recordRequest(recentIpRequests, ipHash, RATE_LIMIT_WINDOW_MS);
    }
    recordRequest(recentEmailRequests, emailHash, 24 * 60 * 60 * 1000);

    const emailDomain = email.includes('@') ? email.split('@')[1] ?? null : null;
    void privacyNotificationService.notifyAccountDeletionRequest({
      requestId: request.id,
      emailDomain,
      hasMatchingUser: user != null,
      source: 'WEB',
    });

    const graceDays = config.legal.deletedAccountGraceDays;
    return {
      requestId: request.id,
      message:
        `We received your account deletion request. If an account exists for this email, ` +
        `we will process it within ${graceDays} days. Contact ${config.legal.privacyEmail} with reference ${request.id.slice(0, 8)}.`,
    };
  }

  async listPending(limit = 50): Promise<Prisma.AccountDeletionRequestGetPayload<object>[]> {
    return prisma.accountDeletionRequest.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markProcessed(id: string, status: 'PROCESSED' | 'REJECTED'): Promise<void> {
    await prisma.accountDeletionRequest.update({
      where: { id },
      data: { status, processedAt: new Date() },
    });
  }
}

export const accountDeletionRequestService = new AccountDeletionRequestService();
