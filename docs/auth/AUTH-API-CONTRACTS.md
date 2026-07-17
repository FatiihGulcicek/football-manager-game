# Authentication API Contracts

Bu belge authentication API sözleşmelerini tanımlar. Sprint 4D.1 itibarıyla `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `GET /auth/sessions`, `DELETE /auth/sessions/:sessionId` ve `POST /auth/verify-email` uygulanmıştır; diğer endpointler sonraki alt sprintler için sözleşme durumundadır.

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
- Login `context` alanı yalnız giriş yüzeyini belirtir; yetkilendirme sinyali değildir.

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
- CORS runtime hardening ve Origin/Referer kontrolleri Sprint 4F kapsamındadır.

## Client IP ve proxy sözleşmesi

- API `X-Forwarded-For` header'ını elle parse etmez.
- `TRUST_PROXY_HOPS` veya `TRUST_PROXY_CIDRS` tanımlıysa Express `trust proxy` runtime'da set edilir ve `request.ip` trusted proxy çözümünden sonra kullanılır.
- Proxy config yoksa socket IP kullanılır; spoofed forwarded header client IP'yi değiştirmez.
- `LoginAttempt`, `AuditLog` ve `UserSession` aynı normalize edilmiş IP hash değerini kullanır.

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
| `POST /auth/refresh` | Refresh cookie | Empty body | `{ accessToken, tokenType, expiresIn }` + rotated refresh cookie | 200, 400, 401, 409, 429 | `AUTH_REFRESH_INVALID_BODY`, `AUTH_REFRESH_INVALID`, `AUTH_REFRESH_CONFLICT`, `AUTH_REFRESH_REUSED`, `AUTH_RATE_LIMITED` | Refresh limiter boundary; Redis limit Sprint 4F | `AUTH_REFRESH_SUCCEEDED`, `AUTH_REFRESH_FAILED`, replay varsa `AUTH_REFRESH_REUSED` | Token tek kullanımlıdır; kısa parallel yarışta 409 conflict döner, gerçek replay session revoke eder. |
| `POST /auth/logout` | Optional refresh cookie | Empty body | Empty | 204, 400 | `AUTH_LOGOUT_INVALID_BODY` | Hardcoded limiter yok; Sprint 4F boundary | Eşleşen aktif session için `AUTH_LOGOUT` | Idempotent; cookie yok, uydurma cookie veya zaten çıkılmış session için 204 döner. |
| `POST /auth/logout-all` | Access token + active session | Empty body | Empty | 204, 400, 401 | `AUTH_LOGOUT_ALL_INVALID_BODY`, `AUTH_UNAUTHORIZED` | User + IP | `AUTH_LOGOUT_ALL` | Idempotent; active session yoksa 204. |
| `POST /auth/verify-email` | Public | `{ token }` | `{ status: "verified", message }` | 200, 400, 429 | `AUTH_EMAIL_VERIFICATION_INVALID`, `AUTH_RATE_LIMITED` | Verify-email limiter boundary; Redis limit Sprint 4F | Başarılı consume için `AUTH_EMAIL_VERIFIED` | Geçerli unused token, kullanıcı zaten verified olsa bile consumed edilir ve 200 döner; aynı token ikinci kullanımda generic invalid döner. |
| `POST /auth/resend-verification` | Public veya authenticated | `{ email }` | `{ status: "accepted" }` | 202, 400, 429 | `AUTH_RATE_LIMITED`, `AUTH_VALIDATION_FAILED` | IP + emailHash | `AUTH_EMAIL_VERIFICATION_RESENT` | Her zaman accepted; hesap varlığı açıklanmaz; önceki unused tokenlar revoke edilir. |
| `POST /auth/forgot-password` | Public | `{ email }` | `{ status: "accepted" }` | 202, 400, 429 | `AUTH_RATE_LIMITED`, `AUTH_VALIDATION_FAILED` | IP + emailHash | `AUTH_PASSWORD_RESET_REQUESTED` | Her zaman accepted; hesap varlığı açıklanmaz; önceki unused reset tokenlar revoke edilir. |
| `POST /auth/reset-password` | Public | `{ token, newPassword }` | `{ status: "password_reset" }` | 200, 400, 410, 429 | `AUTH_RESET_INVALID`, `AUTH_RESET_EXPIRED`, `AUTH_PASSWORD_POLICY_FAILED` | Token hash + IP | `AUTH_PASSWORD_RESET_COMPLETED`, failed | Başarılı kullanım tek seferliktir; tekrar kullanım invalid kabul edilir. |
| `POST /auth/change-password` | Access token + active session | `{ currentPassword, newPassword }` | `{ status: "password_changed" }` | 200, 400, 401, 429 | `AUTH_INVALID_CREDENTIALS`, `AUTH_PASSWORD_POLICY_FAILED`, `AUTH_RATE_LIMITED` | User + IP | `AUTH_PASSWORD_CHANGED` | Aynı istek tekrar current password değiştiği için başarısız olabilir. |
| `GET /auth/me` | Access token + active session | None | `{ user: PublicUser, session: CurrentSession }` | 200, 401 | `AUTH_UNAUTHORIZED`, `AUTH_SESSION_REVOKED` | Normal API limit | Opsiyonel `AUTH_ME_READ` metric | Read-only. |
| `GET /auth/sessions` | Access token + active session | None | `{ sessions: SessionSummary[] }` | 200, 401 | `AUTH_UNAUTHORIZED` | User limit | Yok | Read-only. |
| `DELETE /auth/sessions/:sessionId` | Access token + active session | Path `sessionId`, empty body | Empty | 204, 400, 401, 404 | `AUTH_SESSION_REVOKE_INVALID_BODY`, `AUTH_UNAUTHORIZED`, `AUTH_SESSION_NOT_FOUND` | User limit | `AUTH_SESSION_REVOKED` | Kullanıcıya ait olmayan veya yok session için 404; kullanıcıya ait zaten revoked hedef için 204 kabul edilir. |

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
- `context=ADMIN` kullanıcıya admin rolü vermez ve JWT role claim'ini değiştirmez.
- ADMIN context yalnız `LoginAttempt`, audit/monitoring metadata'sı ve Sprint 4F risk/rate-limit grupları için kullanılabilir.
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

Refresh token response body içinde dönmez; yalnız HttpOnly refresh cookie ile taşınır. Service internal sonucu public response DTO ve refresh-cookie payload olarak ayrılır; raw refresh token yalnız cookie yazan controller katmanına açılır. Başarılı login transaction içinde `UserSession`, ilk `RefreshToken`, `LoginAttempt`, `AuditLog` ve `User.lastLoginAt` yazar.

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

## Uygulanan refresh sözleşmesi

`POST /auth/refresh` request body kabul etmez. Refresh token yalnız auth config ile belirlenen cookie adından okunur:

- Development varsayılanı: `refresh_token`.
- Production: `__Host-refresh_token`.

Body, query veya header içinden refresh token kabul edilmez. Body boş olmalıdır. Body herhangi bir JSON alanı, nested object veya array içerirse 400 `AUTH_REFRESH_INVALID_BODY` döner; cookie yoksa 401 `AUTH_REFRESH_INVALID` döner. Primitive veya bozuk JSON payload'lar mevcut JSON parser davranışıyla güvenli 400 olarak reddedilir ve refresh akışına girmez.

Body dolu olduğunda standart auth hata zarfı:

```json
{
  "error": {
    "code": "AUTH_REFRESH_INVALID_BODY",
    "message": "Refresh isteğinin gövdesi boş olmalıdır.",
    "requestId": "req_..."
  }
}
```

Bu response raw body, refresh token, cookie değeri veya veritabanı detayı içermez.

Başarılı response:

```json
{
  "accessToken": "...",
  "tokenType": "Bearer",
  "expiresIn": 900
}
```

Başarılı refresh transaction içinde eski refresh token `usedAt` alır, yeni child token yalnız hash olarak saklanır, session `lastSeenAt` güncellenir ve yeni refresh token aynı cookie adıyla overwrite edilir. Access token role claim'i yalnız DB'deki `User.role` değerinden üretilir. Refresh akışı `LoginAttempt` yazmaz.

Kısa grace window içinde aynı parent token tekrar gelirse:

```json
{
  "error": {
    "code": "AUTH_REFRESH_CONFLICT",
    "message": "Oturum yenileme isteği çakıştı. Lütfen tekrar deneyin.",
    "requestId": "req_..."
  }
}
```

Bu durumda yeni child token üretilmez, session revoke edilmez ve cookie temizlenmez.

Grace window dışındaki replay `AUTH_REFRESH_REUSED` ile 401 döner; ilgili session ve refresh token family revoke edilir ve mevcut refresh cookie temizlenir. Invalid, expired, revoked token, expired session ve disabled user durumları dışarıya güvenli `AUTH_REFRESH_INVALID` olarak döner; iç neden ayrıştırılmaz.

## Refresh conflict davranışı

`AUTH_REFRESH_CONFLICT`, yalnız kısa parallel refresh yarışını ifade eder; e-posta enumeration ile ilgisi yoktur.

- HTTP 409 kullanılabilir.
- Session otomatik revoke edilmez.
- İstemci kısa jitter sonrası yalnız bir kez yeniden deneyebilir.
- Sürekli tekrar durumunda login ekranına yönlendirilir.
- Grace window dışındaki eski token kullanımı `AUTH_REFRESH_INVALID` veya reuse detection ile session revoke sonucuna gider.

## Uygulanan logout sözleşmesi

`POST /auth/logout` request body kabul etmez. Refresh token yalnız auth config ile belirlenen cookie adından okunur:

- Development varsayılanı: `refresh_token`.
- Production: `__Host-refresh_token`.

Body, query, authorization header veya özel header içinden refresh token kabul edilmez. Cookie yoksa DB lookup yapılmadan refresh cookie clear edilir ve 204 döner. Cookie uydurma veya token bulunamıyorsa dışarıya ayrıntı verilmez, cookie clear edilir ve 204 döner.

Body dolu olduğunda standart auth hata zarfı:

```json
{
  "error": {
    "code": "AUTH_LOGOUT_INVALID_BODY",
    "message": "Logout isteğinin gövdesi boş olmalıdır.",
    "requestId": "req_..."
  }
}
```

Başarılı veya idempotent response:

- HTTP status: 204 No Content.
- Response body: empty.
- Refresh cookie her normal logout çağrısında aynı cookie attribute'larıyla temizlenir.

Eşleşen aktif session bulunduğunda current `UserSession` `revokedAt` alır, `revokeReason="user_logout"` olur, aynı session'a bağlı aktif refresh tokenlar revoke edilir ve session cache invalidate edilir. Başka sessionlar etkilenmez. Logout akışı `LoginAttempt` yazmaz. Audit metadata allowlist `context`, `reason`, `sessionId` ile sınırlıdır; raw token, raw cookie, authorization header, raw IP veya user-agent audit/log içine yazılmaz.

Audit yazımı başarısız olursa session revoke sonucu geri alınmaz; istemci normal logout sonucunu alabilir. Session/refresh revoke transaction'ı başarısız olursa yarım revoke başarı gibi raporlanmaz.

## Uygulanan session management sözleşmesi

`POST /auth/logout-all`, `GET /auth/sessions` ve `DELETE /auth/sessions/:sessionId` access token gerektirir. Guard, `Authorization: Bearer <accessToken>` header'ını doğrular, JWT `sid` claim'i ile session-active kontrolü yapar ve session `userId` değerinin JWT `sub` ile eşleşmesini zorunlu tutar. Client tarafından gönderilen `userId`, `role` veya `sessionId` kabul edilmez.

Unauthorized response:

```json
{
  "error": {
    "code": "AUTH_UNAUTHORIZED",
    "message": "Oturum geçersiz veya süresi dolmuş.",
    "requestId": "req_..."
  }
}
```

### POST /auth/logout-all

Request body boş olmalıdır. Body doluysa:

```json
{
  "error": {
    "code": "AUTH_LOGOUT_ALL_INVALID_BODY",
    "message": "Logout-all isteğinin gövdesi boş olmalıdır.",
    "requestId": "req_..."
  }
}
```

Başarılı durumda authenticated kullanıcının tüm aktif session kayıtları ve bağlı aktif refresh tokenları revoke edilir, session cache kayıtları invalidate edilir, refresh cookie temizlenir ve 204 No Content döner. İşlem idempotenttir. `AUTH_LOGOUT_ALL` audit metadata allowlist'i yalnız `sessionCount` ve `reason` alanlarını içerir.

### GET /auth/sessions

Yalnız authenticated kullanıcının aktif session özetleri döner. Current session ilk sıradadır, diğer sessionlar `lastSeenAt` descending sıralanır.

```json
{
  "sessions": [
    {
      "id": "uuid",
      "deviceName": "Windows Chrome",
      "deviceType": "DESKTOP",
      "browser": "Chrome",
      "operatingSystem": "Windows",
      "countryCode": "TR",
      "city": "Samsun",
      "lastSeenAt": "2026-07-16T10:00:00.000Z",
      "createdAt": "2026-07-01T10:00:00.000Z",
      "expiresAt": "2026-08-15T10:00:00.000Z",
      "isCurrent": true
    }
  ]
}
```

Response içinde `tokenFamilyId`, `ipHash`, `userAgentHash`, `revokeReason`, refresh token kayıtları, raw IP, raw user-agent, `userId` veya internal audit metadata dönmez.

### DELETE /auth/sessions/:sessionId

`sessionId` yalnız URL parametresinden alınır. Request body boş olmalıdır. Body doluysa:

```json
{
  "error": {
    "code": "AUTH_SESSION_REVOKE_INVALID_BODY",
    "message": "Session revoke isteğinin gövdesi boş olmalıdır.",
    "requestId": "req_..."
  }
}
```

Hedef session authenticated kullanıcıya ait değilse veya yoksa 404 `AUTH_SESSION_NOT_FOUND` döner; böylece IDOR ve session enumeration riski azaltılır. Hedef session kullanıcıya aitse session ve bağlı refresh token family transaction içinde revoke edilir, cache invalidate edilir ve 204 döner. Bu sprintte current session revoke işlemine izin verilir; hedef current session ise refresh cookie temizlenir ve sonraki authenticated istek session-active kontrolünde 401 alır. Başka bir cihaz kapatıldığında current refresh cookie temizlenmez.

`AUTH_SESSION_REVOKED` audit metadata allowlist'i yalnız `targetSessionId`, `isCurrent` ve `reason` alanlarını içerir.

## Uygulanan e-posta doğrulama sözleşmesi

`POST /auth/verify-email` public endpointtir; access token veya refresh cookie gerektirmez. Token yalnız request body içinden kabul edilir:

```json
{
  "token": "opaque-token"
}
```

- `token` zorunlu stringdir.
- Değer trim edilir.
- Güvenli minimum ve maksimum uzunluk kontrolü uygulanır.
- Null byte ve sakıncalı kontrol karakterleri reddedilir.
- Query, header, cookie veya authorization header içinden token kabul edilmez.
- `role`, `userId` veya başka ek body alanları kabul edilmez.

Başarılı response:

```json
{
  "status": "verified",
  "message": "E-posta adresiniz doğrulandı."
}
```

Servis raw tokenı yalnız hash hesaplamak için bellekte kullanır. DB lookup `tokenHash` ile yapılır. Token mevcut, unused, unrevoked, unexpired ve bağlı user active olmalıdır. Transaction içinde token atomic olarak `usedAt` alır, `User.emailVerifiedAt` güncellenir, aynı kullanıcıya ait diğer unused verification tokenlar revoke edilir ve `AUTH_EMAIL_VERIFIED` audit kaydı yazılır.

Aynı token iki paralel istekte kullanılırsa yalnız bir istek consume edebilir. İkinci istek 400 `AUTH_EMAIL_VERIFICATION_INVALID` alır ve ikinci audit kaydı oluşmaz.

Geçerli ve daha önce kullanılmamış token, kullanıcı zaten verified olsa bile güvenli biçimde consumed edilir ve aynı 200 response döner. Aynı token ikinci kez kullanılırsa invalid kabul edilir.

Invalid response tüm dış nedenler için aynıdır: token bulunamadı, expired, revoked, used, user yok veya user disabled ayrıştırılmaz.

```json
{
  "error": {
    "code": "AUTH_EMAIL_VERIFICATION_INVALID",
    "message": "Doğrulama bağlantısı geçersiz veya süresi dolmuş.",
    "requestId": "req_..."
  }
}
```

Verify-email yeni session oluşturmaz, access token üretmez, refresh token üretmez, mevcut sessionları revoke etmez ve login işlemi yapmaz. Kullanıcı doğrulama sonrası normal login endpointiyle giriş yapar.

`AUTH_EMAIL_VERIFIED` audit metadata allowlist'i yalnız `context` ve `verificationMethod` alanlarını içerir. Raw token, token hash, e-posta, IP, cookie veya authorization header audit metadata içine yazılmaz. Geçersiz token denemeleri bu sprintte sınırsız audit log üretmez; Sprint 4F'te rate-limit/metric katmanına bağlanacaktır.

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

### SessionSummary

```json
{
  "id": "uuid",
  "deviceName": "Windows Chrome",
  "deviceType": "DESKTOP",
  "browser": "Chrome",
  "operatingSystem": "Windows",
  "countryCode": "TR",
  "city": "Samsun",
  "lastSeenAt": "2026-07-16T10:00:00.000Z",
  "createdAt": "2026-07-01T10:00:00.000Z",
  "expiresAt": "2026-08-15T10:00:00.000Z",
  "isCurrent": true
}
```

## Hata kodları

| Kod | Anlam |
| --- | --- |
| `AUTH_INVALID_CREDENTIALS` | Login veya password check başarısız; neden ayrıştırılmaz. |
| `AUTH_UNAUTHORIZED` | Access token eksik, geçersiz, süresi dolmuş veya session-active kontrolünden geçememiş. |
| `AUTH_FORBIDDEN` | Kullanıcı authenticated ve session active ancak role veya policy yetersiz. |
| `AUTH_SESSION_REVOKED` | Session iptal edilmiş veya geçersiz. |
| `AUTH_LOGOUT_INVALID_BODY` | Logout isteği boş body dışında payload içerdiği için reddedildi. |
| `AUTH_LOGOUT_ALL_INVALID_BODY` | Logout-all isteği boş body dışında payload içerdiği için reddedildi. |
| `AUTH_SESSION_REVOKE_INVALID_BODY` | Session revoke isteği boş body dışında payload içerdiği için reddedildi. |
| `AUTH_SESSION_NOT_FOUND` | Session yok, kullanıcıya ait değil veya existence gizlenmelidir. |
| `AUTH_REFRESH_INVALID_BODY` | Refresh isteği boş body dışında payload içerdiği için reddedildi. |
| `AUTH_REFRESH_INVALID` | Refresh cookie yok, hash eşleşmedi, süresi doldu veya revoked. |
| `AUTH_REFRESH_CONFLICT` | Kısa parallel refresh yarışında ikinci istek kontrollü reddedildi. |
| `AUTH_REFRESH_REUSED` | Grace window dışındaki refresh replay tespit edildi; session/token family revoke edilir. |
| `AUTH_EMAIL_VERIFICATION_INVALID` | E-posta doğrulama tokenı yok, geçersiz, süresi dolmuş, revoked, used veya güvenli biçimde reddedilmelidir. |
| `AUTH_RATE_LIMITED` | IP, user, session veya emailHash limitine takıldı. |
| `AUTH_PASSWORD_POLICY_FAILED` | Yeni parola policy'yi karşılamıyor. |
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
