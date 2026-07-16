# Authentication Test Plan

Bu plan Sprint 4B ve sonrası auth uygulaması için beklenen test kapsamını tanımlar.

## Unit testler

| Test | Beklenen sonuç |
| --- | --- |
| Şifre hashleme | Aynı parola için salt nedeniyle farklı hash üretir ve açık metin saklamaz. |
| Şifre doğrulama | Doğru parola true, yanlış parola false döner. |
| Token hashing | Aynı token aynı hash değerini üretir; raw token loglanmaz. |
| JWT payload | Payload yalnız `sub`, `role`, `sid`, `iat`, `exp` içerir. |
| Session oluşturma | Her login için yeni `UserSession` ve `tokenFamilyId` üretilir. |
| Refresh rotation | Kullanılmış refresh token `usedAt` alır ve child token oluşturulur. |
| Reuse detection | Kullanılmış token tekrar gelirse session revoke edilir. |
| Expired token | Süresi dolmuş token reddedilir. |
| Revoked session | Revoked session ile access/refresh kabul edilmez. |
| Disabled user | `isActive=false` kullanıcı login ve refresh yapamaz. |
| Role kontrolü | Client role inputu yok sayılır, DB/server role kullanılır. |

## Integration testler

| Test | Beklenen sonuç |
| --- | --- |
| Register | Geçerli e-posta ve parola ile kullanıcı ve verification token kaydı oluşur. |
| Duplicate email | Account existence gereksiz açıklanmaz; duplicate kayıt DB bütünlüğünü bozmaz. |
| Login success | Access token, refresh cookie, session ve login attempt success oluşur. |
| Login invalid credentials | 401 ve genel hata döner; user not found/password wrong ayrımı yapılmaz. |
| Refresh success | Yeni access token ve rotated refresh cookie döner. |
| Refresh replay attack | Eski refresh token tekrar kullanıldığında token ailesi revoke edilir. |
| Logout | Current session ve bağlı refresh tokenlar revoke edilir, cookie temizlenir. |
| Logout all devices | Kullanıcının tüm sessionları revoke edilir. |
| Email verification | Geçerli token `emailVerifiedAt` set eder ve tokenı kullanılmış işaretler. |
| Password reset | Yeni parola set edilir, reset token kullanılır, sessionlar revoke edilir. |
| Session listing | Kullanıcı yalnız kendi session özetlerini görür. |
| Session revocation | Kullanıcı kendi sessionını iptal eder; başka kullanıcının sessionı 404/403 sızdırmaz. |

## Security testler

| Test | Beklenen sonuç |
| --- | --- |
| SQL injection | DTO ve Prisma parametreleme ile injection etkisiz kalır. |
| NoSQL benzeri payload | Object/array gibi beklenmeyen payload validation ile reddedilir. |
| Oversized payload | Büyük body ve uzun parola/e-posta inputları güvenli 400/413 alır. |
| Brute-force | IP/emailHash/user limitleri ve progressive delay devreye girer. |
| Enumeration | Login, forgot password ve resend verification hesap varlığını açıklamaz. |
| Token tampering | JWT signature bozulduğunda 401 döner. |
| Expired token | Süresi dolmuş access/refresh token kabul edilmez. |
| Wrong signing key | Farklı key ile imzalı JWT kabul edilmez. |
| CSRF | Cookie kullanan endpointler yabancı Origin isteğini reddeder. |
| XSS taşıyan displayName veya deviceName | Değerler encode edilir, script çalışmaz, loglara raw zararlı içerik yazılmaz. |
| Yetki yükseltme | Request body ile `role=ADMIN` gönderilse bile rol değişmez. |
| Başka kullanıcının session kaydını silme | Kaynak bulunamadı veya forbidden güvenli yanıtı döner; session değişmez. |

## Manuel testler

| Test | Beklenen sonuç |
| --- | --- |
| Windows Chrome | Login, refresh, logout ve cookie davranışı beklenen şekilde çalışır. |
| Mobil Chrome | Access token memory ve refresh cookie akışı mobil tarayıcıda çalışır. |
| Safari/PWA yaklaşımı | SameSite, cookie ve PWA lifecycle davranışı doğrulanır. |
| Cookie davranışı | HttpOnly cookie JS ile okunamaz; logout sonrası expire edilir. |
| Çoklu cihaz | Her cihaz ayrı session olarak listelenir ve tek tek revoke edilir. |
| Saat farkı | UTC expiry ve istemci saat farkı kullanıcıyı gereksiz kırmaz; server expiry esas alınır. |
| Redis kapalı | Rate limit degraded davranışı güvenli olur; health degraded döner. |
| PostgreSQL kapalı | Auth endpointleri kontrollü hata döner; health degraded döner. |

## Kabul notları

- Auth testleri watch modunda çalışmaz; CI `vitest run` kullanır.
- Security testleri gerçek secret kullanmaz.
- Test fixture parolaları açıkça test değeri olarak kalır; production-like secret üretilmez.
