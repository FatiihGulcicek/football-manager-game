# football-manager-game

## Local environment

Create a local environment file before starting infrastructure:

```powershell
Copy-Item .env.example .env
```

Fill only local development values in `.env`. Keep `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEYS_JSON`, and `AUTH_TOKEN_PEPPER` out of Git. A local `DATABASE_URL` should follow this shape:

```text
postgresql://football_manager:<POSTGRES_PASSWORD>@localhost:5432/football_manager
```

Prisma string length limits that are not supported directly by the schema should be enforced in service or DTO validation.

Authentication environment placeholders live in `.env.example`. Development may use a prefixless refresh cookie and `AUTH_COOKIE_SECURE=false`; production must use `__Host-refresh_token`, `AUTH_COOKIE_SECURE=true`, `AUTH_COOKIE_DOMAIN` empty, `AUTH_COOKIE_PATH=/`, and real JWT key material from a secret manager.

## Docker services

Start PostgreSQL, Redis, and the API service:

```powershell
pnpm docker:up
```

Check container status and health:

```powershell
pnpm docker:ps
```

View logs:

```powershell
pnpm docker:logs
```

Stop services:

```powershell
pnpm docker:down
```

Docker volumes contain local database and Redis data. Delete volumes only when you intentionally want to remove local state.

## Database workflow

Format and validate the Prisma schema:

```powershell
pnpm db:format
pnpm db:validate
```

Generate Prisma Client:

```powershell
pnpm db:generate
```

Create or apply the local development migration:

```powershell
pnpm db:migrate
```

Create the Sprint 4B auth foundation migration directly with Prisma CLI:

```powershell
pnpm exec prisma migrate dev --schema packages/database/prisma/schema.prisma --name add_auth_foundation
```

Deploy existing migrations in CI or production-like environments:

```powershell
pnpm db:deploy
```

Open Prisma Studio:

```powershell
pnpm db:studio
```
