# Authentication Implementation Plan

Bu plan Sprint 4A tasarımından sonra authentication geliştirmesini küçük ve doğrulanabilir alt sprintlere böler.

## Sprint 4B - Auth veri modelleri ve config

Durum: Tamamlandı.

| Alan | Detay |
| --- | --- |
| Amaç | Auth veri modellerini Prisma'ya eklemek, migration üretmek, temel DTO ve config validation zeminini kurmak. |
| Değişecek ana dosyalar | `packages/database/prisma/schema.prisma`, migration klasörü, `apps/api/src/config`, auth DTO taslakları, `.env.example` placeholderları. |
| Test şartları | Prisma validate/generate, migration test DB'de uygulanabilirlik, config validation unit testleri. |
| Kabul kriterleri | `UserSession`, `RefreshToken`, verification/reset token, `LoginAttempt`, `AuditLog` modelleri migration ile oluşur; `revokedAt`, onDelete ve index kararları uygulanır; secret değerler gerçek değildir. |
| Riskler | Cascade/SetNull davranışının yanlış modellenmesi, config defaultlarının production için fazla gevşek kalması. |

Tamamlananlar:

- Auth Prisma modelleri, ilişkileri, indexleri ve migration eklendi.
- Auth config validation dosyaları oluşturuldu.
- Argon2id password service, opaque token hashing, ES256 access token service, session service ve refresh rotation foundation eklendi.
- Unit testler production DB veya Redis'e bağlanmadan mock/fixture tabanlı yazıldı.
- `.env.example` yalnız placeholder değerlerle güncellendi.

Sprint 4B config kapsamı:

- `TRUST_PROXY_HOPS` veya `TRUST_PROXY_CIDRS`.
- `AUTH_REFRESH_COOKIE_NAME`, production için `__Host-refresh_token`.
- Cookie secure, SameSite, host-only ve development override ayarları.
- JWT issuer, audience, active `kid` ve key material referansları.
- Refresh conflict grace window süresi.
- Retention süreleri.

## Sprint 4C - Password, JWT, session, register ve login

Durum: Tamamlandı. Sprint 4C.1 kapsamında `POST /auth/register`, Sprint 4C.2 kapsamında `POST /auth/login`, Sprint 4C.3 kapsamında `POST /auth/refresh`, Sprint 4C.4 kapsamında `POST /auth/logout`, Sprint 4C.5 kapsamında `POST /auth/logout-all`, `GET /auth/sessions` ve `DELETE /auth/sessions/:sessionId` uygulandı.

| Alan | Detay |
| --- | --- |
| Amaç | Parola hash/doğrulama, ES256 access JWT üretimi, session-active guard, register ve login akışlarını kurmak. |
| Değişecek ana dosyalar | `apps/api/src/auth`, `apps/api/src/users` veya eşdeğer user service, DTO'lar, guards, unit/integration testler. |
| Test şartları | Password service, Unicode NFC validation, JWT `kid/iss/aud`, register 202, login success/failure, disabled user, session-active ve role kontrol testleri. |
| Kabul kriterleri | Login access token ve refresh cookie üretir; role client inputundan alınmaz; invalid credentials güvenli döner; register account existence açıklamaz. |
| Riskler | Enumeration sızıntısı, Argon2id parametrelerinin local/CI üzerinde fazla yavaş olması, ES256 key yönetiminin yanlış yapılandırılması. |

Sprint 4C.1 tamamlananlar:

- `POST /auth/register` endpointi 202 generic response dönecek şekilde eklendi.
- Request DTO `email`, `password`, `displayName`, opsiyonel `locale` ve opsiyonel `timezone` alanlarıyla sınırlandı.
- E-posta trim/lowercase normalize edilir; desteklenmeyen `role` gibi client alanları reddedilir.
- Parola `PasswordService` üzerinden validate/hash edilir; raw parola response, log veya veritabanına yazılmaz.
- Yeni kayıt transaction içinde `User`, `ManagerProfile`, `EmailVerificationToken` ve `AuditLog` oluşturur.
- Kullanıcı rolü server tarafında daima `USER`; hesap `isActive=true`, `emailVerifiedAt=null` başlar.
- E-posta doğrulama tokenı opaque üretilir, yalnız hash değeri saklanır; önceki unused verification tokenlar revoke edilir.
- Duplicate e-posta ve unique constraint yarışı hesap varlığını açıklamayan aynı 202 response ile sonuçlanır.
- Register akışı `LoginAttempt`, `UserSession`, `RefreshToken` veya `Club` oluşturmaz.
- Rate limit için `RegisterRateLimitService` sınırı hazırlandı; Redis destekli gerçek limit Sprint 4F hardening kapsamındadır.
- Unit ve HTTP integration testleri register davranışını gerçek e-posta gönderimi olmadan doğrular.

Sprint 4C.2 tamamlananlar:

- `POST /auth/login` endpointi eklendi.
- Request DTO `email`, `password` ve opsiyonel `context` (`WEB` veya `ADMIN`) alanlarıyla sınırlandı.
- Kullanıcı bulunamadı, yanlış parola, disabled user ve doğrulanmamış e-posta durumları dışarıya aynı `AUTH_INVALID_CREDENTIALS` 401 response ile döner.
- Kullanıcı bulunamadığında enumeration riskini azaltmak için sahte parola doğrulaması yapılır.
- Başarılı login transaction içinde `UserSession`, ilk `RefreshToken`, `LoginAttempt`, `AuditLog` ve `User.lastLoginAt` yazar.
- Refresh token yalnız HttpOnly cookie ile döner; response body yalnız access token ve public user bilgisini içerir.
- Access token `AccessTokenService` ile DB'deki role ve yeni session id üzerinden üretilir.
- `LoginAttempt` raw email/IP/user-agent/parola/token saklamaz; email, IP ve user-agent hashlenir.
- Audit metadata allowlist `context`, `deviceType`, `browser`, `operatingSystem` ile sınırlıdır.
- Rate limit için `LoginRateLimitService` sınırı hazırlandı; Redis destekli gerçek limit Sprint 4F hardening kapsamındadır.
- Unit, HTTP integration ve production cookie config testleri eklendi.

Sprint 4C.2.2 güvenlik düzeltmeleri:

- Sabit düşük maliyetli fake password hash kaldırıldı.
- `PasswordService` process içinde bir kez dummy Argon2id hash üretir ve cache eder; dummy hash gerçek config `argon2MemoryCost`, `argon2TimeCost` ve `argon2Parallelism` değerlerini kullanır.
- Missing-user yolu `verifyAgainstDummy`, wrong-password yolu gerçek user hash'iyle `verifyPassword` kullanır; iki yol aynı Argon2 verify primitive'inden geçer.
- Invalid Argon2 hash doğrulaması dışarı exception sızdırmadan `false` döner.
- `TRUST_PROXY_HOPS` ve `TRUST_PROXY_CIDRS` Express `trust proxy` runtime ayarına bağlandı; ikisi birlikte config validation ile reddedilir.
- Login client IP çözümü controller'dan çıkarıldı; `request.ip` yalnız trusted proxy sonrası, aksi halde socket IP kullanılır ve IPv4-mapped IPv6 normalize edilir.
- 401 login response'larında `Set-Cookie` olmaması, production `__Host-refresh_token` cookie attribute'ları, XFF spoofing ve trusted proxy davranışı testlerle sabitlendi.
- `context=ADMIN` yetkilendirme sinyali değildir; JWT role DB'den gelir, context yalnız login attempt/audit/risk metadata'sıdır.
- Login service internal sonucu public response DTO ve refresh-cookie payload olarak ayrıldı; raw refresh token response body'ye yayılmaz.

Sprint 4C.3 tamamlananlar:

- `POST /auth/refresh` endpointi eklendi; request body boş olmalıdır.
- Refresh token yalnız auth config cookie adından okunur; body, query veya header içinden token kabul edilmez.
- Controller'a ulaşan body dolu refresh istekleri standart `AUTH_REFRESH_INVALID_BODY` 400 auth hata zarfıyla reddedilir; raw body, token, cookie değeri veya DB detayı response'a yansımaz.
- Başarılı refresh transaction içinde parent token `usedAt` alır, yeni child refresh token hash olarak saklanır, session `lastSeenAt` güncellenir ve `AUTH_REFRESH_SUCCEEDED` audit log yazılır.
- Yeni access token `AccessTokenService` ile DB'deki user role ve session id üzerinden üretilir.
- Yeni refresh token response body'ye girmez; yalnız HttpOnly refresh cookie overwrite edilir.
- Kısa grace window içindeki aynı parent kullanımı `AUTH_REFRESH_CONFLICT` 409 döner, yeni child üretmez ve session revoke etmez.
- Grace window dışındaki replay `AUTH_REFRESH_REUSED` 401 döner, session ve token family revoke eder.
- Cookie yok, invalid, expired, revoked, expired session ve disabled user durumları güvenli `AUTH_REFRESH_INVALID` 401 response döner.
- Refresh akışı `LoginAttempt` yazmaz; audit metadata allowlist `context`, `reason`, `sessionId` ile sınırlıdır.
- Refresh rate limit için `RefreshRateLimitService` boundary eklendi; Redis destekli gerçek limit Sprint 4F kapsamındadır.
- Unit, HTTP integration, race, rollback, replay ve production cookie attribute testleri eklendi.

Sprint 4C.4 tamamlananlar:

- `POST /auth/logout` endpointi eklendi; request body boş olmalıdır.
- Refresh token yalnız auth config cookie adından okunur; body, query veya header içinden token kabul edilmez.
- Cookie yok, uydurma cookie veya zaten revoked session durumları idempotent 204 döner.
- Eşleşen aktif session için current `UserSession` `revokedAt` alır, `revokeReason="user_logout"` olur ve session'a bağlı aktif refresh tokenlar revoke edilir.
- Refresh cookie her normal logout çağrısında config ile uyumlu attribute'larla clear edilir.
- Session cache invalidate edilir; başka sessionlar etkilenmez.
- `AUTH_LOGOUT` audit event metadata allowlist `context`, `reason`, `sessionId` ile sınırlıdır.
- Logout akışı `LoginAttempt` yazmaz; raw token, raw cookie, access token, user-agent ve raw IP response/audit içine girmez.
- Body dolu logout istekleri `AUTH_LOGOUT_INVALID_BODY` 400 auth hata zarfıyla reddedilir.
- Audit yazma hatası session revoke sonucunu tersine çevirmez; revoke transaction hatası başarı gibi raporlanmaz.

Sprint 4C.5 tamamlananlar:

- Access token guard eklendi; `Authorization: Bearer` token doğrulanır, `sid` ile session-active kontrolü yapılır, DB session `userId` ile JWT `sub` eşleştirilir ve disabled/revoked/expired sessionlar 401 `AUTH_UNAUTHORIZED` alır.
- `CurrentUser` request context'i `userId`, `role` ve `sessionId` ile sınırlıdır; client tarafından gönderilen auth alanları kullanılmaz.
- `POST /auth/logout-all` endpointi eklendi; authenticated kullanıcının tüm aktif sessionları ve bağlı aktif refresh tokenları revoke edilir, cache invalidate edilir, refresh cookie clear edilir ve 204 döner.
- Logout-all request body boş olmak zorundadır; body doluysa `AUTH_LOGOUT_ALL_INVALID_BODY` 400 zarfı döner.
- `GET /auth/sessions` endpointi yalnız current user's active session özetlerini döner; current session ilk sıradadır, raw IP/user-agent, hashler, token family ve `userId` dönmez.
- `DELETE /auth/sessions/:sessionId` endpointi eklendi; ownership kontrolü `id + userId` ile yapılır, başka kullanıcı veya yok session için 404 `AUTH_SESSION_NOT_FOUND` döner.
- Current session revoke desteklenir; current hedef silindiğinde refresh cookie clear edilir ve sonraki authenticated istek session-active kontrolünde 401 olur.
- Session revoke request body boş olmak zorundadır; body doluysa `AUTH_SESSION_REVOKE_INVALID_BODY` 400 zarfı döner.
- `AUTH_LOGOUT_ALL` audit metadata allowlist `sessionCount`, `reason`; `AUTH_SESSION_REVOKED` allowlist `targetSessionId`, `isCurrent`, `reason` ile sınırlıdır.
- Audit yazma hatası revoke sonucunu tersine çevirmez; session/refresh revoke transaction sınırında tutulur.

## Sprint 4D - E-posta doğrulama

| Alan | Detay |
| --- | --- |
| Amaç | E-posta doğrulama tokenını güvenli şekilde consume etmek, user email durumunu güncellemek ve sonraki resend/password reset akışlarına zemin hazırlamak. |
| Değişecek ana dosyalar | Auth controller, email verification service, DTO/error sınıfları, auth tests, docs. |
| Test şartları | Valid/invalid/expired/revoked/used token, already verified user, concurrent verify, audit ve leakage testleri. |
| Kabul kriterleri | Token yalnız body'den alınır, hash ile lookup yapılır, atomic consume uygulanır, generic invalid hata döner, raw token sızmaz. |
| Riskler | E-posta sağlayıcısı henüz olmadığı için manuel test fixture yönetimi, gerçek rate limiter'ın Sprint 4F'e kalması. |

Sprint 4D.1 tamamlananlar:

- `POST /auth/verify-email` endpointi eklendi; access token veya refresh cookie gerektirmez.
- Request DTO yalnız `token` alanını kabul eder; token trim edilir, güvenli uzunluk ve kontrol karakteri kontrollerinden geçer.
- Token yalnız body içinden kabul edilir; query/header/cookie/authorization içinden token okunmaz.
- Raw token yalnız `TokenHashService` ile hash lookup için bellekte kullanılır; DB, response ve audit metadata içine yazılmaz.
- Token lookup `tokenHash` ile yapılır; token mevcut, unused, unrevoked, unexpired ve user active olmalıdır.
- Transaction içinde token `usedAt` alır, `User.emailVerifiedAt` güncellenir, aynı kullanıcıya ait diğer unused verification tokenlar revoke edilir ve `AUTH_EMAIL_VERIFIED` audit log yazılır.
- Consume işlemi `usedAt IS NULL`, `revokedAt IS NULL` ve `expiresAt > now` koşullu atomic update ile yarışa dayanıklı hale getirildi.
- Kullanıcı zaten verified olsa bile geçerli unused token consumed edilir ve aynı 200 verified response döner.
- Aynı token ikinci kez, expired, revoked, used, unknown veya disabled-user durumlarında 400 `AUTH_EMAIL_VERIFICATION_INVALID` generic zarfı döner.
- Verify-email access token, refresh token veya session oluşturmaz ve mevcut sessionları revoke etmez.
- Verify-email için Sprint 4F'te Redis limiter bağlanabilecek rate-limit service boundary eklendi; bu sprintte hardcoded limiter yoktur.

Sprint 4D.2 tamamlananlar:

- `POST /auth/resend-verification` endpointi eklendi; publictir ve yalnız body `email` alanını kabul eder.
- DTO email'i register/login ile ortak helper üzerinden trim/lowercase normalize eder; null byte ve kontrol karakterleri reddedilir.
- Geçerli biçimli email girdilerinde unknown, disabled, already verified ve eligible kullanıcı aynı 202 generic accepted response'u alır.
- Uygun kullanıcıda transaction içinde eski unused/unrevoked verification tokenlar revoke edilir, yeni opaque token üretilir, yalnız hash saklanır ve `AUTH_EMAIL_VERIFICATION_RESENT` audit log yazılır.
- PostgreSQL advisory transaction lock ile aynı user için concurrent resend işlemleri serialize edilir; 3 paralel istek sonunda yalnız son token active unused kalır.
- `EmailVerificationDeliveryService` abstraction ve no-op default implementation eklendi; gerçek SMTP/provider entegrasyonu kapsam dışı kaldı.
- Delivery transaction dışındadır; delivery failure response'a sızmaz ve endpoint generic 202 döner.
- Resend access token, refresh token, session veya Set-Cookie üretmez; verified/disabled kullanıcıda side effect oluşturmaz.
- Resend için Sprint 4F'te Redis limiter bağlanabilecek emailHash/IP/endpoint rate-limit boundary eklendi; bu sprintte hardcoded limiter yoktur.

## Sprint 4E - Şifre sıfırlama ve e-posta delivery genişletmesi

| Alan | Detay |
| --- | --- |
| Amaç | Forgot password ve reset password akışlarını kurmak; resend/verify için gerçek provider seçimi gerekiyorsa mevcut delivery abstraction'ı genişletmek. |
| Değişecek ana dosyalar | Auth reset services, mail provider adapter, DTO'lar, tests. |
| Test şartları | Verification token expiry/used/revoked, reset token expiry/used/revoked, enumeration koruması, reset sonrası session revoke. |
| Kabul kriterleri | Response hesap varlığını açıklamaz; tokenlar hashlenmiş saklanır; yeni token önceki unused tokenları revoke eder; mail sağlayıcı gerçek secret gerektirmez. |
| Riskler | E-posta sağlayıcısı seçiminin kapsamı büyütmesi, tokenların loglara sızması. |

## Sprint 4F - Rate limit, audit log ve security hardening

| Alan | Detay |
| --- | --- |
| Amaç | Redis rate limit, bounded in-memory fallback, login attempts, audit log, progressive delay, CSRF/CORS ve security header sertleştirmelerini tamamlamak. |
| Değişecek ana dosyalar | Rate limit module, audit service, guards/interceptors, security headers/CORS config, tests. |
| Test şartları | Brute-force, Redis down fallback, rate limited response, audit metadata sanitization, CSRF Origin check, CORS allowlist testleri. |
| Kabul kriterleri | Auth endpointleri katmanlı limit altındadır; Redis down olduğunda tam fail-open/fail-closed yapılmaz; audit log hassas veri içermez; requestId response ve loglarda izlenir. |
| Riskler | Çok instance ortamında in-memory fallback'in sınırlı koruma sağlaması, proxy config hatasıyla IP bazlı limitlerin atlatılması. |

## Sprint 4G - Web login/register UI ve manuel doğrulama

| Alan | Detay |
| --- | --- |
| Amaç | Web login/register ekranlarını API ile bağlamak, cookie entegrasyonunu doğrulamak ve manuel PWA/browser testlerini yapmak. |
| Değişecek ana dosyalar | `apps/web`, gerekirse `apps/admin` login ekranı, API client, route guards, e2e/manual test notları. |
| Test şartları | Login/register UI, refresh sonrası session sürdürme, logout, production/development cookie attribute kontrolleri, mobil Chrome, Safari/PWA cookie davranışı. |
| Kabul kriterleri | Kullanıcı kayıt/giriş akışını tamamlar; access token localStorage'a yazılmaz; refresh cookie HttpOnly kalır; CORS credentials yalnız allowlist originlerde çalışır. |
| Riskler | Next.js SSR/client boundary içinde token memory yönetimi, Safari cookie kısıtları, cross-domain deployment ayarları. |

## Genel sıralama notları

- Her alt sprint kendi PR'ı ile develop'a alınmalıdır.
- Kod ve migration ilk kez Sprint 4B'de başlayacaktır.
- Test kapsamı riskli auth davranışlarında dar tutulmamalıdır.
- UI Sprint 4G'ye kadar bekletilerek backend güvenlik davranışı önce sabitlenmelidir.
- Production deployment topolojisi Cloudflare/Nginx/load balancer ve trusted proxy kararlarını ayrıca belgelemelidir.
