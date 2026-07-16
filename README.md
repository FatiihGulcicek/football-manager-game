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

Authentication environment placeholders live in `.env.example`. Development may use a prefixless refresh cookie and `AUTH_COOKIE_SECURE=false`; if local JWT key variables are omitted, the API creates process-local ephemeral development keys. Production must use `__Host-refresh_token`, `AUTH_COOKIE_SECURE=true`, `AUTH_COOKIE_DOMAIN` empty, `AUTH_COOKIE_PATH=/`, and real JWT key material from a secret manager.

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

## Auth smoke checks

Register accepts a new account request and returns the same generic response for duplicate email attempts:

```powershell
$baseUrl = "http://localhost:4000"
$registerPayload = @{
  email = "smoke-register@example.invalid"
  password = "TestOnlyPass123"
  displayName = "Smoke Manager"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/register" -ContentType "application/json" -Body $registerPayload
```

Login returns an access token in the response body and an HttpOnly refresh cookie:

```powershell
$loginPayload = @{
  email = "smoke-register@example.invalid"
  password = "TestOnlyPass123"
  context = "WEB"
} | ConvertTo-Json

$loginResponse = Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/login" -ContentType "application/json" -Body $loginPayload
$loginResponse.Content
$loginResponse.Headers["Set-Cookie"]
```

Until the email verification endpoint exists, local manual login checks require setting `emailVerifiedAt` for the local test user through a controlled development DB update.

Refresh rotates the HttpOnly refresh cookie and returns a new access token. The request body stays empty; do not put the refresh token in JSON, query params, or headers:

```powershell
$cookieHeader = ($loginResponse.Headers["Set-Cookie"] -split ";")[0]
$refreshResponse = Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/refresh" -Headers @{
  Cookie = $cookieHeader
}

$refreshResponse.Content
$refreshResponse.Headers["Set-Cookie"]
```

An immediate second request with the old cookie may return `AUTH_REFRESH_CONFLICT`; replay outside the grace window revokes the session.

Authenticated session management uses the access token and keeps refresh tokens in cookies only:

```powershell
$accessToken = ($refreshResponse.Content | ConvertFrom-Json).accessToken

$sessionsResponse = Invoke-RestMethod -Method Get -Uri "$baseUrl/auth/sessions" -Headers @{
  Authorization = "Bearer $accessToken"
}

$sessionsResponse.sessions | Select-Object id, deviceName, isCurrent, lastSeenAt, expiresAt
```

Revoke a different device session by using an id returned from `/auth/sessions`. This example skips the current session:

```powershell
$targetSessionId = ($sessionsResponse.sessions | Where-Object { -not $_.isCurrent } | Select-Object -First 1).id

if ($targetSessionId) {
  Invoke-WebRequest -Method Delete -Uri "$baseUrl/auth/sessions/$targetSessionId" -Headers @{
    Authorization = "Bearer $accessToken"
  }
}
```

Logout all devices revokes every active session for the authenticated user, clears the refresh cookie, and returns 204:

```powershell
$latestCookieHeader = ($refreshResponse.Headers["Set-Cookie"] -split ";")[0]
$logoutAllResponse = Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/logout-all" -Headers @{
  Authorization = "Bearer $accessToken"
  Cookie = $latestCookieHeader
}

$logoutAllResponse.StatusCode
$logoutAllResponse.Headers["Set-Cookie"]
```

Logout closes only the current session represented by the refresh cookie, clears the HttpOnly cookie, and returns an empty 204 response. Do not send the refresh token in JSON, query params, or headers:

```powershell
$latestCookieHeader = ($refreshResponse.Headers["Set-Cookie"] -split ";")[0]
$logoutResponse = Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/logout" -Headers @{
  Cookie = $latestCookieHeader
}

$logoutResponse.StatusCode
$logoutResponse.Headers["Set-Cookie"]
```

Calling logout again with the same or a missing cookie is safe and should still return 204.
