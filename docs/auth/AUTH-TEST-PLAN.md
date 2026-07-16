# Authentication Test Plan

Bu plan Sprint 4B ve sonrası auth uygulaması için beklenen test kapsamını tanımlar.

## Unit testler

| Test | Beklenen sonuç |
| --- | --- |
| Şifre hashleme | Aynı parola için salt nedeniyle farklı hash üretir ve açık metin saklamaz. |
| Şifre doğrulama | Doğru parola true, yanlış parola false döner. |
| Invalid Argon2 hash doğrulama | Verify exception sızdırmadan `false` döner; parola veya hash loglanmaz. |
| Dummy Argon2 hash config parity | Dummy hash `argon2id` algoritmasıyla üretilir ve memory/time/parallelism değerleri auth config ile eşleşir. |
| Dummy hash cache | Dummy hash process içinde cache edilir; request başına tekrar hash üretilmez. |
| Dummy verify primitive | Missing-user yolu dummy hash ile, wrong-password yolu gerçek hash ile aynı PasswordService verify primitive'ini kullanır. |
| Unicode NFC parola | Görsel olarak eşdeğer Unicode parola normalize edilerek tutarlı doğrulanır. |
| Null byte ve kontrol karakterleri | Parola ve DTO alanları validation ile reddedilir. |
| Maksimum parola uzunluğu | Argon2 çağrısından önce reddedilir. |
| Token hashing | Aynı token aynı HMAC/pepper hash değerini üretir; raw token loglanmaz. |
| Token entropy | Refresh token en az 32 byte CSPRNG random içerir ve base64url taşınır. |
| JWT payload | Payload `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud` içerir; hassas veri içermez. |
| JWT header | Header `alg=ES256` ve `kid` içerir. |
| Session oluşturma | Her login için yeni `UserSession` ve `tokenFamilyId` üretilir. |
| Session-active cache invalidation | Revoke sonrası ilgili cache key temizlenir. |
| Refresh rotation | Kullanılmış refresh token `usedAt` alır ve child token oluşturulur. |
| Reuse detection | Grace window dışındaki kullanılmış token tekrar gelirse session revoke edilir. |
| Expired token | Süresi dolmuş token reddedilir. |
| Revoked session | Revoked session ile access/refresh kabul edilmez. |
| Disabled user | `isActive=false` kullanıcı login, refresh ve authenticated request yapamaz. |
| Role kontrolü | Client role inputu yok sayılır, DB/server role kullanılır. |
| LoginAttempt context | Login attempt `WEB` veya `ADMIN` context ile kaydedilir; ileride `MOBILE` genişletilebilir. |

## Integration testler

| Test | Beklenen sonuç |
| --- | --- |
| Register | Geçerli e-posta ve parola ile 202 generic response döner; kullanıcı yoksa verification token kaydı oluşur. |
| Duplicate email | 202 generic response döner; account existence açıklanmaz ve duplicate kayıt DB bütünlüğünü bozmaz. |
| Login success | Access token, production/dev policy'ye uygun refresh cookie, session ve login attempt success oluşur. |
| Login invalid credentials | 401 ve genel hata döner; user not found/password wrong ayrımı yapılmaz. |
| Admin login context | USER rolü ADMIN context ile login olabilir; JWT/body role USER kalır, `LoginAttempt.context=ADMIN` olur ve admin yetkisi oluşmaz. |
| Login 401 no-cookie | Invalid credential, disabled ve unverified login yanıtlarında `Set-Cookie` bulunmaz. |
| Refresh success | Yeni access token ve rotated refresh cookie döner. |
| Concurrent refresh | Aynı parent token ile iki parallel istekten biri başarılı olur, kısa yarıştaki diğeri `AUTH_REFRESH_CONFLICT` alır. |
| Refresh DB transaction rollback | Transaction hata verirse eski token used durumda kalmaz ve geçerli child oluşmaz. |
| Refresh race grace-window/conflict davranışı | Grace window içindeki ikinci istek session revoke etmez; sürekli tekrar login gerektirir. |
| Replay detection ve session revoke | Grace window dışındaki eski refresh token replay sayılır ve session/token family revoke edilir. |
| Logout | Current session ve bağlı refresh tokenlar revoke edilir, cookie temizlenir, access token hemen reddedilir. |
| Logout all devices | Kullanıcının tüm sessionları revoke edilir ve eski access tokenlar session-active kontrolünde reddedilir. |
| Role change sonrası eski access token reddi | Role değiştiğinde tüm sessionlar revoke edilir; eski token 401 alır. |
| Email verification | Geçerli token `emailVerifiedAt` set eder; yeni token üretimi önceki unused tokenları revoke eder. |
| Password reset | Yeni parola set edilir, reset token kullanılır, sessionlar revoke edilir. |
| Session listing | Kullanıcı yalnız kendi session özetlerini görür. |
| Session ownership IDOR | Başka kullanıcının session kaydı silinemez; 404/403 güvenli yanıt döner. |

## Security testler

| Test | Beklenen sonuç |
| --- | --- |
| X-Forwarded-For spoofing | Güvenilmeyen bağlantıdan gelen spoofed header yok sayılır, socket IP kullanılır. |
| Trusted proxy chain doğrulaması | Yalnız configured trusted hop/CIDR üzerinden gelen forwarded header normalize client IP üretir. |
| Trusted proxy runtime wiring | `TRUST_PROXY_HOPS` hop count olarak, `TRUST_PROXY_CIDRS` CIDR allowlist olarak Express `trust proxy` ayarına bağlanır; ikisi birlikte reddedilir. |
| Login IP hash consistency | `LoginAttempt` ve `UserSession` aynı normalize edilmiş `ipHash` değerini yazar. |
| SQL injection | DTO ve Prisma parametreleme ile injection etkisiz kalır. |
| NoSQL benzeri payload | Object/array gibi beklenmeyen payload validation ile reddedilir. |
| Oversized payload | Büyük body ve uzun inputlar güvenli 400/413 alır. |
| Brute-force | IP/emailHash/user limitleri ve progressive delay devreye girer. |
| Redis down fallback limiter | Redis unavailable olduğunda bounded in-memory fallback çalışır, limitler daha muhafazakar olur ve health degraded döner. |
| Enumeration | Register, login, forgot password ve resend verification hesap varlığını açıklamaz. |
| Token tampering | JWT signature bozulduğunda 401 döner. |
| JWT iss/aud/kid doğrulama | Yanlış issuer, audience veya bilinmeyen kid reddedilir. |
| Key rotation önceki public key doğrulaması | Önceki public key sınırlı pencere içinde kabul edilir; pencere bitince reddedilir. |
| Clock skew | 5-10 saniyelik tolerans uygulanır; daha büyük sapma reddedilir. |
| Wrong signing key | Farklı key ile imzalı JWT kabul edilmez. |
| Expired token | Süresi dolmuş access/refresh token kabul edilmez. |
| Session revoke sonrası süresi dolmamış access token reddi | JWT exp geçmemiş olsa bile revoked session 401 alır. |
| CSRF | Cookie kullanan endpointler yabancı Origin isteğini reddeder. |
| CORS allowlist | Yalnız izinli app/admin originleri credentials ile kabul edilir. |
| Wildcard + credentials reddi | `*` origin ile credentials yapılandırması testte başarısız kabul edilir. |
| Production cookie attribute assertion | `__Host-refresh_token`, host-only, `Path=/`, Secure, HttpOnly, SameSite=Lax doğrulanır. |
| Development cookie policy | Localhost prefix'siz ve `Secure=false` çalışabilir; production validation bunu production'da reddeder. |
| XSS taşıyan displayName veya deviceName | Değerler encode edilir, script çalışmaz, loglara raw zararlı içerik yazılmaz. |
| Yetki yükseltme | Request body ile `role=ADMIN` gönderilse bile rol değişmez. |
| AuditLog metadata sanitization | Metadata allowlist, boyut limiti ve hassas veri redaksiyonu uygulanır. |

## Manuel testler

| Test | Beklenen sonuç |
| --- | --- |
| Windows Chrome | Login, refresh, logout ve cookie davranışı beklenen şekilde çalışır. |
| Mobil Chrome | Access token memory ve refresh cookie akışı mobil tarayıcıda çalışır. |
| Safari/PWA yaklaşımı | SameSite, cookie ve PWA lifecycle davranışı doğrulanır. |
| Cookie davranışı | HttpOnly cookie JS ile okunamaz; logout sonrası expire edilir. |
| Çoklu cihaz | Her cihaz ayrı session olarak listelenir ve tek tek revoke edilir. |
| Saat farkı | UTC expiry ve clock skew toleransı kullanıcıyı gereksiz kırmaz; server expiry esas alınır. |
| Redis kapalı | Fallback limiter devreye girer; health degraded ve internal metric görünür olur. |
| PostgreSQL kapalı | Auth endpointleri kontrollü hata döner; health degraded döner. |
| Cloudflare/Nginx/load balancer topolojisi | Production deployment IP normalization dokümanı ile runtime config eşleşir. |

## Kabul notları

- Auth testleri watch modunda çalışmaz; CI `vitest run` kullanır.
- Security testleri gerçek secret kullanmaz.
- Test fixture parolaları açıkça test değeri olarak kalır; production-like secret üretilmez.
- Wall-clock timing testleri ana CI'ı kıracak şekilde yazılmaz; gerekiyorsa ayrı manual/security benchmark notu olarak çalıştırılır.
- Gerçek Redis rate limit, CORS Origin/Referer hardening ve audit retention testleri Sprint 4F kapsamındadır.
