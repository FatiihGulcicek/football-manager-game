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
| Redis auth rate limiter boundary | İlk istek allowed, limit sınırı allowed, limit üstü denied ve pozitif `Retry-After` üretir. |
| Redis auth rate limiter TTL | TTL ilk istekle atomik atanır, sonraki isteklerde pencere uzatılmaz ve expiry sonrası sayaç resetlenir. |
| Redis auth rate limiter key secrecy | Key `auth:rl:v1:<action>:<identifierHash>` formatındadır; raw email/IP/token/cookie içermez. |
| Redis auth rate limiter fail-open | Redis hata veya malformed sonuç döndürürse safe log yazılır ve endpoint akışı devam eder. |
| Redis auth rate limiter concurrency | 20 paralel istek tam limitte allowed kalır; 21. istek denied olur. |
| JWT payload | Payload `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud` içerir; hassas veri içermez. |
| JWT header | Header `alg=ES256` ve `kid` içerir. |
| Session oluşturma | Her login için yeni `UserSession` ve `tokenFamilyId` üretilir. |
| Session-active cache invalidation | Revoke sonrası ilgili cache key temizlenir. |
| Access token guard missing header | Authorization header yoksa 401 `AUTH_UNAUTHORIZED` standart hata zarfı döner. |
| Access token guard invalid format | Bearer formatı hatalıysa raw token detayı sızmadan 401 döner. |
| Access token guard invalid/expired/unknown kid | JWT doğrulama detayları dışarı verilmeden aynı `AUTH_UNAUTHORIZED` zarfı döner. |
| Access token guard session-active | Revoked, expired veya disabled-user session 401 alır. |
| Access token guard subject/session mismatch | JWT `sub` DB session `userId` ile eşleşmezse 401 döner. |
| Access token guard role mismatch | JWT role DB user role ile uyumsuzsa eski token reddedilir. |
| Refresh rotation | Kullanılmış refresh token `usedAt` alır ve child token oluşturulur. |
| Reuse detection | Grace window dışındaki kullanılmış token tekrar gelirse session revoke edilir. |
| Email verification token hashing | Raw token `TokenHashService` ile hashlenir; lookup hash ile yapılır ve raw token audit/response'a girmez. |
| Email verification atomic consume | Geçerli token `usedAt` alır, user `emailVerifiedAt` güncellenir ve diğer unused tokenlar revoke edilir. |
| Email verification generic invalid | Unknown, expired, revoked, used token ve disabled user aynı `AUTH_EMAIL_VERIFICATION_INVALID` zarfını alır. |
| Email verification already verified user | Geçerli unused token consumed edilir ve 200 verified response döner. |
| Email verification concurrent consume | İki paralel istekte yalnız biri başarılı olur; ikinci generic invalid alır ve yalnız bir audit oluşur. |
| Resend verification normalized lookup | Email trim/lowercase normalize edilir ve register/login helper'ı ile aynı canonical lookup yapılır. |
| Resend verification generic unknown/ineligible | Unknown, disabled ve already verified kullanıcılar aynı 202 accepted response'u alır ve side effect oluşmaz. |
| Resend verification token rotation | Uygun kullanıcıda eski unused/unrevoked tokenlar revoke edilir ve yeni hash token oluşturulur. |
| Resend verification token secrecy | Raw token DB, response veya audit metadata'ya yazılmaz; yalnız delivery abstraction'a aktarılır. |
| Resend verification rollback | Token create veya audit create hata verirse eski token revoke edilmiş kalmaz ve yeni token/audit oluşmaz. |
| Resend verification delivery failure | Delivery hata verse bile response generic 202 kalır; raw token hata response'una sızmaz. |
| Resend verification advisory lock | User-scoped lock çağrılır ve aynı user için concurrent resend işlemleri serialize edilir. |
| Forgot password normalized lookup | Email trim/lowercase normalize edilir ve register/login helper'ı ile aynı canonical lookup yapılır. |
| Forgot password rate-limit boundary | Her geçerli request raw email kullanmadan hashed email, normalized IP ve requestId ile limiter boundary'sinden geçer. |
| Forgot password generic unknown/ineligible | Unknown, disabled ve unverified kullanıcılar aynı 202 accepted response'u alır ve side effect oluşmaz. |
| Forgot password token rotation | Uygun ve verified kullanıcıda eski unused/unrevoked reset tokenlar revoke edilir ve yeni hash token oluşturulur. |
| Forgot password token secrecy | Raw reset token DB, response, audit metadata veya rate-limit inputuna yazılmaz; yalnız delivery abstraction'a aktarılır. |
| Forgot password rollback | Token create, audit create veya transaction hata verirse eski token revoke edilmiş kalmaz, delivery çağrılmaz ve response generic 202 kalır. |
| Forgot password delivery failure | Delivery hata verse bile response generic 202 kalır; committed token ve audit geri alınmaz. |
| Forgot password advisory lock | User-scoped `auth-password-reset:<userId>` lock çağrılır ve aynı user için concurrent reset istekleri serialize edilir. |
| Reset password body-only token | Token yalnız request body içinden kabul edilir; query/header/cookie/authorization tokenları yok sayılır. |
| Reset password token validation | Token trim/normalize edilmez; whitespace, control character, kısa, uzun, array/object/primitive ve extra field payloadları reddedilir. |
| Reset password generic invalid token | Unknown, expired, revoked, used, missing-user, disabled-user, unverified-user ve race-consumed token aynı `INVALID_OR_EXPIRED_RESET_TOKEN` zarfını alır. |
| Reset password purpose separation | `EmailVerificationToken` hash'i reset token olarak kabul edilmez. |
| Reset password password hashing boundary | Yeni parola hash'i transaction dışında üretilir; hash/policy hatasında token consume, session revoke veya audit oluşmaz. |
| Reset password atomic consume | Current reset token koşullu update ile `usedAt` alır ve `revokedAt` null kalır; update count `1` değilse rollback olur. |
| Reset password peer token revoke | Aynı user'a ait diğer unused/unrevoked reset tokenlar revoke edilir; used/revoked tokenlar ve başka user tokenları etkilenmez. |
| Reset password session revoke | Başarılı reset tüm aktif sessionları `PASSWORD_RESET` sebebiyle revoke eder ve bağlı active refresh tokenları revoke eder. |
| Reset password advisory lock | Token hash scoped `auth-password-reset-consume:<tokenHash>` lock çağrılır; raw token lock key içine girmez. |
| Reset password concurrent consume | Aynı tokenla 2 veya 3 paralel istekte yalnız biri başarılı olur, diğerleri generic invalid alır ve tek audit oluşur. |
| Reset password rollback | Password update, token consume, peer token revoke, session revoke, refresh revoke, audit create veya transaction hatasında tüm mutationlar rollback olur. |
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
| Refresh empty body | Body boşsa refresh akışı devam eder ve başarılı durumda yeni access token ile rotated refresh cookie döner. |
| Refresh invalid body envelope | Body içinde `refreshToken`, rastgele alan, nested object veya array varsa 400 `AUTH_REFRESH_INVALID_BODY` standart auth hata zarfı döner. |
| Refresh primitive body parser behavior | Primitive veya bozuk JSON body mevcut parser davranışıyla 400 döner; token materyali, cookie değeri veya DB detayı response'a yansımaz. |
| Refresh cookie missing | Cookie yoksa 401 `AUTH_REFRESH_INVALID` döner ve yeni cookie yazılmaz. |
| Concurrent refresh | Aynı parent token ile iki parallel istekten biri başarılı olur, kısa yarıştaki diğeri `AUTH_REFRESH_CONFLICT` alır. |
| Refresh DB transaction rollback | Transaction hata verirse eski token used durumda kalmaz ve geçerli child oluşmaz. |
| Refresh race grace-window/conflict davranışı | Grace window içindeki ikinci istek session revoke etmez; sürekli tekrar login gerektirir. |
| Replay detection ve session revoke | Grace window dışındaki eski refresh token replay sayılır ve session/token family revoke edilir. |
| Refresh LoginAttempt izolasyonu | Refresh success, conflict, invalid ve replay durumları `LoginAttempt` tablosuna yazılmaz. |
| Logout valid cookie | 204 empty body döner, refresh cookie clear edilir, current session `user_logout` ile revoke edilir ve session refresh tokenları revoked olur. |
| Logout idempotent repeat | Aynı cookie tekrar gönderildiğinde 204 döner, ek session/audit yan etkisi oluşmaz. |
| Logout missing cookie | DB lookup yapılmadan 204 döner ve refresh cookie clear edilir. |
| Logout forged cookie | Token bulunamadığı açıklanmaz; 204 döner, cookie clear edilir, session revoke edilmez. |
| Logout invalid body | Body doluysa 400 `AUTH_LOGOUT_INVALID_BODY` standart auth hata zarfı döner. |
| Logout query/header token rejection | Query veya header ile gelen refresh token yok sayılır; cookie yoksa logout idempotent 204 döner. |
| Logout current-session isolation | İki farklı session varken yalnız cookie ile eşleşen current session kapanır, diğer session aktif kalır. |
| Logout transaction rollback | Refresh token revoke fail olursa session yarım revoked durumda kalmaz ve başarı gibi raporlanmaz. |
| Logout LoginAttempt izolasyonu | Logout success, missing cookie ve invalid cookie durumları `LoginAttempt` tablosuna yazılmaz. |
| Logout | Current session ve bağlı refresh tokenlar revoke edilir, cookie temizlenir, access token hemen reddedilir. |
| Logout all devices | Kullanıcının tüm sessionları revoke edilir ve eski access tokenlar session-active kontrolünde reddedilir. |
| Logout-all invalid body | Body doluysa 400 `AUTH_LOGOUT_ALL_INVALID_BODY` standart auth hata zarfı döner ve raw body sızmaz. |
| Logout-all isolation | Authenticated user dışındaki kullanıcıların sessionları ve refresh tokenları etkilenmez. |
| Logout-all audit failure | Audit yazımı başarısız olsa bile revoke sonucu geri alınmaz. |
| Logout-all transaction rollback | Refresh token revoke fail olursa yarım revoke başarı gibi raporlanmaz. |
| Role change sonrası eski access token reddi | Role değiştiğinde tüm sessionlar revoke edilir; eski token 401 alır. |
| Email verification success | Geçerli token 200 `{ status: "verified" }` döner, `emailVerifiedAt` ve token `usedAt` dolar. |
| Email verification second use | Aynı token ikinci kez kullanıldığında 400 `AUTH_EMAIL_VERIFICATION_INVALID` döner. |
| Email verification invalid variants | Expired, revoked, used, unknown token ve disabled user aynı response'u döner. |
| Email verification body-only token | Query/header token kabul edilmez; body dışından token gelirse consume yapılmaz. |
| Email verification extra fields | `role`, `userId` gibi ek body alanları generic invalid ile reddedilir. |
| Email verification no session issuance | Doğrulama access token, refresh token veya session oluşturmaz; kullanıcı sonra login yapar. |
| Resend verification valid request | Geçerli body ile 202 accepted döner, Set-Cookie/access/refresh/session oluşturulmaz. |
| Resend verification enumeration | Unknown, eligible, verified ve disabled kullanıcı aynı body response'unu alır. |
| Resend verification body-only email | Query/header/cookie email kabul edilmez; body email yoksa validation 400 döner. |
| Resend verification malformed email | Empty, whitespace-only, invalid, null, object, array, number, oversized, null byte, kontrol karakteri ve extra field 400 alır. |
| Resend verification case/trim | Uppercase ve surrounding whitespace request mevcut normalized email ile eşleşir. |
| Resend verification concurrent | 3 paralel request 202 döner; sonunda yalnız 1 active unused token kalır, audit/delivery count sözleşmeye uygundur. |
| Resend verification isolation | Başka kullanıcının verification tokenları revoke edilmez. |
| Forgot password valid request | Geçerli body ile 202 accepted döner, eski reset token revoked olur, yeni reset token hash olarak saklanır ve delivery abstraction çağrılır. |
| Forgot password enumeration | Unknown, eligible, disabled ve unverified kullanıcı aynı body response'unu alır. |
| Forgot password body-only email | Query/header/cookie/authorization email kabul edilmez; body email yoksa validation 400 döner. |
| Forgot password malformed email | Empty, whitespace-only, invalid, null, object, array, number, primitive body, oversized, null byte, kontrol karakteri ve extra field 400 alır. |
| Forgot password verified-only eligibility | `emailVerifiedAt == null` kullanıcıda token revoke/create, audit veya delivery side effect oluşmaz. |
| Forgot password transaction failure | Candidate user bulunduktan sonra transaction/advisory lock/token/audit hatası generic 202 döner ve delivery çağırmaz. |
| Forgot password delivery failure | Delivery failure generic 202 döner, token/audit committed kalır ve raw token response'a sızmaz. |
| Forgot password concurrent | 3 paralel request 202 döner; sonunda yalnız 1 active unused reset token kalır, audit/delivery count sözleşmeye uygundur. |
| Forgot password isolation | Başka kullanıcının reset tokenları revoke edilmez. |
| Reset password success | Geçerli body ile 200 `{ status: "success", message }` döner, password hash değişir, current token `usedAt` alır, peer reset tokenlar revoke edilir ve tüm session/refresh tokenlar revoke edilir. |
| Reset password invalid variants | Unknown, expired, revoked, used, disabled, unverified ve missing-user durumları aynı 400 `INVALID_OR_EXPIRED_RESET_TOKEN` zarfını döner. |
| Reset password body-only token | Query/header/cookie/authorization ile gelen token kabul edilmez; body token yoksa validation 400 döner. |
| Reset password malformed body | Missing token/password, empty/whitespace token, control character, array, primitive, nested object, malformed JSON ve extra field 400 alır; raw body response'a yansımaz. |
| Reset password weak password | Password policy hatasında token kullanılmaz, session/refresh revoke edilmez ve audit oluşmaz. |
| Reset password concurrent | Aynı tokenla iki paralel HTTP isteğinde yalnız biri 200 alır; diğeri generic invalid alır ve tek audit oluşur. |
| Session listing | Kullanıcı yalnız kendi session özetlerini görür. |
| Session listing current-first | Current session `isCurrent=true` ile ilk sırada, diğerleri `lastSeenAt` descending döner. |
| Session listing safe fields | `tokenFamilyId`, `ipHash`, `userAgentHash`, refresh tokenlar, raw IP, raw user-agent ve `userId` dönmez. |
| Session revoke other device | Kullanıcı kendisine ait başka cihaz sessionını 204 ile revoke eder; current cookie korunur. |
| Session revoke current device | Current session revoke edilirse refresh cookie clear edilir ve eski access token sonraki istekte 401 alır. |
| Session revoke invalid body | Body doluysa 400 `AUTH_SESSION_REVOKE_INVALID_BODY` standart auth hata zarfı döner. |
| Session revoke idempotency | Kullanıcıya ait zaten revoked hedef için 204 kabul edilir; başka kullanıcı veya yok session için 404 kalır. |
| Session ownership IDOR | Başka kullanıcının session kaydı silinemez; 404 güvenli yanıt döner. |

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
| Redis down fail-open limiter | Redis unavailable olduğunda endpoint akışı devam eder, safe log yazılır ve Redis hata detayı response'a sızmaz. |
| Rate limited HTTP envelope | Public auth endpointleri 429 `AUTH_RATE_LIMITED`, `requestId` ve `Retry-After` döner; Set-Cookie, raw token, cookie, sayaç veya DB detayı içermez. |
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
| Refresh raw-token leakage | Raw refresh token DB, JSON body, audit metadata ve loglarda bulunmaz; yalnız Set-Cookie içinde taşınır. |
| Refresh invalid body leakage | `AUTH_REFRESH_INVALID_BODY` response'u raw body, refresh token, cookie değeri veya DB detayı içermez. |
| Logout raw-token leakage | Logout response, audit metadata ve loglar raw refresh token, cookie değeri, access token, authorization header, raw IP ve user-agent içermez. |
| Logout production clear-cookie attributes | `__Host-refresh_token`, host-only, `Path=/`, Secure, HttpOnly, SameSite=Lax ve geçmiş expiry doğrulanır. |
| Session management leakage | Session list/revoke/logout-all response ve audit metadata raw token, cookie, authorization header, raw IP, user-agent ve DB detayı içermez. |
| Session management IDOR | User A, User B sessionını listeleyemez veya silemez; silme denemesi 404 ile existence gizler. |
| Email verification leakage | Verify response ve audit metadata raw token, tokenHash, email, cookie, authorization header, raw IP ve DB detayı içermez. |
| Email verification audit flood boundary | Invalid token denemeleri sınırsız audit log üretmez; Redis limiter/metric boundary'si korunur. |
| Resend verification leakage | Response, audit metadata ve validation errors raw token, tokenHash, email, cookie, authorization header, raw IP veya DB detayı içermez. |
| Resend verification SQL/advisory lock injection | Advisory lock query parameterized bind kullanır; userId raw SQL stringine interpolate edilmez. |
| Resend verification timing enumeration | Geçerli email girdilerinde response aynı 202 olur; yapay sleep eklenmez, timing riski Redis limiter/metrics ile izlenir. |
| Forgot password leakage | Response, audit metadata, validation errors ve rate-limit inputları raw reset token, tokenHash, email, cookie, authorization header, raw IP veya DB detayı içermez. |
| Forgot password parser leakage | Array, primitive body ve malformed JSON güvenli 400 döner; raw request body response'a yansımaz. |
| Forgot password SQL/advisory lock injection | Advisory lock query parameterized bind kullanır; userId raw SQL stringine interpolate edilmez. |
| Forgot password transaction enumeration | Eligible user transaction failure durumunda unknown user'dan farklı status üretilmez; delivery çağrısı yapılmaz. |
| Forgot password out-of-order delivery risk | Concurrent delivery çağrıları sonunda tek active token kalır; önceki e-postanın geç teslim riski dokümante edilir ve Redis limiter/provider kuyruğuyla azaltılır. |
| Reset password leakage | Response, audit metadata, validation errors ve rate-limit inputları raw reset token, tokenHash, password, cookie, authorization header, raw IP, session id, refresh token id veya DB detayı içermez. |
| Reset password replay resistance | Kullanılmış reset token tekrar gönderildiğinde session veya password ikinci kez değişmez, generic invalid döner ve ikinci audit oluşmaz. |
| Reset password SQL/advisory lock injection | Advisory lock query parameterized bind kullanır; lock subject tokenHash'tir ve raw token SQL stringine interpolate edilmez. |
| Reset password access-token invalidation | Başarılı reset sonrası eski access tokenlar session-active kontrolünde reddedilir. |
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
| Session management manuel akış | User A iki session, User B bir session ile list/revoke/IDOR/current revoke/logout-all akışı doğrulanır. |
| Verify-email manuel akış | Geçerli, ikinci kullanım, uydurma, expired, revoked ve paralel verify davranışları aynı local fixture düzeniyle doğrulanır. |
| Resend verification manuel akış | Register sonrası resend 202 döner; eski token revoked, yeni hash token created, unknown/verified/disabled 202 ve 3 concurrent request sonunda 1 active token doğrulanır. |
| Forgot password manuel akış | Verified kullanıcı için 202, eski reset token revoke, yeni hash token created; unknown/disabled/unverified 202 ve 3 concurrent request sonunda 1 active reset token doğrulanır. |
| Reset password manuel akış | Fixture reset token ile 200 response, password hash değişimi, token `usedAt`, peer token revoke, session/refresh revoke, replay/expired/revoked/unknown generic 400 ve 2 concurrent requestte 1 success/1 invalid doğrulanır. |
| Saat farkı | UTC expiry ve clock skew toleransı kullanıcıyı gereksiz kırmaz; server expiry esas alınır. |
| Redis kapalı | Auth limiter fail-open davranır; endpointler Redis detayını sızdırmaz ve safe internal log üretir. |
| PostgreSQL kapalı | Auth endpointleri kontrollü hata döner; health degraded döner. |
| Cloudflare/Nginx/load balancer topolojisi | Production deployment IP normalization dokümanı ile runtime config eşleşir. |

## Kabul notları

- Auth testleri watch modunda çalışmaz; CI `vitest run` kullanır.
- Security testleri gerçek secret kullanmaz.
- Test fixture parolaları açıkça test değeri olarak kalır; production-like secret üretilmez.
- Wall-clock timing testleri ana CI'ı kıracak şekilde yazılmaz; gerekiyorsa ayrı manual/security benchmark notu olarak çalıştırılır.
- Redis auth rate limit testleri Sprint 4F.1 kapsamında eklenmiştir; CORS Origin/Referer hardening ve audit retention testleri sonraki security hardening kapsamındadır.
