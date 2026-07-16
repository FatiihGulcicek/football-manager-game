# Authentication API Contracts

Bu belge API sözleşmesini tasarlar. Bu sprintte endpoint kodu yazılmaz.

## Ortak kurallar

- Response tarihleri ISO 8601 UTC olmalıdır.
- Request DTO'ları NestJS DTO validation ile doğrulanmalıdır.
- E-posta normalize edilerek küçük harfe çevrilmeli ve boşluklardan arındırılmalıdır.
- Role bilgisi request body içinden kabul edilmez.
- Refresh token response body içinde dönmez; HttpOnly cookie ile taşınır.
- Access token kısa ömürlü olduğu için response body içinde dönebilir ve istemci belleğinde tutulur.
- Admin ve normal kullanıcı aynı auth altyapısını kullanır; erişim role guard ile ayrılır.

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
| `POST /auth/register` | Public | `{ email, password, displayName? }` | `{ status: "verification_required" }` veya `{ user: PublicUser }` | 201, 400, 409 yerine güvenli 202/201 policy | `AUTH_REGISTER_UNAVAILABLE`, `AUTH_VALIDATION_FAILED`, `AUTH_RATE_LIMITED` | IP + emailHash | `AUTH_REGISTER_REQUESTED` | Aynı e-posta için account existence sızdırmadan güvenli başarılı-benzeri yanıt dönebilir. |
| `POST /auth/login` | Public | `{ email, password, deviceName? }` | `{ accessToken, expiresIn, user: PublicUser }` + refresh cookie | 200, 400, 401, 429 | `AUTH_INVALID_CREDENTIALS`, `AUTH_ACCOUNT_UNAVAILABLE`, `AUTH_RATE_LIMITED` | IP + emailHash + userId | success/failure login | Aynı credential tekrar yeni session oluşturur; rate limit korur. |
| `POST /auth/refresh` | Refresh cookie | Empty body | `{ accessToken, expiresIn, user: PublicUser }` + rotated refresh cookie | 200, 401, 429 | `AUTH_REFRESH_INVALID`, `AUTH_SESSION_REVOKED`, `AUTH_RATE_LIMITED` | Session + IP | `AUTH_REFRESH_ROTATED`, reuse varsa `AUTH_REFRESH_REUSE_DETECTED` | Token tek kullanımlıdır; tekrar kullanım replay sayılır. |
| `POST /auth/logout` | Access token veya refresh cookie | Empty body | Empty | 204, 401 | `AUTH_UNAUTHORIZED` | User + IP | `AUTH_LOGOUT` | Idempotent; zaten çıkılmışsa 204 dönebilir. |
| `POST /auth/logout-all` | Access token | Empty body | Empty | 204, 401 | `AUTH_UNAUTHORIZED` | User + IP | `AUTH_LOGOUT_ALL` | Idempotent; active session yoksa 204. |
| `POST /auth/verify-email` | Public | `{ token }` | `{ status: "verified" }` | 200, 400, 410, 429 | `AUTH_VERIFICATION_INVALID`, `AUTH_VERIFICATION_EXPIRED`, `AUTH_RATE_LIMITED` | Token hash + IP | `AUTH_EMAIL_VERIFIED`, failed | Kullanılmış token tekrar geldiğinde güvenli genel sonuç dönebilir. |
| `POST /auth/resend-verification` | Public veya authenticated | `{ email }` | `{ status: "accepted" }` | 202, 400, 429 | `AUTH_RATE_LIMITED`, `AUTH_VALIDATION_FAILED` | IP + emailHash | `AUTH_EMAIL_VERIFICATION_RESENT` | Her zaman accepted; hesap varlığı açıklanmaz. |
| `POST /auth/forgot-password` | Public | `{ email }` | `{ status: "accepted" }` | 202, 400, 429 | `AUTH_RATE_LIMITED`, `AUTH_VALIDATION_FAILED` | IP + emailHash | `AUTH_PASSWORD_RESET_REQUESTED` | Her zaman accepted; hesap varlığı açıklanmaz. |
| `POST /auth/reset-password` | Public | `{ token, newPassword }` | `{ status: "password_reset" }` | 200, 400, 410, 429 | `AUTH_RESET_INVALID`, `AUTH_RESET_EXPIRED`, `AUTH_PASSWORD_POLICY_FAILED` | Token hash + IP | `AUTH_PASSWORD_RESET_COMPLETED`, failed | Başarılı kullanım tek seferliktir; tekrar kullanım invalid kabul edilir. |
| `POST /auth/change-password` | Access token | `{ currentPassword, newPassword }` | `{ status: "password_changed" }` | 200, 400, 401, 429 | `AUTH_INVALID_CREDENTIALS`, `AUTH_PASSWORD_POLICY_FAILED`, `AUTH_RATE_LIMITED` | User + IP | `AUTH_PASSWORD_CHANGED` | Aynı istek tekrar current password değiştiği için başarısız olabilir. |
| `GET /auth/me` | Access token | None | `{ user: PublicUser, session: CurrentSession }` | 200, 401 | `AUTH_UNAUTHORIZED`, `AUTH_SESSION_REVOKED` | Normal API limit | Opsiyonel `AUTH_ME_READ` metric | Read-only. |
| `GET /auth/sessions` | Access token | None | `{ sessions: SessionSummary[] }` | 200, 401 | `AUTH_UNAUTHORIZED` | User limit | `AUTH_SESSIONS_LISTED` opsiyonel | Read-only. |
| `DELETE /auth/sessions/:sessionId` | Access token | Path `sessionId` | Empty | 204, 401, 404 | `AUTH_UNAUTHORIZED`, `AUTH_SESSION_NOT_FOUND` | User limit | `AUTH_SESSION_REVOKED` | Idempotent; kullanıcıya ait olmayan veya yok session için 404. |

## DTO şekilleri

### PublicUser

```json
{
  "id": "uuid",
  "email": "user@example.com",
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
| `AUTH_UNAUTHORIZED` | Access token eksik, geçersiz veya süresi dolmuş. |
| `AUTH_FORBIDDEN` | Kullanıcı authenticated ancak role veya policy yetersiz. |
| `AUTH_SESSION_REVOKED` | Session iptal edilmiş veya geçersiz. |
| `AUTH_REFRESH_INVALID` | Refresh cookie yok, hash eşleşmedi, süresi doldu veya revoked. |
| `AUTH_RATE_LIMITED` | IP, user veya emailHash limitine takıldı. |
| `AUTH_PASSWORD_POLICY_FAILED` | Yeni parola policy'yi karşılamıyor. |
| `AUTH_VERIFICATION_INVALID` | E-posta doğrulama tokenı geçersiz. |
| `AUTH_RESET_INVALID` | Şifre sıfırlama tokenı geçersiz. |

## Cookie sözleşmesi

- Cookie adı environment ile değiştirilebilir olmalıdır.
- Production: `HttpOnly`, `Secure`, `SameSite=Lax` veya cross-site ihtiyacı varsa kontrollü `SameSite=None; Secure`.
- Development: localhost için `Secure=false` kullanılabilir, ancak production config validation bunu engellemelidir.
- Logout ve refresh replay durumunda cookie expire edilmelidir.
