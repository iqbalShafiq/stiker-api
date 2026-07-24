import { describe, it, expect, beforeEach } from 'vitest';
import { TokenLedgerService } from '../../../src/services/billing/token-ledger.service';
import { prisma } from '../../../src/prisma/client';

describe('TokenLedgerService', () => {
  const service = new TokenLedgerService();
  let userId: string;

  beforeEach(async () => {
    const userRole = await prisma.role.findUniqueOrThrow({ where: { name: 'user' } });
    const user = await prisma.user.create({
      data: {
        email: `ledger-${Date.now()}@example.com`,
        username: `ledger${Date.now()}`,
        passwordHash: 'hash',
        roleId: userRole.id,
      },
    });
    userId = user.id;
  });

  it('credits and debits atomically', async () => {
    const credit = await service.credit({
      userId,
      amount: 100,
      reason: 'test_credit',
      source: 'test',
      idempotencyKey: `credit-${userId}`,
    });
    expect(credit.balanceAfter).toBe(100);
    expect(credit.alreadyApplied).toBe(false);

    const duplicate = await service.credit({
      userId,
      amount: 100,
      reason: 'test_credit',
      source: 'test',
      idempotencyKey: `credit-${userId}`,
    });
    expect(duplicate.alreadyApplied).toBe(true);
    expect(duplicate.balanceAfter).toBe(100);

    const debit = await service.debit({
      userId,
      amount: 30,
      reason: 'test_debit',
      source: 'test',
      idempotencyKey: `debit-${userId}`,
    });
    expect(debit.applied).toBe(true);
    expect(debit.balanceAfter).toBe(70);

    const insufficient = await service.debit({
      userId,
      amount: 100,
      reason: 'test_debit_fail',
      source: 'test',
      idempotencyKey: `debit-fail-${userId}`,
    });
    expect(insufficient.applied).toBe(false);
    expect(await service.getBalance(userId)).toBe(70);
  });
});
