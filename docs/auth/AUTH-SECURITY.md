# Authentication Security

## Token taşıma kararı

| Seçenek | Artılar | Riskler | Karar |
| --- | --- | --- | --- |
| Access ve refresh token HttpOnly cookie | JavaScript token okuyamaz; XSS etkisi azalır | Access cookie otomatik gönderildiği için CSRF tasarımı daha kritik olur | Bu proje için ikincil seçenek. |
| Access token memory, refresh token HttpOnly cookie | Access token kısa ömürlüdür; refresh token JavaScript tarafından okunamaz; PWA için dengeli yaklaşım | XSS access tokenı bellekteyken kötüye kullanabilir; refresh endpoint için CSRF gerekir | Tercih edilen yaklaşım. |
| İki token localStorage | Uygulaması kolay | XSS halinde iki token da çalınabilir; uzun ömürlü refresh token kalıcı risk olur | Reddedildi. |

Nihai karar: access token kısa ömürlü olarak istemci belleğinde tutulur, refresh token `HttpOnly`, `Secure`, `SameSite` cookie ile taşınır.

### Gerekçe

- XSS: Refresh token JavaScript tarafından okunamaz. Access token çalınsa bile 15 dakika içinde biter ve refresh rotation/reuse detection ile uzun süreli ele geçirme zorlaşır.
- CSRF: Refresh cookie otomatik gideceği için `/auth/refresh`, `/auth/logout` ve benzeri cookie kullanan endpointlerde SameSite, Origin/Referer kontrolü ve gerekirse CSRF token gerekir.
- SameSite: Aynı site web ve admin deployment modeline göre `Lax` varsayılır. Farklı domain ihtiyacında `None; Secure` yalnız production HTTPS altında kullanılmalıdır.
- Secure cookie: Production ortamında zorunludur. Localhost development için environment ile kapatılabilir.
- HttpOnly: Refresh token için zorunludur.
- CORS: Sadece izinli web ve admin originleri credential gönderebilir. Wildcard origin ve credentials birlikte kullanılmaz.
- Cookie domain: Web, admin ve API domain topolojisi netleşene kadar dar kapsamlı cookie domain tercih edilir.
- Development: Localhost portları için açık allowlist kullanılmalı, production cookie policy gevşetilmemelidir.
- Production HTTPS: Auth cookie ve OAuth benzeri gelecekteki akışlar HTTPS dışında çalışmamalıdır.
- Mobil gelecek: Native mobil uygulamada refresh token platform secure storage içinde tutulabilir; server tarafındaki opaque refresh, rotation ve session modeli değişmeden kalır.

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

## Argon2id

- Parolalar Argon2id ile hashlenir.
- Üretim parametreleri kesin sabit olarak belgelenmez; hedef altyapıda benchmark edilmelidir.
- Benchmark hedefi, normal login deneyimini yavaşlatmadan offline brute-force maliyetini anlamlı artırmaktır.
- Memory cost, time cost ve parallelism değerleri deployment sınıfına göre config ile belirlenmelidir.
- Hash formatı algoritma ve parametre bilgisini içermeli, ileride rehash stratejisine izin vermelidir.
- Kullanıcı login olduğunda eski parametreli hash tespit edilirse başarılı doğrulama sonrası rehash yapılabilir.

## Token hashing ve karşılaştırma

- Refresh, email verification ve password reset tokenları veritabanında açık metin saklanmaz.
- Token hash için HMAC-SHA-256 benzeri pepper kullanan deterministik yaklaşım veya güçlü yavaş hash değerlendirilebilir. Opaque token yeterli entropy taşıdığı için HMAC pratik ve indekslenebilir seçenektir.
- Pepper secret olarak saklanır ve repository'ye eklenmez.
- Token karşılaştırmaları constant-time yapılmalıdır.
- Token değerleri log, audit metadata, hata mesajı veya monitoring event içine yazılmaz.

## Rate limit ve brute-force koruması

Katmanlı yaklaşım:

- IP bazlı kısa pencere limiti.
- Email hash bazlı login ve reset limiti.
- User id bazlı authenticated endpoint limiti.
- Session bazlı refresh limiti.
- Global auth endpoint koruması.

Redis, hızlı sayaçlar ve progressive delay için kullanılır. PostgreSQL `LoginAttempt` ve `AuditLog`, kalıcı inceleme ve abuse analizi için kullanılır.

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
- Register duplicate email davranışı ürün kararıyla netleştirilmelidir; default güvenli yaklaşım account existence sızdırmayan mesajdır.
- Timing farkları azaltılmalıdır. Kullanıcı yoksa da kontrollü fake password verify veya eşdeğer zamanlama stratejisi uygulanabilir.

## Refresh token reuse detection

Tek kullanımlık refresh token tekrar kullanılırsa session ele geçirilmiş kabul edilir:

- İlgili session revoke edilir.
- Aynı token ailesindeki tüm refresh tokenlar revoke edilir.
- Cookie temizlenir.
- Audit log yazılır.
- Kullanıcı tekrar login olur.

## Session revocation

Session revoke şu durumlarda çalışır:

- Tek cihaz logout.
- Tüm cihazlardan logout.
- Password reset.
- Password change sonrası diğer cihazları kapatma.
- Account disable.
- Refresh reuse detection.
- Admin güvenlik müdahalesi.

Revoked session access tokenı JWT süresi dolana kadar teorik olarak taşınabilir. Kritik endpointlerde `sid` üzerinden session active kontrolü yapılmalı veya access token TTL kısa tutulmalıdır.

## CSRF

Refresh token cookie ile taşındığı için cookie kullanan mutating endpointlerde CSRF düşünülmelidir:

- `SameSite=Lax` varsayılanı.
- Cross-site gerekiyorsa `SameSite=None; Secure` ve Origin/Referer allowlist.
- Refresh/logout gibi endpointlerde Origin kontrolü.
- Gerekirse double-submit veya server generated CSRF token.

## CORS

- Credential isteyen auth endpointleri yalnız izinli web/admin originlerine açılır.
- `Access-Control-Allow-Origin: *` ile credentials birlikte kullanılmaz.
- Development originleri açıkça listelenir.
- Production origin listesi environment ile yönetilir.

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
- Forbidden admin access.

Audit log hassas değer içermez. `metadata` sadece güvenli normalize alanları taşır.

## Secret rotation ve JWT key yönetimi

- JWT signing secret veya key repository'ye eklenmez.
- Production için simetrik secret yerine key id destekleyen asimetrik key yönetimi değerlendirilebilir.
- Key rotation planı olmalıdır: yeni tokenlar yeni key ile imzalanır, eski access tokenlar kısa TTL içinde doğal olarak biter.
- Refresh tokenlar JWT olmadığı için rotation DB kaydı ve cookie yenileme ile yönetilir.
- Secret değişimi sonrası kullanıcıları zorla logout etme prosedürü belgelenmelidir.

## Log güvenliği ve request ID

- Her request bir `requestId` ile izlenir.
- Hata response'u `requestId` döner.
- Parola, token, raw cookie, raw authorization header, raw IP, tam user-agent ve secret loglanmaz.
- Health check ve auth hata logları secret içeren exception mesajlarını dışarı taşımaz.

## Admin yetkileri

- Admin rolü request body, query veya client state içinden kabul edilmez.
- Rol sadece DB'deki `User.role` ve imzalı server tokenındaki minimum claim ile değerlendirilir.
- Yetki gerektiren endpointler role guard ile korunur.
- `SUPER_ADMIN` işlemleri ayrıca audit log ve mümkünse ek onay gerektirir.
