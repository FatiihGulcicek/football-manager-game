import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { AUTH_CONFIG, authConfig, AuthConfig } from '../../config/auth.config';

export class PasswordValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordValidationError';
  }
}

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly dummyPassword = randomBytes(32).toString('base64url');
  private dummyPasswordHashPromise?: Promise<string>;

  constructor(@Optional() @Inject(AUTH_CONFIG) private readonly config: AuthConfig = authConfig) {}

  async onModuleInit(): Promise<void> {
    await this.getDummyPasswordHash();
  }

  async hashPassword(password: string): Promise<string> {
    const normalizedPassword = this.validatePassword(password);

    return argon2.hash(normalizedPassword, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryCost,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism
    });
  }

  async verifyPassword(hash: string, password: string): Promise<boolean> {
    const normalizedPassword = this.normalizePasswordForVerification(password);

    if (!normalizedPassword) {
      return false;
    }

    try {
      return await argon2.verify(hash, normalizedPassword);
    } catch {
      return false;
    }
  }

  async verifyAgainstDummy(password: string): Promise<boolean> {
    return this.verifyPassword(await this.getDummyPasswordHash(), password);
  }

  getDummyPasswordHash(): Promise<string> {
    this.dummyPasswordHashPromise ??= this.createDummyPasswordHash();
    return this.dummyPasswordHashPromise;
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, {
      memoryCost: this.config.argon2MemoryCost,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism
    });
  }

  validatePassword(password: string): string {
    const normalizedPassword = this.normalizePassword(password);
    const length = Array.from(normalizedPassword).length;

    if (length < 10) {
      throw new PasswordValidationError('Password must be at least 10 characters long');
    }

    if (length > 128) {
      throw new PasswordValidationError('Password must be at most 128 characters long');
    }

    if (!/\p{L}/u.test(normalizedPassword)) {
      throw new PasswordValidationError('Password must contain at least one letter');
    }

    if (!/\p{N}/u.test(normalizedPassword)) {
      throw new PasswordValidationError('Password must contain at least one number');
    }

    return normalizedPassword;
  }

  private normalizePasswordForVerification(password: string): string | null {
    try {
      const normalizedPassword = this.normalizePassword(password);

      if (Array.from(normalizedPassword).length > 128) {
        return null;
      }

      return normalizedPassword;
    } catch {
      return null;
    }
  }

  private normalizePassword(password: string): string {
    const normalizedPassword = password.normalize('NFC');

    if (normalizedPassword.includes('\0')) {
      throw new PasswordValidationError('Password must not contain null bytes');
    }

    if (containsControlCharacter(normalizedPassword)) {
      throw new PasswordValidationError('Password must not contain control characters');
    }

    return normalizedPassword;
  }

  private createDummyPasswordHash(): Promise<string> {
    return argon2.hash(this.dummyPassword, {
      type: argon2.argon2id,
      memoryCost: this.config.argon2MemoryCost,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism
    });
  }
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
