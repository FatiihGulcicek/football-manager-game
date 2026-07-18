import { Prisma } from '@football-manager/database';

export function createAuthLockKey(purpose: string, subject: string): string {
  return `${purpose}:${subject}`;
}

export function createAuthUserLockKey(purpose: string, userId: string): string {
  return createAuthLockKey(purpose, userId);
}

export async function lockAuthTransaction(
  transaction: Prisma.TransactionClient,
  purpose: string,
  subject: string
): Promise<void> {
  const lockKey = createAuthLockKey(purpose, subject);
  await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
}

export async function lockAuthUserTransaction(
  transaction: Prisma.TransactionClient,
  purpose: string,
  userId: string
): Promise<void> {
  await lockAuthTransaction(transaction, purpose, userId);
}
