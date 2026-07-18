# Authentication Security

## Token taşıma kararı

| Seçenek | Artılar | Riskler | Karar |
| --- | --- | --- | --- |
| Access ve refresh token HttpOnly cookie | JavaScript token okuyamaz; XSS etkisi azalır | Access cookie otomatik gönderildiği için CSRF tasarımı daha kritik olur | Bu proje için ikincil seçenek. |
| Access token memory, refresh token HttpOnly cookie | Access token kısa ömürlüdür; refresh token JavaScript tarafından okunamaz; PWA için dengeli yaklaşım | XSS access tokenı bellekteyken kötüye kullanabilir; refresh endpoint için CSRF gerekir | Tercih edilen yaklaşım. |
| İki token localStorage | Uygulaması kolay | XSS halinde iki token da çalınabilir; uzun ömürlü refresh token kalıcı risk olur | Reddedildi. |

Nihai karar: access token kısa ömürlü olarak istemci belleğinde tutulur, refresh token `HttpOnly`, `Secure`, `SameSite=Lax` cookie ile taşınır.

## Cookie topolojisi

Production refresh cookie:

- Ad: `__Host-refresh_token`.
- Domain attribute kullanılmaz.
- Host scope: `api.example.com`.
- `Path=/`.
- `Secure=true`.
- `HttpOnly=true`.
- `SameSite=Lax`.
- CORS allowlist yalnız `https://app.example.com` ve `https://admin.example.com`.
- `Access-Control-Allow-Credentials=true`.
- Wildcard origin yasak.

`__Host-` prefix güvenliği Domain attribute kullanılmamasını, `Secure=true` değerini ve `Path=/` kullanımını gerektirir. Bu nedenle dar path yerine bilinçli olarak host-only ve `Path=/` modeli seçilir.

Development:

- Localhost için prefix'siz cookie adı kullanılabilir.
- `Secure=false` olabilir.
- `SameSite=Lax` korunur.
- Cookie ayarları environment bazlıdır.
- Config validation production ayarlarının development'a, development gevşekliğinin production'a sızmasını engeller.

## XSS, CSRF ve CORS

- XSS: Refresh token JavaScript tarafından okunamaz. Access token çalınsa bile 15 dakika içinde biter ve session-active kontrolüyle revoke edilen oturumlar hemen reddedilir.
- CSRF: Refresh cookie otomatik gideceği için `/auth/refresh`, `/auth/logout` ve benzeri cookie kullanan endpointlerde SameSite, Origin/Referer kontrolü ve gerekirse CSRF token gerekir.
- CORS: Credential isteyen auth endpointleri yalnız izinli web/admin originlerine açılır.
- `Access-Control-Allow-Origin: *` ile credentials birlikte kullanılmaz.
- Production HTTPS dışında secure cookie çalıştırılmaz.
- Mobil gelecek: Native mobil uygulamada refresh token platform secure storage içinde tutulabilir; server tarafındaki opaque refresh, rotation ve session modeli değişmeden kalır.

## Trusted proxy ve gerçek istemci IP

- API yalnız güvenilen reverse proxy, CDN veya load balancer hop'larından gelen forwarded header'lara güvenir.
- Güvenilen proxy sayısı veya CIDR allowlist environment/config ile tanımlanır.
- `TRUST_PROXY_HOPS` tanımlıysa bootstrap Express `trust proxy` değerini hop count olarak set eder.
- `TRUST_PROXY_CIDRS` tanımlıysa bootstrap Express `trust proxy` değerini CIDR allowlist olarak set eder.
- Bu iki ayar aynı anda kullanılamaz; config validation bunu reddeder.
- Güvenilmeyen bağlantılarda socket IP kullanılır.
- İstemciden gelen `X-Forwarded-For` doğrudan kabul edilmez.
- Uygulama `X-Forwarded-For` header'ını elle parse etmez; trusted proxy çözümünden sonra Express `request.ip` kullanılır.
- Rate limit, audit log ve `ipHash` üretimi aynı normalize edilmiş client IP kaynağını kullanır.
- IPv4-mapped IPv6 (`::ffff:192.0.2.1`) düz IPv4 biçimine normalize edilir.
- Cloudflare, Nginx veya load balancer topolojisi production deployment belgesinde açıkça tanımlanmalıdır.

## JWT imzalama ve key rotation

Nihai karar ES256'dır.

- JWT `alg`: `ES256`.
- JWT header: `kid` zorunlu.
- JWT payload: `sub`, `role`, `sid`, `iat`, `exp`, `iss`, `aud`.
- `iss`: `football-manager-auth`.
- `aud`: `football-manager-api`.
- Clock skew toleransı 5-10 saniye.
- Aktif ve önceki public keyler sınırlı doğrulama penceresinde kabul edilir.
- Private key yalnız auth/API signing tarafında bulunur.
- Public key doğrulayıcılara dağıtılabilir.
- JWT secret yerine signing key pair environment/secret manager üzerinden yönetilir.
- Development için test key materyali repository'ye commit edilmez.
- Key rotation sırasında yeni tokenlar aktif `kid` ile imzalanır; kısa TTL nedeniyle eski access tokenlar hızlıca doğal olarak biter, ancak session-active kontrolü revoke durumlarında beklemez.

## Session-active kontrolü

Her authenticated request, JWT signature/exp doğrulamasından sonra `sid` üzerinden session-active kontrolünden geçer. Kısa access token TTL tek başına yeterli kabul edilmez.

- Redis'te 30-60 saniyelik kısa TTL session-active cache kullanılabilir.
- Session revoke, logout-all, password reset, account disable ve role change olaylarında cache anında invalidate edilir.
- Redis unavailable olduğunda DB source of truth olarak kullanılır.
- DB de erişilemezse authenticated endpoint güvenli şekilde reddedilir.
- Kullanıcı veya session revoke edilmişse access token süresi dolmamış olsa bile istek reddedilir.

## Role change

- Kullanıcının rolü değiştiğinde tüm aktif session'ları revoke edilir.
- Mevcut access tokenlar session-active kontrolü nedeniyle hemen etkisiz olur.
- Yeni rol ancak yeni login ile alınır.
- `AUTH_ROLE_CHANGED` audit olayı yazılır.
- `actorUserId` ve `targetUserId` ayrımı korunur.
- Role claim istemciden kabul edilmez.

## Parola politikası

Başlangıç politikası:

- Minimum 10 karakter.
- Maksimum 128 karakter.
- En az bir harf ve bir sayı.
- Boşluklara izin verilir.
- Kullanıcı adı, display name veya e-posta parçası parolada bulunmamalıdır.
- Güç ölçümü yapılmalıdır.
- Zorunlu özel karakter kuralı getirilmez.
- Yaygın veya sızmış parola kontrolü eklenmelidir; ilk sürümde offline yaygın parola listesi, sonraki sürümlerde k-anonymity tabanlı servis değerlendirilebilir.

Maksimum uzunluk, password hashing kaynak tüketimini kontrol altında tutmak için gereklidir. Parola inputları loglanmaz, telemetry'ye eklenmez ve validation hatalarında geri yansıtılmaz.

## Unicode ve input validation

- Parola hash öncesi Unicode NFC normalization uygulanır.
- Maksimum parola uzunluğu Argon2 çağrısından önce kontrol edilir.
- Null byte ve sakıncalı kontrol karakterleri reddedilir.
- DTO payload size limiti uygulanır.
- Standard Argon2 verify API kullanılır.
- Elle digest comparison yazılmaz.
- Oversized e-posta, displayName, deviceName ve JSON body değerleri validation veya body parser limitleriyle reddedilir.

## Argon2id

- Parolalar Argon2id ile hashlenir.
- Üretim parametreleri kesin sabit olarak belgelenmez; hedef altyapıda benchmark edilmelidir.
- Benchmark hedefi, normal login deneyimini yavaşlatmadan offline brute-force maliyetini anlamlı artırmaktır.
- Memory cost, time cost ve parallelism değerleri deployment sınıfına göre config ile belirlenmelidir.
- Hash formatı algoritma ve parametre bilgisini içermeli, ileride rehash stratejisine izin vermelidir.
- Kullanıcı login olduğunda eski parametreli hash tespit edilirse başarılı doğrulama sonrası rehash yapılabilir.
- Kullanıcı bulunamadığında timing oracle riskini azaltmak için sabit düşük maliyetli hash kullanılmaz.
- Dummy Argon2id hash process içinde bir kez üretilir, cache edilir ve gerçek parola hashleriyle aynı `argon2MemoryCost`, `argon2TimeCost` ve `argon2Parallelism` config değerlerini kullanır.
- Dummy parola ve dummy hash loglanmaz; dummy hash üretilemezse uygulama fail-fast davranır.
- Invalid Argon2 hash doğrulaması exception sızdırmadan güvenli `false` sonucuna döner.

## Token entropy ve hashing

- Opaque refresh token minimum 256-bit CSPRNG ile üretilir.
- Refresh token en az 32 byte random değer içerir ve base64url encoding ile taşınır.
- Plaintext refresh token yalnız istemciye bir kez verilir.
- DB'de HMAC/pepper hash saklanır.
- Email verification ve password reset tokenları da yeterli CSPRNG entropy ile üretilir ve hash saklanır.
- Pepper secret olarak saklanır ve repository'ye eklenmez.
- Token karşılaştırmaları constant-time yapılmalıdır.
- Token değerleri log, audit metadata, hata mesajı veya monitoring event içine yazılmaz.

## Email verification

- Sprint 4D.1 uygulamasında `POST /auth/verify-email` public endpointtir ve tokenı yalnız request body içinden kabul eder.
- Raw verification token DB, response, audit metadata veya loglara yazılmaz; yalnız `TokenHashService` ile hash lookup için bellekte kullanılır.
- Token zorunlu stringdir, trim edilir, güvenli uzunluk aralığına ve kontrol karakteri reddine tabidir.
- Token bulunamadı, expired, revoked, used, user missing veya disabled user durumları aynı 400 `AUTH_EMAIL_VERIFICATION_INVALID` zarfına döner.
- Geçerli unused token, kullanıcı zaten verified olsa bile consumed edilir ve 200 verified response döner.
- Token consume işlemi `usedAt IS NULL`, `revokedAt IS NULL` ve `expiresAt > now` koşullarıyla atomic update kullanır; paralel iki istekte yalnız biri başarılı olabilir.
- Başarılı doğrulama transaction içinde `User.emailVerifiedAt` günceller, tokenı used yapar, aynı kullanıcıya ait diğer unused verification tokenları revoke eder ve `AUTH_EMAIL_VERIFIED` audit kaydı oluşturur.
- Audit metadata allowlist yalnız `context` ve `verificationMethod` alanlarını içerir; token, tokenHash, email, IP, cookie ve authorization header metadata'ya girmez.
- Geçersiz token denemeleri sınırsız audit log üretmez; Redis rate-limit boundary verify-email IP ve token-hash bucketlarını kullanır.
- E-posta doğrulama session oluşturmaz, access/refresh token üretmez, session revoke etmez ve login işlemi yapmaz.

## Resend email verification

- Sprint 4D.2 uygulamasında `POST /auth/resend-verification` public endpointtir ve email'i yalnız request body içinden kabul eder.
- Geçerli biçimli email girdilerinde kullanıcı yok, disabled, already verified veya eligible ayrımı response'a yansımaz; hepsi 202 generic accepted döner.
- Malformed body, geçersiz email formatı, boş/whitespace email, aşırı uzun email, array/object/number email, null byte, kontrol karakteri ve ekstra alanlar DTO validation ile 400 döner.
- Canonical email normalization register/login ile aynı helper üzerinden trim/lowercase uygulanarak yapılır; kontrol karakterleri trim ile gizlenmeden reddedilir.
- Uygun kullanıcı koşulu: user exists, active, `emailVerifiedAt == null`, normalized DB email request email ile eşleşir.
- Disabled veya already verified kullanıcı için token revoke/create, audit veya mail delivery side effect üretilmez.
- Raw resend token minimum 256-bit entropy üreten `TokenHashService.generateOpaqueToken()` ile oluşturulur; DB'ye yalnız HMAC/pepper hash yazılır.
- Transaction içinde önce aynı kullanıcıya ait tüm unused/unrevoked verification tokenlar revoke edilir, sonra yeni token create edilir, sonra `AUTH_EMAIL_VERIFICATION_RESENT` audit kaydı yazılır.
- Aynı user için concurrent resend istekleri PostgreSQL advisory transaction lock ile serialize edilir; 3 paralel istek sonunda yalnız son token active unused kalır.
- Advisory lock raw SQL parametreli bind ile çağrılır; lock key `auth-email-resend:<userId>` biçimindedir ve SQL injection yüzeyi oluşturmaz. Bu karar PostgreSQL'e özeldir.
- Mail delivery transaction dışında `EmailVerificationDeliveryService` abstraction'ı ile yapılır; default implementation no-op'tur ve gerçek SMTP/provider entegrasyonu yapmaz.
- Delivery failure response'a sızmaz; endpoint 202 döner. Bu tokenın DB'de kalıp mailin iletilememesi riski sonraki provider retry-metric tasarımında tekrar incelenmelidir.
- Audit metadata allowlist yalnız `context: WEB` ve `verificationMethod: TOKEN_RESEND` alanlarını içerir; raw token, tokenHash, email, request body, IP, cookie, authorization header, expiresAt ve token idleri yazılmaz.
- Rate-limit boundary Redis fixed-window limiter'a bağlıdır; IP ve normalized email hash bucketları kullanılır.

## Forgot password request

- Sprint 4E.1 uygulamasında `POST /auth/forgot-password` public endpointtir ve email'i yalnız request body içinden kabul eder.
- Geçerli biçimli email girdilerinde unknown, disabled, unverified ve eligible kullanıcı ayrımı response'a yansımaz; hepsi 202 generic accepted döner.
- Malformed body, geçersiz email formatı, boş/whitespace email, aşırı uzun email, array/object/number email, primitive body, null byte, kontrol karakteri ve ekstra alanlar validation ile 400 döner.
- Canonical email normalization register/login ile aynı helper üzerinden trim/lowercase uygulanarak yapılır; kontrol karakterleri trim ile gizlenmeden reddedilir.
- Uygun kullanıcı koşulu: user exists, active, `emailVerifiedAt != null`, normalized DB email request email ile eşleşir.
- Disabled veya unverified kullanıcı için token revoke/create, audit veya mail delivery side effect üretilmez.
- Raw reset token minimum 256-bit entropy üreten `TokenHashService.generateOpaqueToken()` ile oluşturulur; DB'ye yalnız HMAC/pepper hash yazılır.
- Transaction içinde önce aynı kullanıcıya ait tüm unused/unrevoked password reset tokenlar revoke edilir, sonra yeni token create edilir, sonra `AUTH_PASSWORD_RESET_REQUESTED` audit kaydı yazılır.
- Expired ama unused/unrevoked reset tokenlar da revoke edilir; tek kullanıcı için tek active unused reset token kalır.
- Aynı user için concurrent forgot-password istekleri PostgreSQL advisory transaction lock ile serialize edilir; 3 paralel istek sonunda yalnız son token active unused kalır.
- Advisory lock raw SQL parametreli bind ile çağrılır; lock key `auth-password-reset:<userId>` biçimindedir ve SQL injection yüzeyi oluşturmaz. Bu karar PostgreSQL'e özeldir.
- Transaction, advisory lock, token create veya audit create hata verirse response yine generic 202 kalır ve delivery çağrılmaz. Böylece eligible kullanıcı için 500, unknown kullanıcı için 202 timing/status ayrımı oluşmaz.
- İlk candidate lookup DB outage durumunda normal altyapı hatası dönebilir; bu endpoint DB tamamen kapalıyken hesap varlığı saklamak için fake success üretmez.
- Mail delivery transaction dışında `PasswordResetDeliveryService` abstraction'ı ile yapılır; default implementation no-op'tur ve gerçek SMTP/provider entegrasyonu yapmaz.
- Delivery failure response'a sızmaz; endpoint 202 döner. Token ve audit committed kalır. Bu tokenın DB'de kalıp mailin iletilememesi riski sonraki provider retry-metric tasarımında tekrar incelenmelidir.
- Çok paralel requestlerde delivery transaction dışı olduğu için önceki reset e-postası son e-postadan sonra teslim edilebilir; bu out-of-order risk rate limit ve provider kuyruğu ile azaltılmalıdır.
- Audit metadata allowlist yalnız `context: WEB` ve `resetMethod: EMAIL_TOKEN` alanlarını içerir; raw token, tokenHash, email, request body, IP, cookie, authorization header, user-agent, expiresAt ve token idleri yazılmaz.
- Rate-limit boundary Redis fixed-window limiter'a bağlıdır; IP ve normalized email hash bucketları kullanılır.
- Forgot-password request parola değiştirmez, session revoke etmez, refresh token revoke etmez, access token üretmez ve Set-Cookie yazmaz; bunlar reset-password/change-password sprintlerinin konusudur.

## Reset password consume

- Sprint 4E.2 uygulamasında `POST /auth/reset-password` public endpointtir ve reset tokenı yalnız request body içinden kabul eder.
- Token query, path, header, cookie veya `Authorization` içinden kabul edilmez.
- Reset token trim/normalize/lowercase yapılmaz; opaque ve case-sensitive kalır.
- Token formatı minimum 32, maksimum 512 karakter ve base64url uyumlu karakterlerle sınırlıdır; whitespace, tab, CR/LF, null byte ve kontrol karakterleri reddedilir.
- Raw token DB, response, audit metadata, rate-limit inputu, lock key veya loglara yazılmaz; yalnız `TokenHashService.hashToken()` için bellekte kullanılır.
- Rate-limit boundary raw token yerine `tokenHash`, normalized client IP ve requestId alır; Redis key içinde purpose-separated identifier hash kullanılır.
- Lookup yalnız `PasswordResetToken.tokenHash` ile yapılır; `EmailVerificationToken` kayıtları purpose separation gereği kabul edilmez.
- Token bulunamadı, expired, revoked, used, hash eşleşmedi, user missing, user disabled, user unverified veya concurrent consume yarışı durumları aynı 400 `INVALID_OR_EXPIRED_RESET_TOKEN` zarfına döner.
- Yeni parola hash'i transaction dışında üretilir. Password policy veya hash hatasında token consumed olmaz, session/refresh token revoke edilmez ve audit yazılmaz.
- Transaction içinde token-hash scoped PostgreSQL advisory lock alınır. Lock key `auth-password-reset-consume:<tokenHash>` biçimindedir; raw token içermez ve parameterized SQL ile kullanılır.
- Transaction içinde token taze okunur ve `usedAt IS NULL`, `revokedAt IS NULL`, `expiresAt > now`, user active ve `emailVerifiedAt != null` koşulları tekrar doğrulanır.
- Current reset token koşullu update ile `usedAt` alır ve `revokedAt` null kalır. Update count `1` değilse transaction rollback olur.
- Başarılı reset aynı user'a ait diğer unused/unrevoked reset tokenları revoke eder; used/revoked tokenlar ve başka user tokenları etkilenmez.
- Başarılı reset tüm aktif sessionları `PASSWORD_RESET` sebebiyle revoke eder ve bağlı active refresh tokenları revoke eder. Eski access tokenlar session-active kontrolünde reddedilir.
- Session cache invalidation commit sonrası best-effort yapılır; DB revoke source of truth olarak kalır.
- `AUTH_PASSWORD_RESET_COMPLETED` audit metadata allowlist'i yalnız `context: WEB`, `resetMethod: EMAIL_TOKEN` ve `sessionsRevoked: true` alanlarını içerir.
- Response ve audit metadata token, tokenHash, password, email, session id, refresh token id, revoke count, raw IP, user-agent, cookie veya authorization header içermez.

## Atomic refresh rotation

- Refresh token rotation DB transaction içinde yapılır.
- Eski token koşullu atomic update ile `usedAt` alır; `usedAt IS NULL` koşulu zorunludur.
- Aynı transaction içinde yeni child token oluşturulur.
- Transaction başarısızsa eski token used durumda kalmamalıdır.
- Aynı parent tokenın iki geçerli child üretmesine izin verilmez.
- Reuse detection token family ve session revoke ile sonuçlanır.
- Sprint 4C.3 uygulamasında `POST /auth/refresh` tokenı yalnız HttpOnly cookie'den okur; body, query ve header içinden refresh token kabul edilmez.
- Refresh response body yalnız yeni access tokenı içerir; yeni raw refresh token yalnız cookie overwrite işleminde kullanılır.
- Refresh işlemi `LoginAttempt` yazmaz; audit metadata allowlist `context`, `reason`, `sessionId` ile sınırlıdır.

Concurrent refresh için MVP kararı:

- Kısa yarış penceresinde ikinci parallel refresh isteği `AUTH_REFRESH_CONFLICT` ile reddedilir.
- Session otomatik revoke edilmez.
- Grace window küçük, sınırlı ve config üzerinden yönetilir.
- Grace window dışındaki tekrar kullanım gerçek replay kabul edilir ve session revoke edilir.
- Conflict durumunda cookie temizlenmez; replay/invalid durumlarında mevcut refresh cookie temizlenebilir.

## Current-session logout

- Sprint 4C.4 uygulamasında `POST /auth/logout` current session'ı yalnız HttpOnly refresh cookie üzerinden çözer.
- Refresh token body, query, authorization header veya özel header içinden kabul edilmez.
- Cookie yoksa veya token bulunamazsa endpoint idempotent 204 döner, cookie clear edilir ve token/session varlığı açıklanmaz.
- Eşleşen aktif session bulunduğunda `UserSession.revokedAt` set edilir, `revokeReason="user_logout"` olur ve aynı session'a bağlı aktif refresh tokenlar revoke edilir.
- Session revoke ve refresh token family revoke işlemi transaction sınırında tutulur; transaction başarısızsa yarım revoke başarı gibi raporlanmaz.
- Session cache revoke sonrasında invalidate edilir. Cache invalidation hatası DB revoke sonucunu gizlemez.
- Refresh cookie her normal logout çağrısında login/refresh sırasında kullanılan cookie attribute'larıyla uyumlu şekilde clear edilir.
- Logout `LoginAttempt` yazmaz.
- `AUTH_LOGOUT` audit metadata allowlist `context`, `reason`, `sessionId` ile sınırlıdır.
- Raw refresh token, cookie değeri, access token, authorization header, raw IP ve user-agent response, audit metadata veya loglara yazılmaz.
- Audit write hatası session revoke güvenlik sonucunu tersine çevirmez.

## Session management endpoints

- Sprint 4C.5 uygulamasında `POST /auth/logout-all`, `GET /auth/sessions` ve `DELETE /auth/sessions/:sessionId` access token guard arkasındadır.
- Guard `Authorization: Bearer` access tokenını doğrular, `sid` üzerinden session-active kontrolü yapar, DB session `userId` ile JWT `sub` değerini eşleştirir ve user aktif değilse 401 döner.
- Client tarafından gönderilen `userId`, `role` veya `sessionId` yetkilendirme sinyali olarak kabul edilmez.
- `POST /auth/logout-all` authenticated kullanıcının tüm aktif sessionlarını ve bağlı aktif refresh tokenlarını transaction sınırında revoke eder, cache kayıtlarını invalidate eder ve refresh cookie'yi clear eder.
- `GET /auth/sessions` yalnız authenticated kullanıcının aktif session özetlerini döner; raw IP, raw user-agent, `ipHash`, `userAgentHash`, `tokenFamilyId`, refresh token kayıtları ve `userId` response'a girmez.
- `DELETE /auth/sessions/:sessionId` ownership kontrolünü `id + userId` filtresiyle yapar. Başka kullanıcı sessionı veya olmayan session için 404 `AUTH_SESSION_NOT_FOUND` döner.
- Current session revoke bu sprintte desteklenir; current session silinirse refresh cookie clear edilir ve kalan access token sonraki istekte session-active kontrolünde 401 alır.
- Başka cihaz sessionı silindiğinde current refresh cookie temizlenmez.
- Owned ama zaten revoked hedef session için endpoint idempotent 204 dönebilir; başka kullanıcıya ait hedeflerde existence açıklanmaz.
- `AUTH_LOGOUT_ALL` audit metadata allowlist'i `sessionCount` ve `reason`; `AUTH_SESSION_REVOKED` allowlist'i `targetSessionId`, `isCurrent` ve `reason` alanlarıyla sınırlıdır.
- Raw token, cookie değeri, authorization header, raw IP, user-agent ve DB hata detayları response veya audit metadata içine yazılmaz.
- Audit write hatası session revoke güvenlik sonucunu tersine çevirmez.

## Rate limit ve brute-force koruması

Katmanlı yaklaşım:

- Normalize IP bazlı kısa pencere limiti.
- Email hash bazlı login ve reset limiti.
- User id bazlı authenticated endpoint limiti.
- Session bazlı refresh limiti.
- Global auth endpoint koruması.

Redis rate limit için ana store'dur. Sprint 4F.1 uygulaması fixed-window counter algoritmasını atomik Lua script ile çalıştırır; sayaç artışı ve TTL ataması aynı Redis komutunda yapılır.

Varsayılan public auth limitleri:

- Register: IP 10/saat, email 5/saat.
- Login: IP 30/15 dakika, account 10/15 dakika, IP/account 5/15 dakika.
- Refresh: IP 120/15 dakika, session 60/15 dakika.
- Forgot password: IP 10/saat, account 3/saat.
- Reset password: IP 20/saat, token 5/15 dakika.
- Resend verification: IP 10/saat, account 3/saat.
- Verify email: IP 30/saat, token 5/15 dakika.

Tüm limit ve pencere değerleri `AUTH_RATE_LIMIT_*` environment anahtarlarıyla değiştirilebilir ve config validation pozitif integer + üst sınır kontrolü uygular.

Redis key güvenliği:

- Key formatı `auth:rl:v1:<action>:<identifierHash>` olur.
- Identifier hash `TokenHashService` üzerinden purpose-separated input ile üretilir.
- Raw email, normalized email, raw IP, raw token, refresh cookie, password, full user-agent veya DB hata detayı Redis key, response veya loglara yazılmaz.
- 429 response yalnız `AUTH_RATE_LIMITED`, güvenli mesaj, `requestId` ve `Retry-After` header'ı içerir.

### Redis kesinti politikası

- Redis down olduğunda veya Redis sonucu beklenen `{count, ttl}` biçiminde değilse auth rate limiter fail-open davranır.
- Fail-open sırasında endpoint akışı devam eder; Redis exception veya internal detay response'a sızmaz.
- Safe internal log yalnız action ve genel sebep içerir; identifier, token, cookie, IP veya account bilgisi loglanmaz.
- Bu sprintte process-local fallback uygulanmamıştır. Çok instance production ortamında Redis availability ve alerting operasyonel gereksinimdir.

### Progressive delay

- Başarısız login denemeleri arttıkça yanıt gecikmesi kontrollü artırılır.
- Gecikme üst sınırı olmalıdır; worker ve API kaynaklarını tüketen aşırı beklemelerden kaçınılır.
- Aynı IP'den çok sayıda farklı e-postaya deneme yapılırsa IP seviyesi sıkılaşır.

### Hesap kilitleme riski

Kalıcı hesap kilitleme saldırgan tarafından kullanıcıyı sistem dışı bırakmak için kullanılabilir. Bu nedenle varsayılan tercih:

- Hesabı tamamen kilitlemek yerine progressive delay ve ek doğrulama.
- Şüpheli durumlarda e-posta bildirimi.
- Admin veya güvenlik operasyonu için manuel disable seçeneği.

## Enumeration koruması

- Login başarısızlığında e-posta bulunamadı ve şifre yanlış ayrımı yapılmaz.
- Forgot password ve resend verification her zaman genel accepted mesajı döner.
- Register her durumda 202 generic accepted döner; e-posta zaten kayıtlıysa API bunu açıklamaz.
- Register response body ve response timing olabildiğince benzer tutulur.
- Gerekirse mevcut kullanıcıya ayrı güvenli bilgilendirme e-postası gönderilir.
- Timing farkları azaltılmalıdır. Kullanıcı yoksa da kontrollü fake password verify veya eşdeğer zamanlama stratejisi uygulanabilir.
- Sprint 4C.2.2 itibarıyla missing-user yolu cached dummy Argon2id verify, wrong-password yolu gerçek Argon2id verify kullanır; iki yol aynı verify primitive'inden geçer.

## Session revocation

Session revoke şu durumlarda çalışır:

- Tek cihaz logout.
- Tüm cihazlardan logout.
- Password reset.
- Password change sonrası diğer cihazları kapatma.
- Account disable.
- Role change.
- Refresh reuse detection.
- Admin güvenlik müdahalesi.

Revoked session access tokenı JWT süresi dolmamış olsa bile session-active kontrolünde reddedilir.

## Security headers

Web ve admin için:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy`
- `Frame-Options` veya CSP `frame-ancestors`
- `Permissions-Policy`
- Production HTTPS için `Strict-Transport-Security`

API, JSON response ve CORS davranışını güvenli header setiyle desteklemelidir.

## Audit log

Audit kapsamına alınacak olaylar:

- Register requested.
- Login success/failure.
- Admin login success/failure.
- Refresh rotation ve reuse detected.
- Logout ve logout all.
- Session revoke.
- Password reset request ve complete.
- Password change.
- Email verification.
- Account disable.
- Role change.
- Forbidden admin access.

Audit log hassas değer içermez. `metadata` allowlist ile yazılır ve maksimum serialized boyut sınırı taşır. Parola, token, raw cookie, raw authorization header, raw IP, tam user-agent ve secret loglanmaz.

Uygulama DB rolünün mümkünse `AuditLog` için INSERT-only olması hedeflenir. Harici append-only/SIEM entegrasyonu ileri faz backlog olarak tutulur.

## Log güvenliği ve request ID

- Her request bir `requestId` ile izlenir.
- Hata response'u `requestId` döner.
- Health check ve auth hata logları secret içeren exception mesajlarını dışarı taşımaz.

## Admin yetkileri

- Admin rolü request body, query veya client state içinden kabul edilmez.
- Rol sadece DB'deki `User.role` ve imzalı server tokenındaki minimum claim ile değerlendirilir.
- Login `context=ADMIN` yalnız admin UI yüzeyini ve risk metadata'sını belirtir; kullanıcıya admin rolü kazandırmaz.
- USER rolündeki kullanıcı ADMIN context ile login olabilir, ancak admin endpointleri role guard nedeniyle 403 döner.
- Rate limit ve monitoring sistemi ADMIN context'i daha sıkı limit grubu veya risk sinyali olarak kullanabilir.
- Yetki gerektiren endpointler role guard ile korunur.
- `SUPER_ADMIN` işlemleri ayrıca audit log ve mümkünse ek onay gerektirir.
