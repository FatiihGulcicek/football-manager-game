import { BadRequestException } from '@nestjs/common';

const EMAIL_MAX_LENGTH = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmailInput(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.includes('\0') || containsControlCharacter(value)) {
    return value.toLowerCase();
  }

  return value.trim().toLowerCase();
}

export function normalizeAuthEmail(email: string): string {
  const safeEmail = assertSafeEmailText(email.toLowerCase());
  const normalizedEmail = safeEmail.trim();

  if (normalizedEmail.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(normalizedEmail)) {
    throw new BadRequestException('Invalid email');
  }

  return normalizedEmail;
}

function assertSafeEmailText(value: string): string {
  if (value.includes('\0') || containsControlCharacter(value)) {
    throw new BadRequestException('Invalid email');
  }

  return value;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && ((codePoint >= 1 && codePoint <= 31) || codePoint === 127)) {
      return true;
    }
  }

  return false;
}
