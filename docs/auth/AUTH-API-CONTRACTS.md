# Authentication API Contracts

Bu belge authentication API sözleşmelerini tanımlar. Sprint 4C.2 itibarıyla `POST /auth/register` ve `POST /auth/login` uygulanmıştır; diğer endpointler sonraki alt sprintler için sözleşme durumundadır.

## Ortak kurallar

- Response tarihleri ISO 8601 UTC olmalıdır.
- Request DTO'ları NestJS DTO validation ile doğrulanmalıdır.
- DTO payload size limiti uygulanmalıdır.
- E-posta normalize edilerek küçük harfe çevrilmeli ve boşluklardan arındırılmalıdır.
- Parola hash öncesinde Unicode NFC normalization uygulanır; maksimum uzunluk kontrolü Argon2 çağrısından önce yapılır.
- Null byte ve sakıncalı kontrol karakterleri reddedilir.
- Role bilgisi request body, query veya client state içinden kabul edilmez.
- Refresh token response body içinde dönmez; HttpOnly cookie ile taşınır.
- Access token kısa ömürlü olduğu için response body içinde dönebilir ve istemci belleğinde tutulur.
- Her authenticated endpoint JWT doğrulamasından sonra `sid` ile session-active kontrolü yapar.
- Admin ve normal kullanıcı aynı auth altyapısını kullanır; erişim role guard ile ayrılır.

## JWT beklentileri

- JWT `alg`: `ES256`.
- JWT header içinde `kid` zorunludur.
- Payload zorunlu claimleri: `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud`.
- `iss`: `football-manager-auth`.
- `aud`: `football-manager-api`.
- Clock skew toleransı 5-10 saniye aralığında tutulur.
- Aktif key ve önceki public keyler sınırlı doğrulama penceresinde kabul edilir.
- Role change sonrası tüm sessionlar revoke edildiği için eski access tokenlar session-active kontrolünde reddedilir.

## CORS ve credential kuralları

- Production credential allowlist yalnız `https://app.example.com` ve `https://admin.example.com` originlerini kapsar.
- `Access-Control-Allow-Credentials=true` yalnız allowlist originlerde kullanılır.
- Wildcard origin ve credentials birlikte yasaktır.
- Development originleri environment üzerinden ayrıca listelenir.

## Ortak hata yapısı

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "E-posta veya şifre hatalı.",
    "requestId": "req_..."
  }
}
```

Hata mesajları kullanıcı varlığı, e-posta doğrulama durumu veya parola yanlışlığı hakkında gereksiz ayrıntı açıklamaz.

## Endpoint sözleşmeleri

| Endpoint | Auth | Request DTO | Response DTO | Durum kodları | Güvenli hata kodları | Rate limit | Audit log | Idempotency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `POST /auth/register` | Public | `{ email, password, displayName, locale?, timezone? }` | `{ status: "accepted", message }` | 202, 400, 429 | `AUTH_VALIDATION_FAILED`, `AUTH_RATE_LIMITED` | Register limiter boundary; Redis limit Sprint 4F | Yeni kullanıcı için `AUTH_REGISTERED` | Her zaman generic 202; e-posta zaten kayıtlıysa API açıklamaz ve kullanıcı verisi dönmez. |
| `POST /auth/login` | Public | `{ email, password, context? }` | `{ accessToken, tokenType, expiresIn, user }` + refresh cookie | 200, 400, 401, 429 | `AUTH_INVALID_CREDENTIALS`, `AUTH_RATE_LIMITED` | Login limiter boundary; Redis limit Sprint 4F | `AUTH_LOGIN_SUCCEEDED` veya `AUTH_LOGIN_FAILED` | Aynı credential tekrar yeni session oluşturur; rate limit korur. |
| `POST /auth/refresh` | Refresh cookie | Empty body | `{ accessToken, expiresIn, user: PublicUser }` + rotated refresh cookie | 200, 401, 409, 429 | `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_CONFLICT`, `AUTH_SESSION_REVOKED`, `AUTH_RATE_LIMITED` | Session + IP | `AUTH_REFRESH_ROTATED`, reuse varsa `AUTH_REFRESH_REUSE_DETECTED` | Token tek kullanımlıdır; kısa parallel yarışta 409 conflict döner, gerçek replay session revoke eder. |
| `POST /auth/logout` | Access token veya refresh cookie | Empty body | Empty | 204, 401 | `AUTH_UNAUTHORIZED` | User + IP | `AUTH_LOGOUT` | Idempotent; zaten çıkılmışsa 204 dönebilir. |
| `POST /auth/logout-all` | Access token | Empty body | Empty | 204, 401 | `AUTH_UNAUTHORIZED` | User + IP | `AUTH_LOGOUT_ALL` | Idempotent; active session yoksa 204. |
| `POST /auth/verify-email` | Public | `{ token }` | `{ status: "verified" }` | 200, 400, 410, 429 | `AUTH_VERIFICATION_INVALID`, `AUTH_VERIFICATION_EXPIRED`, `AUTH_RATE_LIMITED` | Token hash + IP | `AUTH_EMAIL_VERIFIED`, failed | Kullanılmış token tekrar geldiğinde güvenli genel sonuç dönebilir. |
| `POST /auth/resend-verification` | Public veya authenticated | `{ email }` | `{ status: "accepted" }` | 202, 400, 429 | `AUTH_RATE_LIMITED`, `AUTH_VALIDATION_FAILED` | IP + emailHash | `AUTH_EMAIL_VERIFICATION_RESENT` | Her zaman accepted; hesap varlığı açıklanmaz; önceki unused tokenlar revoke edilir. |
| `POST /auth/forgot-password` | Public | `{ email }` | `{ status: "accepted" }` | 202, 400, 429 | `AUTH_RATE_LIMITED`, `AUTH_VALIDATION_FAILED` | IP + emailHash | `AUTH_PASSWORD_RESET_REQUESTED` | Her zaman accepted; hesap varlığı açıklanmaz; önceki unused reset tokenlar revoke edilir. |
| `POST /auth/reset-password` | Public | `{ token, newPassword }` | `{ status: "password_reset" }` | 200, 400, 410, 429 | `AUTH_RESET_INVALID`, `AUTH_RESET_EXPIRED`, `AUTH_PASSWORD_POLICY_FAILED` | Token hash + IP | `AUTH_PASSWORD_RESET_COMPLETED`, failed | Başarılı kullanım tek seferliktir; tekrar kullanım invalid kabul edilir. |
| `POST /auth/change-password` | Access token + active session | `{ currentPassword, newPassword }` | `{ status: "password_changed" }` | 200, 400, 401, 429 | `AUTH_INVALID_CREDENTIALS`, `AUTH_PASSWORD_POLICY_FAILED`, `AUTH_RATE_LIMITED` | User + IP | `AUTH_PASSWORD_CHANGED` | Aynı istek tekrar current password değiştiği için başarısız olabilir. |
| `GET /auth/me` | Access token + active session | None | `{ user: PublicUser, session: CurrentSession }` | 200, 401 | `AUTH_UNAUTHORIZED`, `AUTH_SESSION_REVOKED` | Normal API limit | Opsiyonel `AUTH_ME_READ` metric | Read-only. |
| `GET /auth/sessions` | Access token + active session | None | `{ sessions: SessionSummary[] }` | 200, 401 | `AUTH_UNAUTHORIZED` | User limit | `AUTH_SESSIONS_LISTED` opsiyonel | Read-only. |
| `DELETE /auth/sessions/:sessionId` | Access token + active session | Path `sessionId` | Empty | 204, 401, 404 | `AUTH_UNAUTHORIZED`, `AUTH_SESSION_NOT_FOUND` | User limit | `AUTH_SESSION_REVOKED` | Idempotent; kullanıcıya ait olmayan veya yok session için 404. |

## Uygulanan register sözleşmesi

`POST /auth/register` şu body alanlarını kabul eder:

```json
{
  "email": "user@example.invalid",
  "password": "TestOnlyPass123",
  "displayName": "Fatih Manager",
  "locale": "tr-TR",
  "timezone": "Europe/Istanbul"
}
```

- `email` trim/lowercase normalize edilir ve maksimum 254 karakterdir.
- `password` `PasswordService` politikasıyla doğrulanır ve Argon2id ile hashlenir.
- `displayName` trim edilir, 2-40 karakter arasında olmalıdır.
- `locale` opsiyoneldir, varsayılan `tr-TR`, maksimum 20 karakterdir.
- `timezone` opsiyoneldir, varsayılan `Europe/Istanbul`, maksimum 64 karakterdir.
- `role` veya başka desteklenmeyen client alanları kabul edilmez.

Başarılı veya duplicate kabul edilen response:

```json
{
  "status": "accepted",
  "message": "Kayıt isteğiniz alındı. Uygunsa e-posta adresinize doğrulama bağlantısı gönderilecektir."
}
```

Yeni kullanıcı için transaction içinde `User`, `ManagerProfile`, `EmailVerificationToken` ve `AuditLog` oluşturulur. Register akışı bu sprintte `UserSession`, `RefreshToken`, `LoginAttempt`, `Club` veya gerçek e-posta gönderimi oluşturmaz.

## Uygulanan login sözleşmesi

`POST /auth/login` şu body alanlarını kabul eder:

```json
{
  "email": "user@example.invalid",
  "password": "TestOnlyPass123",
  "context": "WEB"
}
```

- `email` trim/lowercase normalize edilir ve maksimum 254 karakterdir.
- `password` string olmalı, maksimum 128 karakterdir; null byte ve sakıncalı kontrol karakterleri reddedilir.
- `context` opsiyoneldir; yalnız `WEB` veya `ADMIN` kabul edilir, varsayılan `WEB` olur.
- `role`, `userId`, `sessionId`, `isActive` veya başka client controlled auth alanları kabul edilmez.

Başarılı response:

```json
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": 900,
  "user": {
    "id": "uuid",
    "email": "user@example.invalid",
    "role": "USER",
    "managerProfile": {
      "displayName": "Manager"
    }
  }
}
```

Refresh token response body içinde dönmez; yalnız HttpOnly refresh cookie ile taşınır. Başarılı login transaction içinde `UserSession`, ilk `RefreshToken`, `LoginAttempt`, `AuditLog` ve `User.lastLoginAt` yazar.

Tüm credential failure durumları aynı dış response ile döner:

```json
{
  "error": {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "E-posta veya şifre hatalı.",
    "requestId": "req_..."
  }
}
```

Aşağıdaki durumlar dışarıda ayrıştırılmaz: kullanıcı bulunamadı, parola yanlış, hesap devre dışı, e-posta doğrulanmamış. Bu nedenle doğrulanmamış e-posta için ayrı `AUTH_EMAIL_NOT_VERIFIED` response kullanılmaz.

## Refresh conflict davranışı

`AUTH_REFRESH_CONFLICT`, yalnız kısa parallel refresh yarışını ifade eder; e-posta enumeration ile ilgisi yoktur.

- HTTP 409 kullanılabilir.
- Session otomatik revoke edilmez.
- İstemci kısa jitter sonrası yalnız bir kez yeniden deneyebilir.
- Sürekli tekrar durumunda login ekranına yönlendirilir.
- Grace window dışındaki eski token kullanımı `AUTH_REFRESH_INVALID` veya reuse detection ile session revoke sonucuna gider.

## DTO şekilleri

### PublicUser

```json
{
  "id": "uuid",
  "email": "user@example.invalid",
  "role": "USER",
  "emailVerified": true,
  "isActive": true
}
```

`PublicUser` içinde parola hash, token bilgisi, internal flags veya güvenlik metadata bulunmaz.

### CurrentSession

```json
{
  "id": "uuid",
  "deviceName": "Windows Chrome",
  "deviceType": "desktop",
  "browser": "Chrome",
  "operatingSystem": "Windows",
  "countryCode": "TR",
  "city": "Istanbul",
  "lastSeenAt": "2026-07-16T10:00:00.000Z",
  "expiresAt": "2026-08-15T10:00:00.000Z"
}
```

Raw IP ve tam user-agent response içinde dönmez.

## Hata kodları

| Kod | Anlam |
| --- | --- |
| `AUTH_INVALID_CREDENTIALS` | Login veya password check başarısız; neden ayrıştırılmaz. |
| `AUTH_UNAUTHORIZED` | Access token eksik, geçersiz, süresi dolmuş veya session-active kontrolünden geçememiş. |
| `AUTH_FORBIDDEN` | Kullanıcı authenticated ve session active ancak role veya policy yetersiz. |
| `AUTH_SESSION_REVOKED` | Session iptal edilmiş veya geçersiz. |
| `AUTH_REFRESH_INVALID` | Refresh cookie yok, hash eşleşmedi, süresi doldu veya revoked. |
| `AUTH_REFRESH_CONFLICT` | Kısa parallel refresh yarışında ikinci istek kontrollü reddedildi. |
| `AUTH_RATE_LIMITED` | IP, user, session veya emailHash limitine takıldı. |
| `AUTH_PASSWORD_POLICY_FAILED` | Yeni parola policy'yi karşılamıyor. |
| `AUTH_VERIFICATION_INVALID` | E-posta doğrulama tokenı geçersiz. |
| `AUTH_RESET_INVALID` | Şifre sıfırlama tokenı geçersiz. |

## Cookie sözleşmesi

Production refresh cookie:

- Ad: `__Host-refresh_token`.
- Domain attribute kullanılmaz; cookie host-only kalır.
- Host scope: `api.example.com`.
- `Path=/`.
- `Secure=true`.
- `HttpOnly=true`.
- `SameSite=Lax`.

`__Host-` prefix güvenliği için Domain attribute kullanılmaz ve `Path=/` zorunludur. Bu bilinçli olarak dar path yerine host-only güvenlik modelini seçer.

Development refresh cookie:

- Localhost için prefix'siz cookie adı kullanılabilir.
- `Secure=false` olabilir.
- `SameSite=Lax` korunur.
- Environment bazlı cookie config kullanılır.
- Config validation production ayarlarının yanlışlıkla development'a veya development gevşekliğinin production'a sızmasını engellemelidir.

Logout, refresh replay ve session revoke durumunda cookie expire edilmelidir.
