# Authentication Data Model

Bu belge, Sprint 4B ve sonrası için önerilen auth veri modellerini tanımlar. Bu sprintte Prisma şemasına model eklenmez ve migration oluşturulmaz.

## Mevcut temel

Sprint 3 itibarıyla `User`, `ManagerProfile` ve `Club` modelleri vardır. `User` içinde `email`, `passwordHash`, `role`, `isActive`, `emailVerifiedAt` ve `lastLoginAt` alanları auth tasarımının başlangıç noktasıdır.

## UserSession

Önerilen alanlar:

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Session kimliği, JWT `sid` ile eşleşir. |
| `userId` | String | `User` ilişkisi. |
| `tokenFamilyId` | String uuid | Refresh token ailesi ve reuse detection kapsamı. |
| `deviceName` | String nullable | Kullanıcıya gösterilecek sade cihaz adı. |
| `deviceType` | String nullable | Desktop, mobile, tablet, bot/unknown gibi normalize değer. |
| `browser` | String nullable | Chrome, Safari, Firefox gibi parse edilmiş değer. |
| `operatingSystem` | String nullable | Windows, iOS, Android gibi parse edilmiş değer. |
| `ipHash` | String | IP adresinin pepper ile hashlenmiş hali. |
| `countryCode` | String nullable | Yaklaşık ülke bilgisi. |
| `city` | String nullable | Yaklaşık şehir bilgisi; hassasiyet nedeniyle opsiyonel. |
| `userAgentHash` | String | Tam user-agent yerine hash. |
| `lastSeenAt` | DateTime | Refresh veya güvenli activity anında güncellenir. |
| `expiresAt` | DateTime | Refresh token ömrüyle uyumlu session expiry. |
| `revokedAt` | DateTime nullable | Session iptal zamanı. |
| `revokeReason` | String nullable | logout, logout_all, password_reset, reuse_detected, admin_disabled gibi değer. |
| `createdAt` | DateTime | Oluşturulma zamanı. |
| `updatedAt` | DateTime | Güncelleme zamanı. |

### IP ve user-agent kararı

- IP adresi açık metin saklanmamalıdır; pepper kullanılan tek yönlü hash saklanmalıdır.
- Kullanıcıya oturum ekranında tam IP yerine yaklaşık lokasyon, cihaz tipi, tarayıcı, işletim sistemi ve son görülme zamanı gösterilmelidir.
- Tam user-agent saklanmamalıdır. UI için parse edilmiş kısa değerler ve güvenlik eşleştirmesi için `userAgentHash` yeterlidir.
- IP hash pepper değeri secret olarak tutulmalı, repository'ye eklenmemelidir.

### Saklama süresi

- Aktif session kayıtları `expiresAt` veya `revokedAt` sonrasına kadar tutulur.
- Revoked ve expired session kayıtları güvenlik incelemesi için önerilen başlangıç değeri olarak 90 gün saklanır.
- Güvenlik olayı içeren sessionlar audit log retention politikasına göre daha uzun tutulabilir.

## RefreshToken

Önerilen alanlar:

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Refresh token kayıt kimliği. |
| `sessionId` | String | `UserSession` ilişkisi. |
| `tokenHash` | String unique | Opaque tokenın pepper/HMAC veya güçlü hash değeri. |
| `parentTokenId` | String nullable | Rotation zincirinde önceki token. |
| `expiresAt` | DateTime | Token son kullanım zamanı. |
| `usedAt` | DateTime nullable | Başarılı rotation sonrası set edilir. |
| `revokedAt` | DateTime nullable | Logout, password reset veya reuse sonrası set edilir. |
| `createdAt` | DateTime | Oluşturulma zamanı. |

### Rotation ve reuse detection

Refresh token tek kullanımlı kabul edilir. Başarılı refresh isteğinde mevcut token `usedAt` ile işaretlenir ve yeni child token oluşturulur. Aynı token tekrar gelirse bu replay kabul edilir. Replay halinde:

- İlgili `UserSession.revokedAt` set edilir.
- Aynı session altındaki tüm refresh tokenlar revoke edilir.
- Audit log'a `AUTH_REFRESH_REUSE_DETECTED` yazılır.
- Kullanıcıdan yeniden login istenir.

## EmailVerificationToken

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Token kayıt kimliği. |
| `userId` | String | `User` ilişkisi. |
| `tokenHash` | String unique | E-posta token hash değeri. |
| `expiresAt` | DateTime | Varsayılan 24 saat. |
| `usedAt` | DateTime nullable | Başarılı doğrulama zamanı. |
| `createdAt` | DateTime | Oluşturulma zamanı. |

Bir kullanıcı için aynı anda birden fazla token üretilebilir, ancak resend akışında eski kullanılmamış tokenlar revoke alanı yoksa uygulama seviyesinde geçersiz kabul edilmelidir. Sprint 4B'de `revokedAt` eklenmesi değerlendirilmelidir.

## PasswordResetToken

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Token kayıt kimliği. |
| `userId` | String | `User` ilişkisi. |
| `tokenHash` | String unique | Reset token hash değeri. |
| `expiresAt` | DateTime | Varsayılan 30 dakika. |
| `usedAt` | DateTime nullable | Başarılı kullanım zamanı. |
| `requestedIpHash` | String nullable | Talep eden IP'nin hash değeri. |
| `createdAt` | DateTime | Oluşturulma zamanı. |

Reset tamamlandığında aynı kullanıcıya ait aktif sessionlar revoke edilmelidir.

## LoginAttempt

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Deneme kayıt kimliği. |
| `emailHash` | String | Normalize e-postanın hash değeri. |
| `userId` | String nullable | Kullanıcı bulunursa ilişki. |
| `success` | Boolean | Deneme sonucu. |
| `failureReason` | String nullable | Internal reason; response'a bire bir yansımaz. |
| `ipHash` | String | IP hash değeri. |
| `userAgentHash` | String nullable | User-agent hash değeri. |
| `createdAt` | DateTime | Deneme zamanı. |

`LoginAttempt`, brute-force analizi için PostgreSQL'de kalıcı kayıt ve Redis'te hızlı sayaçlarla birlikte kullanılabilir.

## AuditLog

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Audit kayıt kimliği. |
| `actorUserId` | String nullable | İşlemi yapan kullanıcı. |
| `targetUserId` | String nullable | Etkilenen kullanıcı. |
| `action` | String | `AUTH_LOGIN_SUCCEEDED`, `AUTH_PASSWORD_RESET_COMPLETED` gibi olay. |
| `entityType` | String nullable | UserSession, RefreshToken, User gibi değer. |
| `entityId` | String nullable | İlgili entity id. |
| `metadata` | JSON nullable | Hassas veri içermeyen ek bilgi. |
| `ipHash` | String nullable | Kaynak IP hash. |
| `createdAt` | DateTime | Olay zamanı. |

Audit metadata içine access token, refresh token, parola, reset token, verification token, raw IP veya tam user-agent yazılmaz.

## İlişkiler

| İlişki | Davranış |
| --- | --- |
| `User 1-N UserSession` | Kullanıcının her cihazı ayrı session kaydıdır. |
| `UserSession 1-N RefreshToken` | Rotation zinciri session altında saklanır. |
| `User 1-N EmailVerificationToken` | E-posta doğrulama denemeleri kullanıcıya bağlıdır. |
| `User 1-N PasswordResetToken` | Reset tokenları kullanıcıya bağlıdır. |
| `User 1-N AuditLog` | Kullanıcı actor veya target olarak loglarda bulunabilir. |
| `User 1-N LoginAttempt` | Kullanıcı bulunursa ilişki kurulur; enumeration riskini azaltmak için e-posta hash ayrıca saklanır. |

## Silme davranışları

- MVP geliştirme verisinde mevcut `ManagerProfile` ve `Club` cascade davranışı korunur.
- Auth güvenlik logları için doğrudan cascade delete tercih edilmemelidir.
- Kullanıcı kapatma, `User.isActive=false` ve session revoke ile yapılmalıdır.
- Kalıcı hesap silme talebinde kişisel veriler anonimleştirilmeli veya ayrıştırılmalı; güvenlik logları mevzuat ve kötüye kullanım incelemesi için sınırlı süre saklanmalıdır.
- Audit log ve login attempt kayıtlarında raw kişisel veri tutulmadığı için KVKK/GDPR silme talepleriyle güvenlik saklama ihtiyacı daha dengeli yönetilir.

## Bu sprintte dokunulmayacak alanlar

Para, kulüp ekonomisi, maç motoru, transfer, sezon ve oyun tabloları bu auth tasarım sprintinin kapsamı dışındadır.
