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

## Atomic refresh rotation

- Refresh token rotation DB transaction içinde yapılır.
- Eski token koşullu atomic update ile `usedAt` alır; `usedAt IS NULL` koşulu zorunludur.
- Aynı transaction içinde yeni child token oluşturulur.
- Transaction başarısızsa eski token used durumda kalmamalıdır.
- Aynı parent tokenın iki geçerli child üretmesine izin verilmez.
- Reuse detection token family ve session revoke ile sonuçlanır.

Concurrent refresh için MVP kararı:

- Kısa yarış penceresinde ikinci parallel refresh isteği `AUTH_REFRESH_CONFLICT` ile reddedilir.
- Session otomatik revoke edilmez.
- Grace window küçük, sınırlı ve config üzerinden yönetilir.
- Grace window dışındaki tekrar kullanım gerçek replay kabul edilir ve session revoke edilir.

## Rate limit ve brute-force koruması

Katmanlı yaklaşım:

- Normalize IP bazlı kısa pencere limiti.
- Email hash bazlı login ve reset limiti.
- User id bazlı authenticated endpoint limiti.
- Session bazlı refresh limiti.
- Global auth endpoint koruması.

Redis rate limit için ana store'dur.

### Redis kesinti politikası

- Redis down olduğunda process-local in-memory sliding-window fallback kullanılır.
- Fallback limitleri normal Redis limitlerinden daha muhafazakardır.
- Login, admin-login, refresh, reset-password ve change-password için daha sıkı fallback uygulanır.
- Register, forgot-password ve resend-verification için daha gevşek ama sınırlı fallback uygulanır.
- Tam fail-open yapılmaz.
- Tam fail-closed yapılmaz.
- Health status degraded olur.
- Internal log/metric ile fallback mode görünür olmalıdır.
- Çok instance ortamında process-local fallback sınırlı koruma sağlar; bu açıkça operasyon dokümanında belirtilmelidir.

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
- Sprint 4F rate limit ve monitoring sistemi ADMIN context'i daha sıkı limit grubu veya risk sinyali olarak kullanabilir.
- Yetki gerektiren endpointler role guard ile korunur.
- `SUPER_ADMIN` işlemleri ayrıca audit log ve mümkünse ek onay gerektirir.
