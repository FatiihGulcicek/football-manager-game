# Authentication Implementation Plan

Bu plan Sprint 4A tasarımından sonra authentication geliştirmesini küçük ve doğrulanabilir alt sprintlere böler.

## Sprint 4B - Auth veri modelleri ve config

| Alan | Detay |
| --- | --- |
| Amaç | Auth veri modellerini Prisma'ya eklemek, migration üretmek, temel DTO ve config validation zeminini kurmak. |
| Değişecek ana dosyalar | `packages/database/prisma/schema.prisma`, migration klasörü, `apps/api/src/config`, auth DTO taslakları, `.env.example` placeholderları. |
| Test şartları | Prisma validate/generate, migration test DB'de uygulanabilirlik, config validation unit testleri. |
| Kabul kriterleri | `UserSession`, `RefreshToken`, verification/reset token, `LoginAttempt`, `AuditLog` modelleri migration ile oluşur; secret değerler gerçek değildir. |
| Riskler | Cascade davranışının audit logları yanlış silmesi, config defaultlarının production için fazla gevşek kalması. |

## Sprint 4C - Password, JWT, session, register ve login

| Alan | Detay |
| --- | --- |
| Amaç | Parola hash/doğrulama, access JWT üretimi, session service, register ve login akışlarını kurmak. |
| Değişecek ana dosyalar | `apps/api/src/auth`, `apps/api/src/users` veya eşdeğer user service, DTO'lar, unit/integration testler. |
| Test şartları | Password service, JWT payload, register, login success/failure, disabled user ve role kontrol testleri. |
| Kabul kriterleri | Login access token ve refresh cookie üretir; role client inputundan alınmaz; invalid credentials güvenli döner. |
| Riskler | Enumeration sızıntısı, Argon2id parametrelerinin local/CI üzerinde fazla yavaş olması. |

## Sprint 4D - Refresh rotation, logout ve session yönetimi

| Alan | Detay |
| --- | --- |
| Amaç | Refresh token rotation, reuse detection, logout, logout-all, session listesi ve session revoke endpointlerini uygulamak. |
| Değişecek ana dosyalar | Auth session service, refresh token repository/service, auth controller, guards, tests. |
| Test şartları | Refresh success, replay attack, revoked session, logout, logout-all, başka kullanıcının sessionını silme testleri. |
| Kabul kriterleri | Refresh token tek kullanımlıdır; replay session revoke eder; session ekranı raw IP/user-agent göstermez. |
| Riskler | Concurrent refresh race condition, cookie temizleme davranışının browserlar arasında farklılaşması. |

## Sprint 4E - E-posta doğrulama ve şifre sıfırlama

| Alan | Detay |
| --- | --- |
| Amaç | Email verification, resend verification, forgot password ve reset password akışlarını kurmak. |
| Değişecek ana dosyalar | Auth email/reset services, mail provider abstraction veya fake adapter, DTO'lar, tests. |
| Test şartları | Verification token expiry/used, reset token expiry/used, enumeration koruması, reset sonrası session revoke. |
| Kabul kriterleri | Response hesap varlığını açıklamaz; tokenlar hashlenmiş saklanır; mail sağlayıcı gerçek secret gerektirmez. |
| Riskler | E-posta sağlayıcısı seçiminin kapsamı büyütmesi, tokenların loglara sızması. |

## Sprint 4F - Rate limit, audit log ve security hardening

| Alan | Detay |
| --- | --- |
| Amaç | Redis rate limit, login attempts, audit log, progressive delay, CSRF/CORS ve security header sertleştirmelerini tamamlamak. |
| Değişecek ana dosyalar | Rate limit module, audit service, API bootstrap, guards/interceptors, tests. |
| Test şartları | Brute-force, rate limited response, audit log içeriği, CSRF Origin check, CORS allowlist testleri. |
| Kabul kriterleri | Auth endpointleri katmanlı limit altındadır; audit log hassas veri içermez; requestId response ve loglarda izlenir. |
| Riskler | Redis kapalıyken fail-open/fail-closed dengesinin yanlış kurulması, admin işlemlerinde gereksiz kullanıcı sürtünmesi. |

## Sprint 4G - Web login/register UI ve manuel doğrulama

| Alan | Detay |
| --- | --- |
| Amaç | Web login/register ekranlarını API ile bağlamak, cookie entegrasyonunu doğrulamak ve manuel PWA/browser testlerini yapmak. |
| Değişecek ana dosyalar | `apps/web`, gerekirse `apps/admin` login ekranı, API client, route guards, e2e/manual test notları. |
| Test şartları | Login/register UI, refresh sonrası session sürdürme, logout, mobil Chrome, Safari/PWA cookie davranışı. |
| Kabul kriterleri | Kullanıcı kayıt/giriş akışını tamamlar; access token localStorage'a yazılmaz; refresh cookie HttpOnly kalır. |
| Riskler | Next.js SSR/client boundary içinde token memory yönetimi, Safari cookie kısıtları, cross-domain deployment ayarları. |

## Genel sıralama notları

- Her alt sprint kendi PR'ı ile develop'a alınmalıdır.
- Kod ve migration ilk kez Sprint 4B'de başlayacaktır.
- Test kapsamı riskli auth davranışlarında dar tutulmamalıdır.
- UI Sprint 4G'ye kadar bekletilerek backend güvenlik davranışı önce sabitlenmelidir.
