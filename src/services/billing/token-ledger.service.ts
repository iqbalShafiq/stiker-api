import { prisma } from '../../prisma/client';
import { AppError } from '../../errors';
import type { Prisma } from '@prisma/client';

export class TokenLedgerService {
  async getBalance(userId: string): Promise<number> {
    const row = await prisma.userCreditBalance.findUnique({ where: { userId } });
    return row?.balance ?? 0;
  }

  async credit(params: {
    userId: string;
    amount: number;
    reason: string;
    source: string;
    idempotencyKey: string;
    purchaseId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ balanceAfter: number; alreadyApplied: boolean }> {
    if (params.amount <= 0) {
      throw new AppError('Credit amount must be positive', 400, 'VALIDATION_ERROR');
    }

    const existing = await prisma.tokenLedgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return { balanceAfter: existing.balanceAfter, alreadyApplied: true };
    }

    return prisma.$transaction(async (tx) => {
      const balance = await tx.userCreditBalance.upsert({
        where: { userId: params.userId },
        create: { userId: params.userId, balance: params.amount },
        update: { balance: { increment: params.amount } },
      });

      await tx.tokenLedgerEntry.create({
        data: {
          userId: params.userId,
          purchaseId: params.purchaseId,
          delta: params.amount,
          balanceAfter: balance.balance,
          reason: params.reason,
          source: params.source,
          idempotencyKey: params.idempotencyKey,
          metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      return { balanceAfter: balance.balance, alreadyApplied: false };
    });
  }

  async debit(params: {
    userId: string;
    amount: number;
    reason: string;
    source: string;
    idempotencyKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ balanceAfter: number; applied: boolean }> {
    if (params.amount <= 0) {
      throw new AppError('Debit amount must be positive', 400, 'VALIDATION_ERROR');
    }

    const existing = await prisma.tokenLedgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return { balanceAfter: existing.balanceAfter, applied: true };
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.$executeRaw`
        UPDATE "UserCreditBalance"
        SET balance = balance - ${params.amount}, "updatedAt" = NOW()
        WHERE "userId" = ${params.userId} AND balance >= ${params.amount}
      `;

      if (updated === 0) {
        return { balanceAfter: await this.getBalanceInTx(tx, params.userId), applied: false };
      }

      const balanceRow = await tx.userCreditBalance.findUniqueOrThrow({
        where: { userId: params.userId },
      });

      await tx.tokenLedgerEntry.create({
        data: {
          userId: params.userId,
          delta: -params.amount,
          balanceAfter: balanceRow.balance,
          reason: params.reason,
          source: params.source,
          idempotencyKey: params.idempotencyKey,
          metadata: (params.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });

      return { balanceAfter: balanceRow.balance, applied: true };
    });
  }

  async reverseCredit(params: {
    userId: string;
    amount: number;
    reason: string;
    source: string;
    idempotencyKey: string;
    purchaseId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ balanceAfter: number }> {
    const existing = await prisma.tokenLedgerEntry.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      return { balanceAfter: existing.balanceAfter };
    }

    return prisma.$transaction(async (tx) => {
      const row = await tx.userCreditBalance.findUnique({ where: { userId: params.userId } });
      const current = row?.balance ?? 0;
      const next = Math.max(0, current - params.amount);
      const clamped = next !== current - params.amount;

      await tx.userCreditBalance.upsert({
        where: { userId: params.userId },
        create: { userId: params.userId, balance: 0 },
        update: { balance: next },
      });

      await tx.tokenLedgerEntry.create({
        data: {
          userId: params.userId,
          purchaseId: params.purchaseId,
          delta: next - current,
          balanceAfter: next,
          reason: params.reason,
          source: params.source,
          idempotencyKey: params.idempotencyKey,
          metadata: { ...(params.metadata ?? {}), clamped } as Prisma.InputJsonValue,
        },
      });

      return { balanceAfter: next };
    });
  }

  private async getBalanceInTx(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    userId: string
  ): Promise<number> {
    const row = await tx.userCreditBalance.findUnique({ where: { userId } });
    return row?.balance ?? 0;
  }
}

export const tokenLedgerService = new TokenLedgerService();
