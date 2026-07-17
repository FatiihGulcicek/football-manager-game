import { Prisma } from '@football-manager/database';

export function createAuthUserLockKey(purpose: string, userId: string): string {
  return `${purpose}:${userId}`;
}

export async function lockAuthUserTransaction(
  transaction: Prisma.TransactionClient,
  purpose: string,
  userId: string
): Promise<void> {
  const lockKey = createAuthUserLockKey(purpose, userId);
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}
