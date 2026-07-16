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

Durum: Kısmen tamamlandı. Sprint 4C.1 kapsamında `POST /auth/register`, Sprint 4C.2 kapsamında `POST /auth/login` uygulandı; refresh endpointi, logout, logout-all ve session listeleme sonraki alt sprintlerde kalır.

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

## Sprint 4D - Refresh rotation, logout ve session yönetimi

| Alan | Detay |
| --- | --- |
| Amaç | Atomic refresh token rotation, reuse detection, logout, logout-all, session listesi ve session revoke endpointlerini uygulamak. |
| Değişecek ana dosyalar | Auth session service, refresh token repository/service, auth controller, guards, tests. |
| Test şartları | Refresh success, concurrent refresh conflict, transaction rollback, replay attack, revoked session, logout, logout-all, başka kullanıcının sessionını silme testleri. |
| Kabul kriterleri | Refresh token tek kullanımlıdır; short race `AUTH_REFRESH_CONFLICT` döner; gerçek replay session revoke eder; access token revoke sonrası hemen reddedilir. |
| Riskler | Concurrent refresh race condition, cookie temizleme davranışının browserlar arasında farklılaşması, session-active cache invalidation hataları. |

## Sprint 4E - E-posta doğrulama ve şifre sıfırlama

| Alan | Detay |
| --- | --- |
| Amaç | Email verification, resend verification, forgot password ve reset password akışlarını kurmak. |
| Değişecek ana dosyalar | Auth email/reset services, mail provider abstraction veya fake adapter, DTO'lar, tests. |
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
