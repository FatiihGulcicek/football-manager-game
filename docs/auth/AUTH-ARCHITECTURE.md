# Authentication Architecture

## Temel yaklaşım

Authentication katmanı, mevcut server authoritative prensibinin kimlik tarafındaki karşılığıdır. İstemci yalnızca niyet ve credential gönderir; kullanıcı kimliği, rol, session durumu, token üretimi ve yetki kararları API tarafından belirlenir.

## Token ve süre kararları

| Değer | Varsayılan öneri | Not |
| --- | --- | --- |
| Access token | 15 dakika | JWT, minimum payload, environment üzerinden değiştirilebilir. |
| Refresh token | 30 gün | Opaque random token, veritabanında açık metin saklanmaz. |
| E-posta doğrulama tokenı | 24 saat | Opaque token, hash saklanır. |
| Şifre sıfırlama tokenı | 30 dakika | Opaque token, hash saklanır. |

JWT payload minimum tutulur:

```json
{
  "sub": "userId",
  "role": "USER",
  "sid": "sessionId",
  "iat": 1720000000,
  "exp": 1720000900
}
```

JWT içine e-posta, kullanıcı adı, display name, IP, user-agent veya hassas oyun verisi eklenmez.

## Session ve refresh token ailesi

Her login başarılı olduğunda ayrı `UserSession` oluşturulur. Bu session, cihaz veya tarayıcı bağlamını temsil eder. Session içinde `tokenFamilyId` bulunur. Aynı session altında üretilen refresh tokenlar parent-child zinciri kurar.

Refresh isteği başarılı olduğunda mevcut refresh token `usedAt` ile işaretlenir, yeni opaque refresh token üretilir ve yalnızca hash değeri saklanır. Daha önce kullanılmış, revoke edilmiş veya farklı session ailesine ait token tekrar gelirse reuse detection tetiklenir; ilgili session ve aynı token ailesindeki refresh tokenlar iptal edilir.

## Akışlar

| # | Akış | Girdi | Kontroller | Veritabanı işlemleri | Token veya session | Başarılı yanıt | Güvenli hata yanıtı | Audit log olayı | Rate limit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Kullanıcı kaydı | `email`, `password`, opsiyonel `displayName`, locale/timezone | DTO, e-posta normalize, parola politikası, duplicate e-posta, IP limit | `User` oluşturulur; gerekirse `ManagerProfile` sonraki onboarding'e bırakılır; `EmailVerificationToken` hash kaydı açılır | Login tokenı verilmez veya verified-policy'ye göre sınırlı session verilir; MVP önerisi: login için e-posta doğrulama beklenir | 201 ve güvenli kayıt mesajı | Duplicate durumda enumeration azaltan genel mesaj; validation hatası alan bazlı ama account existence sızdırmaz | `AUTH_REGISTER_REQUESTED`, `EMAIL_VERIFICATION_CREATED` | IP + emailHash bazlı düşük limit; burst ve günlük limit |
| 2 | E-posta doğrulama | Opaque token | Token hash eşleşmesi, expiry, `usedAt`, kullanıcı aktif mi | Token `usedAt` set edilir, `User.emailVerifiedAt` set edilir | Token üretilmez; kullanıcı login akışına yönlendirilir | 200 verified | Geçersiz veya süresi dolmuş token için aynı genel mesaj | `AUTH_EMAIL_VERIFIED`, başarısız denemede `AUTH_EMAIL_VERIFY_FAILED` | Token hash + IP bazlı |
| 3 | Kullanıcı girişi | `email`, `password`, cihaz bilgisi | DTO, kullanıcı aktif, e-posta doğrulama politikası, Argon2id verify, brute-force sayaçları | `LoginAttempt`, `User.lastLoginAt`, `UserSession`, ilk `RefreshToken` | 15 dk access JWT, 30 gün refresh cookie, yeni session | 200 user özeti ve access token | `AUTH_INVALID_CREDENTIALS`; e-posta yok/şifre yanlış ayrılmaz | `AUTH_LOGIN_SUCCEEDED` veya `AUTH_LOGIN_FAILED` | IP, emailHash, userId ve global auth limit |
| 4 | Access token üretimi | Geçerli kullanıcı ve session | User active, session active, role DB kaynağından okunur | DB yazımı yok; gerekirse session `lastSeenAt` seyrek güncellenir | JWT `sub`, `role`, `sid`, `iat`, `exp` | Access token response body içinde veya refresh sonrası döner | Session revoked/disabled için 401 | `AUTH_ACCESS_ISSUED` opsiyonel, yüksek hacimde audit yerine metric olabilir | Refresh/login limitine bağlı |
| 5 | Refresh token üretimi | Secure random token iç değeri | Yeterli entropy, token family ve session active | `RefreshToken.tokenHash` saklanır | Opaque refresh token yalnızca HttpOnly cookie ile istemciye gider | Cookie set edilir | Üretim hatasında 500, token loglanmaz | `AUTH_REFRESH_ISSUED` | Login/refresh akış limitleri |
| 6 | Refresh token rotation | Refresh cookie | Hash eşleşmesi, `usedAt` null, `revokedAt` null, expiry, session active, user active | Eski token `usedAt`; yeni child `RefreshToken`; session `lastSeenAt` | Yeni access JWT ve yeni refresh cookie | 200 access token | Geçersiz/replay için 401; reuse durumunda session revoke edilir | `AUTH_REFRESH_ROTATED`, reuse durumunda `AUTH_REFRESH_REUSE_DETECTED` | Session + IP bazlı, kısa pencere |
| 7 | Tek cihazdan çıkış | Refresh cookie veya active session | Session kullanıcının mı, zaten revoked mı | Current session `revokedAt`; bağlı refresh tokenlar `revokedAt` | Cookie temizlenir; access token doğal süresinde biter | 204 | Zaten çıkış yapılmışsa idempotent 204 | `AUTH_LOGOUT` | Kullanıcı + IP düşük limit |
| 8 | Tüm cihazlardan çıkış | Authenticated access token | User active | Kullanıcının tüm active session kayıtları revoke edilir; tüm refresh tokenlar revoke edilir | Tüm refresh cookie aileleri geçersiz; mevcut access token kısa süre sonra biter | 204 | 401 invalid access; disabled user 403/401 policy'ye göre | `AUTH_LOGOUT_ALL` | User bazlı |
| 9 | Şifre sıfırlama talebi | `email` | DTO, email normalize, IP/emailHash limit | Kullanıcı varsa `PasswordResetToken` hash kaydı; yoksa sadece güvenli yanıt | Token e-posta ile gönderilmek üzere üretilir, response'a konmaz | 202 genel mesaj | Account existence sızdırmayan aynı mesaj | `AUTH_PASSWORD_RESET_REQUESTED` | IP + emailHash + günlük limit |
| 10 | Şifre sıfırlama | Opaque token, yeni parola | Token hash, expiry, `usedAt`, parola policy, kullanıcı aktif | Parola hash güncellenir, token `usedAt`, kullanıcının tüm sessionları revoke edilir | Yeni login zorunlu; refresh cookie temizlenir | 200 | Geçersiz/süresi dolmuş token için genel mesaj | `AUTH_PASSWORD_RESET_COMPLETED` veya failed | Token + IP bazlı |
| 11 | Şifre değiştirme | Mevcut parola, yeni parola | Authenticated user, current password verify, yeni parola policy | `User.passwordHash` güncellenir; mevcut session dışındaki sessionlar revoke edilir | Current session için yeni refresh token ailesi başlatılabilir | 200 | Mevcut parola hatası için genel auth mesajı | `AUTH_PASSWORD_CHANGED` | User + IP bazlı |
| 12 | Aktif oturumları listeleme | Access token | User active, session active | Read-only `UserSession` sorgusu | Token üretilmez | 200 session listesi | 401/403 | `AUTH_SESSIONS_LISTED` opsiyonel | User bazlı |
| 13 | Belirli oturumu iptal etme | `sessionId` | Session kullanıcının mı; current session mı; active mi | Target session ve refresh tokenlar revoke edilir | Target refresh token ailesi geçersiz | 204 | Başka kullanıcı session için 404 veya 403 sızdırma riskiyle 404 tercih edilir | `AUTH_SESSION_REVOKED` | User bazlı |
| 14 | Hesap devre dışı bırakma | Admin veya güvenlik işlemi | Role guard, hedef kullanıcı, self-disable kuralı | `User.isActive=false`; tüm session ve refresh tokenlar revoke edilir | Tüm tokenlar etkisiz | 200 veya 204 | Yetkisiz 403; hedef yok 404 | `AUTH_ACCOUNT_DISABLED` | Admin/user action limit |
| 15 | Admin kullanıcı girişi | `email`, `password`, admin app context | Normal login kontrolleri + role `ADMIN` veya `SUPER_ADMIN` | Normal `LoginAttempt`, `UserSession`, `RefreshToken` | Aynı token altyapısı; admin UI role guard ile açılır | 200 | Normal login ile aynı `AUTH_INVALID_CREDENTIALS`; role yetersizse 403 | `AUTH_ADMIN_LOGIN_SUCCEEDED` veya failed | Daha sıkı IP + user limit, progressive delay |
| 16 | Yetkisiz ve yasaklı kullanıcı davranışı | Eksik/geçersiz token veya yetersiz rol | Access JWT signature/exp, session active, role guard | Başarısız access denemeleri audit/metric olabilir | Token üretilmez | 401 unauthenticated veya 403 forbidden | Hata mesajı kaynak detayını açıklamaz | `AUTH_UNAUTHORIZED`, `AUTH_FORBIDDEN` | Endpoint riskine göre IP + user |

## Yetkisiz ve yasaklı ayrımı

- 401, kimlik doğrulama eksik veya geçersiz olduğunda kullanılır.
- 403, kimliği doğrulanmış kullanıcının role veya durum nedeniyle kaynağa erişemediği durumda kullanılır.
- Disabled user için varsayılan davranış güvenli kalmak adına 401 benzeri genel auth hatası olabilir; admin panelinde audit log ayrıntısı tutulur.

## Environment üzerinden değiştirilecek ayarlar

Süreler ve güvenlik ayarları kod içine gömülmez. Sprint 4B'de config validation ile en az şu ayarlar tasarlanmalıdır:

- `AUTH_ACCESS_TOKEN_TTL_SECONDS`
- `AUTH_REFRESH_TOKEN_TTL_DAYS`
- `AUTH_EMAIL_VERIFICATION_TTL_HOURS`
- `AUTH_PASSWORD_RESET_TTL_MINUTES`
- `AUTH_REFRESH_COOKIE_NAME`
- `AUTH_COOKIE_DOMAIN`
- `AUTH_COOKIE_SECURE`
- `AUTH_COOKIE_SAMESITE`
