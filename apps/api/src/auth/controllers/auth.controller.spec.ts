import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole } from '@football-manager/database';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_CONFIG, AuthConfig } from '../../config/auth.config';
import { PrismaService } from '../../database/prisma.service';
import { AUTH_AUDIT_EVENTS } from '../constants/auth-audit-events';
import { REGISTER_ACCEPTED_RESPONSE } from '../dto/register.dto';
import { EmailVerificationResendService } from '../services/email-verification-resend.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { PasswordService } from '../services/password.service';
import { RegisterRateLimitService } from '../services/register-rate-limit.service';
import { RegisterService } from '../services/register.service';
import { TokenHashService } from '../services/token-hash.service';
import { LoginService } from '../services/login.service';
import { LogoutService } from '../services/logout.service';
import { RefreshService } from '../services/refresh.service';
import { AuthController } from './auth.controller';

const config: AuthConfig = {
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerifyTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  refreshGraceSeconds: 5,
  jwtIssuer: 'football-manager-auth',
  jwtAudience: 'football-manager-api',
  jwtActiveKid: 'test',
  jwtPrivateKey: 'unused',
  jwtPublicKeys: { test: 'unused' },
  tokenPepper: 'test-pepper',
  cookieName: 'refresh_token',
  cookieSecure: false,
  cookieSameSite: 'lax',
  cookiePath: '/',
  trustProxyCidrs: [],
  argon2MemoryCost: 1_024,
  argon2TimeCost: 2,
  argon2Parallelism: 1
};

describe('AuthController register', () => {
  let app: INestApplication;
  let database: InMemoryRegisterDatabase;

  beforeEach(async () => {
    database = createInMemoryRegisterDatabase();

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        RegisterService,
        RegisterRateLimitService,
        {
          provide: AUTH_CONFIG,
          useValue: config
        },
        {
          provide: LoginService,
          useValue: {
            login: vi.fn()
          }
        },
        {
          provide: EmailVerificationService,
          useValue: {
            verifyEmail: vi.fn()
          }
        },
        {
          provide: EmailVerificationResendService,
          useValue: {
            resendVerification: vi.fn()
          }
        },
        {
          provide: RefreshService,
          useValue: {
            refresh: vi.fn()
          }
        },
        {
          provide: LogoutService,
          useValue: {
            logout: vi.fn()
          }
        },
        {
          provide: PrismaService,
          useValue: database.prisma
        },
        {
          provide: PasswordService,
          useValue: new PasswordService(config)
        },
        {
          provide: TokenHashService,
          useValue: {
            generateOpaqueToken: vi.fn(() => 'opaque-verification-fixture'),
            hashToken: vi.fn(() => 'hashed-email-verification-token')
          }
        }
      ]
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true
      })
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('should accept a valid registration and create the starting auth records', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: '  NEW.USER@Example.INVALID  ',
        password: 'TestOnlyPass123',
        displayName: '  Fatih Manager  '
      })
      .expect(202);

    expect(response.body).toEqual(REGISTER_ACCEPTED_RESPONSE);
    expect(database.users).toHaveLength(1);
    expect(database.users[0]).toMatchObject({
      email: 'new.user@example.invalid',
      role: UserRole.USER,
      isActive: true,
      emailVerifiedAt: null
    });
    expect(database.users[0].passwordHash).not.toBe('TestOnlyPass123');
    expect(database.users[0].passwordHash).not.toContain('TestOnlyPass123');
    expect(database.managerProfiles[0]).toMatchObject({
      userId: database.users[0].id,
      displayName: 'Fatih Manager',
      locale: 'tr-TR',
      timezone: 'Europe/Istanbul'
    });
    expect(database.emailVerificationTokens[0]).toMatchObject({
      userId: database.users[0].id,
      tokenHash: 'hashed-email-verification-token',
      usedAt: null,
      revokedAt: null
    });
    expect(database.emailVerificationTokens[0].tokenHash).not.toBe('opaque-verification-fixture');
    expect(JSON.stringify(database)).not.toContain('opaque-verification-fixture');
    expect(database.auditLogs[0]).toMatchObject({
      actorUserId: database.users[0].id,
      targetUserId: database.users[0].id,
      action: AUTH_AUDIT_EVENTS.REGISTERED,
      entityType: 'User',
      entityId: database.users[0].id,
      metadata: {
        context: 'WEB',
        locale: 'tr-TR',
        timezone: 'Europe/Istanbul'
      }
    });
  });

  it('should return the same accepted response for duplicate registrations', async () => {
    const payload = {
      email: 'duplicate@example.invalid',
      password: 'TestOnlyPass123',
      displayName: 'Duplicate Manager'
    };

    const firstResponse = await request(app.getHttpServer()).post('/auth/register').send(payload).expect(202);
    const duplicateResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(202);

    expect(firstResponse.body).toEqual(REGISTER_ACCEPTED_RESPONSE);
    expect(duplicateResponse.body).toEqual(firstResponse.body);
    expect(database.users).toHaveLength(1);
    expect(database.emailVerificationTokens).toHaveLength(1);
    expect(database.auditLogs).toHaveLength(1);
  });

  it('should reject invalid request bodies before writing records', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'not-an-email',
        password: 'TestOnlyPass123',
        displayName: 'Manager'
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'weak@example.invalid',
        password: 'short1',
        displayName: 'Manager'
      })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'name@example.invalid',
        password: 'TestOnlyPass123',
        displayName: 'A'
      })
      .expect(400);

    expect(database.users).toHaveLength(0);
    expect(database.managerProfiles).toHaveLength(0);
    expect(database.emailVerificationTokens).toHaveLength(0);
    expect(database.auditLogs).toHaveLength(0);
  });

  it('should reject client supplied roles', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'role@example.invalid',
        password: 'TestOnlyPass123',
        displayName: 'Manager',
        role: 'ADMIN'
      })
      .expect(400);

    expect(database.users).toHaveLength(0);
  });
});

type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  emailVerifiedAt: Date | null;
};

type StoredManagerProfile = {
  userId: string;
  displayName: string;
  locale: string;
  timezone: string;
};

type StoredEmailVerificationToken = {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
};

type StoredAuditLog = {
  actorUserId: string;
  targetUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, string>;
};

type InMemoryRegisterDatabase = {
  users: StoredUser[];
  managerProfiles: StoredManagerProfile[];
  emailVerificationTokens: StoredEmailVerificationToken[];
  auditLogs: StoredAuditLog[];
  prisma: {
    $transaction: <T>(callback: (transaction: InMemoryRegisterTransaction) => Promise<T>) => Promise<T>;
  };
};

type InMemoryRegisterTransaction = ReturnType<typeof createInMemoryRegisterTransaction>;

function createInMemoryRegisterDatabase(): InMemoryRegisterDatabase {
  const database = {
    users: [] as StoredUser[],
    managerProfiles: [] as StoredManagerProfile[],
    emailVerificationTokens: [] as StoredEmailVerificationToken[],
    auditLogs: [] as StoredAuditLog[],
    prisma: {
      $transaction: async <T>(callback: (transaction: InMemoryRegisterTransaction) => Promise<T>) =>
        callback(createInMemoryRegisterTransaction(database))
    }
  };

  return database;
}

function createInMemoryRegisterTransaction(database: Omit<InMemoryRegisterDatabase, 'prisma'>) {
  return {
    user: {
      findUnique: async ({ where }: { where: { email: string } }) => {
        const user = database.users.find((storedUser) => storedUser.email === where.email);
        return user ? { id: user.id } : null;
      },
      create: async ({
        data
      }: {
        data: Omit<StoredUser, 'id'>;
        select: { id: true };
      }) => {
        const existingUser = database.users.find((storedUser) => storedUser.email === data.email);

        if (existingUser) {
          throw new Error('Unique constraint failed');
        }

        const user = {
          id: `user-${database.users.length + 1}`,
          ...data
        };
        database.users.push(user);

        return {
          id: user.id
        };
      }
    },
    managerProfile: {
      create: async ({ data }: { data: StoredManagerProfile }) => {
        database.managerProfiles.push(data);
      }
    },
    emailVerificationToken: {
      updateMany: async ({
        where,
        data
      }: {
        where: { userId: string; usedAt: null; revokedAt: null };
        data: { revokedAt: Date };
      }) => {
        let count = 0;

        for (const token of database.emailVerificationTokens) {
          if (token.userId === where.userId && token.usedAt === null && token.revokedAt === null) {
            token.revokedAt = data.revokedAt;
            count += 1;
          }
        }

        return { count };
      },
      create: async ({ data }: { data: StoredEmailVerificationToken }) => {
        database.emailVerificationTokens.push(data);
      }
    },
    auditLog: {
      create: async ({ data }: { data: StoredAuditLog }) => {
        database.auditLogs.push(data);
      }
    }
  };
}
