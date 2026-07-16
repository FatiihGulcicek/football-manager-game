# Authentication Architecture

## Temel yaklaşım

Authentication katmanı, mevcut server authoritative prensibinin kimlik tarafındaki karşılığıdır. İstemci yalnızca niyet ve credential gönderir; kullanıcı kimliği, rol, gerçek session durumu, token üretimi ve yetki kararları API tarafından belirlenir.

Her authenticated request şu sıradan geçer:

1. JWT signature, `alg`, `kid`, `exp`, `iss` ve `aud` doğrulanır.
2. `sid` üzerinden session-active kontrolü yapılır.
3. Kullanıcı aktifliği ve güncel role bilgisi server tarafındaki kaynaktan doğrulanır.
4. Endpoint için gereken role/policy guard uygulanır.

Kısa access token TTL tek başına yeterli güvenlik kontrolü kabul edilmez. Kullanıcı veya session revoke edilmişse access token süresi dolmamış olsa bile istek reddedilir.

## Token ve süre kararları

| Değer | Varsayılan öneri | Not |
| --- | --- | --- |
| Access token | 15 dakika | ES256 JWT, minimum payload, environment üzerinden değiştirilebilir. |
| Refresh token | 30 gün | Opaque random token, veritabanında açık metin saklanmaz. |
| E-posta doğrulama tokenı | 24 saat | Opaque token, hash saklanır. |
| Şifre sıfırlama tokenı | 30 dakika | Opaque token, hash saklanır. |

JWT header ve payload minimum tutulur:

```json
{
  "header": {
    "alg": "ES256",
    "kid": "active-key-id"
  },
  "payload": {
    "sub": "userId",
    "role": "USER",
    "sid": "sessionId",
    "iat": 1720000000,
    "exp": 1720000900,
    "iss": "football-manager-auth",
    "aud": "football-manager-api"
  }
}
```

JWT içine e-posta, kullanıcı adı, display name, IP, user-agent veya hassas oyun verisi eklenmez. `role` claim'i istemciden kabul edilmez; token üretiminde server tarafındaki kullanıcı kaydından alınır.

## Gerçek istemci IP politikası

Rate limit, audit log ve `ipHash` üretimi aynı normalize edilmiş client IP kaynağını kullanır.

- API yalnız güvenilen reverse proxy, CDN veya load balancer hop'larından gelen forwarded header'lara güvenir.
- Güvenilen proxy sayısı veya CIDR allowlist environment/config üzerinden tanımlanır.
- Bootstrap aşamasında `TRUST_PROXY_HOPS` hop count olarak, `TRUST_PROXY_CIDRS` CIDR allowlist olarak Express `trust proxy` ayarına bağlanır.
- Bu iki ayar aynı anda kullanılamaz; config validation uygulamayı başlatmadan reddeder.
- Güvenilmeyen bağlantılarda socket IP kullanılır.
- İstemciden gelen `X-Forwarded-For` doğrudan kabul edilmez.
- `request.ip` yalnız Express trusted proxy çözümünden sonra kaynak kabul edilir.
- IPv4-mapped IPv6 adresleri normalize edilir; `LoginAttempt`, `AuditLog` ve `UserSession` aynı normalize edilmiş IP hash kaynağını kullanır.
- Cloudflare, Nginx veya load balancer topolojisi production deployment belgesinde açıkça tanımlanmalıdır.

## Login timing ve ADMIN context kararı

Kullanıcı bulunamadığında login akışı gerçek kullanıcı hash'i yerine düşük maliyetli sabit bir hash kullanmaz. `PasswordService`, uygulama process'i içinde bir kez dummy Argon2id hash üretir ve cache eder. Bu dummy hash, mevcut auth config içindeki `argon2MemoryCost`, `argon2TimeCost` ve `argon2Parallelism` değerleriyle üretilir. Böylece missing-user yolu ile wrong-password yolu aynı Argon2 verify primitive'i ve aynı maliyet sınıfını kullanır. Dummy hash üretilemezse uygulama fail-fast davranır; sessiz fallback kullanılmaz.

`context=ADMIN` UI giriş yüzeyini belirtir, yetkilendirme sinyali değildir. USER rolündeki bir hesap ADMIN context ile login olabilir; bu kullanıcıya admin rolü kazandırmaz, JWT `role` her zaman DB'deki `User.role` değerinden gelir. ADMIN context yalnız `LoginAttempt`, audit metadata, monitoring ve Sprint 4F kapsamındaki daha sıkı risk/rate-limit grupları için kullanılabilir. Admin yetkileri yalnız role guard ve server-side policy ile verilir.

## Session-active cache

Her authenticated request DB veya kısa TTL cache üzerinden session-active kontrolü yapar. Redis'te 30-60 saniyelik session-active cache kullanılabilir.

- Cache key `sid` ve kullanıcı aktiflik/role sürümüyle uyumlu tasarlanmalıdır.
- Session revoke, logout-all, password reset, account disable ve role change olaylarında cache hemen invalidate edilir.
- Redis unavailable olduğunda API güvenli fallback olarak DB'den session durumunu okur. DB de erişilemezse authenticated istek güvenli şekilde reddedilir.
- Cache yalnız performans optimizasyonudur; doğruluk kaynağı PostgreSQL'deki session ve kullanıcı durumudur.

## Session ve refresh token ailesi

Her login başarılı olduğunda ayrı `UserSession` oluşturulur. Bu session, cihaz veya tarayıcı bağlamını temsil eder. Session içinde `tokenFamilyId` bulunur. Aynı session altında üretilen refresh tokenlar parent-child zinciri kurar.

Refresh isteği başarılı olduğunda mevcut refresh token atomik transaction içinde `usedAt` ile işaretlenir, yeni opaque refresh token üretilir ve yalnızca hash değeri saklanır. Daha önce kullanılmış, revoke edilmiş veya farklı session ailesine ait token tekrar gelirse reuse detection tetiklenir.

## Atomic refresh rotation ve concurrent refresh

Refresh token rotation DB transaction içinde yapılır:

- Eski token koşullu atomic update ile işaretlenir: `usedAt IS NULL`, `revokedAt IS NULL` ve `expiresAt > now()` koşulları zorunludur.
- Aynı transaction içinde yeni child token oluşturulur.
- Transaction başarısızsa eski token used durumda kalmamalıdır.
- Aynı parent tokenın iki geçerli child üretmesine izin verilmez.
- Reuse detection token family ve session revoke ile sonuçlanır.

Concurrent refresh policy:

- MVP'de kısa yarış penceresinde ikinci parallel refresh isteği `AUTH_REFRESH_CONFLICT` ile kontrollü şekilde reddedilir.
- Bu durumda session otomatik revoke edilmez; istemci kısa jitter sonrası yalnız bir kez yeniden deneyebilir.
- Grace window süresi environment/config üzerinden küçük ve sınırlı tutulur.
- Grace window dışındaki tekrar kullanım gerçek replay kabul edilir ve session revoke edilir.
- Aynı parent token için ikinci isteğe aynı child token plaintext değeri tekrar döndürülemez; bu nedenle encrypted handoff MVP kapsamına alınmaz.

## Role change davranışı

Kullanıcının rolü değiştiğinde tüm aktif session'ları revoke edilir. Mevcut access tokenlar session-active kontrolü nedeniyle hemen etkisiz olur. Yeni rol ancak yeni login ile alınır.

Role change audit event'i `AUTH_ROLE_CHANGED` olacaktır. `actorUserId` değişikliği yapan admin veya sistem aktörünü, `targetUserId` rolü değiştirilen kullanıcıyı gösterir.

## Akışlar

| # | Akış | Girdi | Kontroller | Veritabanı işlemleri | Token veya session | Başarılı yanıt | Güvenli hata yanıtı | Audit log olayı | Rate limit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Kullanıcı kaydı | `email`, `password`, opsiyonel `displayName`, locale/timezone | DTO, e-posta normalize, parola politikası, duplicate e-posta, normalize client IP limit | Yeni kullanıcı yoksa `User` ve `EmailVerificationToken` oluşturulur; e-posta varsa varlık açıklanmaz, gerekirse güvenli bilgilendirme e-postası hazırlanır | Login tokenı verilmez; MVP önerisi login için e-posta doğrulama beklenir | 202 generic accepted | Validation dışında hesap varlığı açıklanmaz; response timing benzer tutulur | `AUTH_REGISTER_REQUESTED`, yeni token varsa `EMAIL_VERIFICATION_CREATED` | Normalize IP + emailHash bazlı düşük limit; Redis down fallback sınırlı |
| 2 | E-posta doğrulama | Opaque token | Token hash eşleşmesi, expiry, `usedAt`, `revokedAt`, kullanıcı aktif mi | Token `usedAt` set edilir, `User.emailVerifiedAt` set edilir | Token üretilmez; kullanıcı login akışına yönlendirilir | 200 verified | Geçersiz veya süresi dolmuş token için aynı genel mesaj | `AUTH_EMAIL_VERIFIED`, başarısız denemede `AUTH_EMAIL_VERIFY_FAILED` | Token hash + normalize IP |
| 3 | Kullanıcı girişi | `email`, `password`, cihaz bilgisi, server-derived context `WEB`/`ADMIN` | DTO, kullanıcı aktif, e-posta doğrulama politikası, Argon2id verify, brute-force sayaçları | `LoginAttempt`, `User.lastLoginAt`, `UserSession`, ilk `RefreshToken` | 15 dk ES256 access JWT, 30 gün refresh cookie, yeni session | 200 user özeti ve access token | `AUTH_INVALID_CREDENTIALS`; e-posta yok/şifre yanlış ayrılmaz | `AUTH_LOGIN_SUCCEEDED` veya `AUTH_LOGIN_FAILED` | IP, emailHash, userId ve global auth limit; admin daha sıkı |
| 4 | Access token üretimi | Geçerli kullanıcı ve active session | User active, session active, role DB kaynağından okunur, JWT `iss/aud/kid` uyumu | DB yazımı yok; gerekirse session `lastSeenAt` seyrek güncellenir | JWT `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud` | Access token response body içinde veya refresh sonrasında döner | Session revoked/disabled/role changed için 401 | `AUTH_ACCESS_ISSUED` opsiyonel, yüksek hacimde audit yerine metric olabilir | Refresh/login limitine bağlı |
| 5 | Refresh token üretimi | Secure random token iç değeri | Minimum 256-bit CSPRNG, base64url, token family ve session active | `RefreshToken.tokenHash` saklanır | Opaque refresh token yalnızca HttpOnly cookie ile istemciye bir kez gider | Cookie set edilir | Üretim hatasında 500, token loglanmaz | `AUTH_REFRESH_ISSUED` | Login/refresh akış limitleri |
| 6 | Refresh token rotation | Refresh cookie | Hash eşleşmesi, `usedAt` null, `revokedAt` null, expiry, session active, user active, atomic update | Eski token `usedAt`; yeni child `RefreshToken`; session `lastSeenAt` | Yeni access JWT ve yeni refresh cookie | 200 access token | Geçersiz/replay için 401; parallel yarış için 409 `AUTH_REFRESH_CONFLICT`; gerçek reuse durumunda session revoke | `AUTH_REFRESH_ROTATED`, reuse durumunda `AUTH_REFRESH_REUSE_DETECTED` | Session + normalize IP bazlı, kısa pencere |
| 7 | Tek cihazdan çıkış | Refresh cookie veya active session | JWT doğrulama, session-active, session kullanıcıya ait mi | Current session `revokedAt`; bağlı refresh tokenlar `revokedAt`; session cache invalidate | Cookie temizlenir; access token session-active nedeniyle hemen etkisiz olur | 204 | Zaten çıkış yapılmışsa idempotent 204 | `AUTH_LOGOUT` | Kullanıcı + IP düşük limit |
| 8 | Tüm cihazlardan çıkış | Authenticated access token | JWT doğrulama, session-active, user active | Kullanıcının tüm active session kayıtları revoke edilir; tüm refresh tokenlar revoke edilir; cache invalidate | Tüm refresh cookie aileleri geçersiz; access tokenlar session-active nedeniyle reddedilir | 204 | 401 invalid access; disabled user genel auth hatası | `AUTH_LOGOUT_ALL` | User bazlı |
| 9 | Şifre sıfırlama talebi | `email` | DTO, email normalize, IP/emailHash limit | Kullanıcı varsa önceki unused reset tokenlar revoke edilir ve yeni `PasswordResetToken` hash kaydı açılır; yoksa sadece güvenli yanıt | Token e-posta ile gönderilmek üzere üretilir, response'a konmaz | 202 genel mesaj | Account existence sızdırmayan aynı mesaj | `AUTH_PASSWORD_RESET_REQUESTED` | IP + emailHash + günlük limit |
| 10 | Şifre sıfırlama | Opaque token, yeni parola | Token hash, expiry, `usedAt`, `revokedAt`, parola policy, kullanıcı aktif | Parola hash güncellenir, token `usedAt`, kullanıcının tüm sessionları revoke edilir, cache invalidate | Yeni login zorunlu; refresh cookie temizlenir | 200 | Geçersiz/süresi dolmuş token için genel mesaj | `AUTH_PASSWORD_RESET_COMPLETED` veya failed | Token + IP bazlı |
| 11 | Şifre değiştirme | Mevcut parola, yeni parola | Authenticated request, session-active, current password verify, yeni parola policy | `User.passwordHash` güncellenir; diğer sessionlar revoke edilir; cache invalidate | Current session için yeni refresh token ailesi başlatılabilir | 200 | Mevcut parola hatası için genel auth mesajı | `AUTH_PASSWORD_CHANGED` | User + IP bazlı |
| 12 | Aktif oturumları listeleme | Access token | JWT doğrulama, session-active, user active | Read-only `UserSession` sorgusu | Token üretilmez | 200 session listesi | 401/403 | `AUTH_SESSIONS_LISTED` opsiyonel | User bazlı |
| 13 | Belirli bir oturumu iptal etme | `sessionId` | JWT doğrulama, session-active, target session kullanıcıya ait mi | Target session ve refresh tokenlar revoke edilir; cache invalidate | Target refresh token ailesi geçersiz | 204 | Başka kullanıcı session için 404 tercih edilir | `AUTH_SESSION_REVOKED` | User bazlı |
| 14 | Hesap devre dışı bırakma | Admin veya güvenlik işlemi | Role guard, hedef kullanıcı, self-disable kuralı | `User.isActive=false`; tüm session ve refresh tokenlar revoke edilir; cache invalidate | Tüm tokenlar etkisiz | 200 veya 204 | Yetkisiz 403; hedef yok 404 | `AUTH_ACCOUNT_DISABLED` | Admin/user action limit |
| 15 | Admin kullanıcı girişi | `email`, `password`, admin app context | Normal login kontrolleri; context yetki sinyali değildir, role DB'den gelir | Normal `LoginAttempt` context `ADMIN`, `UserSession`, `RefreshToken` | Aynı token altyapısı; admin UI role guard ile açılır | 200 | Normal login ile aynı `AUTH_INVALID_CREDENTIALS`; admin endpoint erişiminde role yetersizse 403 | `AUTH_LOGIN_SUCCEEDED` veya `AUTH_LOGIN_FAILED`, metadata context `ADMIN` | Daha sıkı IP + user limit, progressive delay Sprint 4F |
| 16 | Yetkisiz ve yasaklı kullanıcı davranışı | Eksik/geçersiz token veya yetersiz rol | Access JWT signature/exp/iss/aud/kid, session-active, role guard | Başarısız access denemeleri audit/metric olabilir | Token üretilmez | 401 unauthenticated veya 403 forbidden | Hata mesajı kaynak detayını açıklamaz | `AUTH_UNAUTHORIZED`, `AUTH_FORBIDDEN` | Endpoint riskine göre IP + user |

## Yetkisiz ve yasaklı ayrımı

- 401, kimlik doğrulama eksik, geçersiz, session revoked veya kullanıcı inactive olduğunda kullanılır.
- 403, kimliği doğrulanmış ve active session sahibi kullanıcının role veya policy nedeniyle kaynağa erişemediği durumda kullanılır.
- Disabled user için varsayılan davranış güvenli kalmak adına 401 benzeri genel auth hatası olabilir; admin panelinde audit log ayrıntısı tutulur.

## Environment üzerinden değiştirilecek ayarlar

Süreler ve güvenlik ayarları kod içine gömülmez. Sprint 4B'de config validation ile en az şu ayarlar tasarlanmalıdır:

- `AUTH_ACCESS_TOKEN_TTL_SECONDS`
- `AUTH_REFRESH_TOKEN_TTL_DAYS`
- `AUTH_EMAIL_VERIFICATION_TTL_HOURS`
- `AUTH_PASSWORD_RESET_TTL_MINUTES`
- `AUTH_REFRESH_COOKIE_NAME`
- `AUTH_COOKIE_SECURE`
- `AUTH_COOKIE_SAMESITE`
- `AUTH_COOKIE_GRACE_WINDOW_SECONDS`
- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`
- `AUTH_JWT_ACTIVE_KID`
- `TRUST_PROXY_HOPS` veya `TRUST_PROXY_CIDRS`
