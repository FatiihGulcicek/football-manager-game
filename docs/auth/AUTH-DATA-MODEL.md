# Authentication Data Model

Bu belge, Sprint 4B ve sonrası için önerilen auth veri modellerini tanımlar. Bu sprintte Prisma şemasına model eklenmez ve migration oluşturulmaz.

## Mevcut temel

Sprint 3 itibarıyla `User`, `ManagerProfile` ve `Club` modelleri vardır. `User` içinde `email`, `passwordHash`, `role`, `isActive`, `emailVerifiedAt` ve `lastLoginAt` alanları auth tasarımının başlangıç noktasıdır.

## Normalize client IP

`ipHash` üreten tüm modeller aynı normalize client IP kaynağını kullanır.

- Trusted proxy/CDN/load balancer listesi config ile tanımlanır.
- Güvenilmeyen bağlantılarda socket IP esas alınır.
- İstemciden gelen `X-Forwarded-For` doğrudan güvenilir kabul edilmez.
- Rate limit, audit log ve login attempt kayıtları aynı IP normalization pipeline'ından geçer.

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
| `ipHash` | String | Normalize client IP'nin pepper ile hashlenmiş hali. |
| `countryCode` | String nullable | Yaklaşık ülke bilgisi. |
| `city` | String nullable | Yaklaşık şehir bilgisi; hassasiyet nedeniyle opsiyonel. |
| `userAgentHash` | String | Tam user-agent yerine hash. |
| `lastSeenAt` | DateTime | Refresh veya güvenli activity anında güncellenir. |
| `expiresAt` | DateTime | Refresh token ömrüyle uyumlu session expiry. |
| `revokedAt` | DateTime nullable | Session iptal zamanı. |
| `revokeReason` | String nullable | logout, logout_all, password_reset, reuse_detected, admin_disabled, role_changed gibi değer. |
| `createdAt` | DateTime | Oluşturulma zamanı. |
| `updatedAt` | DateTime | Güncelleme zamanı. |

Önerilen indexler:

- `userId`
- `expiresAt`
- `revokedAt`

## IP ve user-agent kararı

- IP adresi açık metin saklanmamalıdır; pepper kullanılan tek yönlü hash saklanmalıdır.
- Kullanıcıya oturum ekranında tam IP yerine yaklaşık lokasyon, cihaz tipi, tarayıcı, işletim sistemi ve son görülme zamanı gösterilmelidir.
- Tam user-agent saklanmamalıdır. UI için parse edilmiş kısa değerler ve güvenlik eşleştirmesi için `userAgentHash` yeterlidir.
- IP hash pepper değeri secret olarak tutulmalı, repository'ye eklenmemelidir.

## RefreshToken

Önerilen alanlar:

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Refresh token kayıt kimliği. |
| `sessionId` | String | `UserSession` ilişkisi. |
| `tokenHash` | String unique | Opaque tokenın HMAC/pepper hash değeri. |
| `parentTokenId` | String nullable | Rotation zincirinde önceki token. |
| `expiresAt` | DateTime | Token son kullanım zamanı. |
| `usedAt` | DateTime nullable | Başarılı rotation sonrası set edilir. |
| `revokedAt` | DateTime nullable | Logout, password reset, role change veya reuse sonrası set edilir. |
| `createdAt` | DateTime | Oluşturulma zamanı. |

Önerilen indexler:

- `sessionId`
- `expiresAt`
- `tokenHash` unique

## Rotation ve reuse detection

Refresh token tek kullanımlı kabul edilir. Başarılı refresh isteğinde mevcut token DB transaction içinde koşullu atomic update ile `usedAt` alır ve aynı transaction içinde yeni child token oluşturulur.

Zorunlu transaction koşulları:

- Eski token update koşulu `usedAt IS NULL` içermelidir.
- `revokedAt IS NULL` ve `expiresAt > now()` koşulları kontrol edilmelidir.
- Aynı parent tokenın iki geçerli child üretmesine izin verilmemelidir.
- Transaction başarısızsa eski token used durumda kalmamalıdır.

Replay halinde:

- İlgili `UserSession.revokedAt` set edilir.
- Aynı session altındaki tüm refresh tokenlar revoke edilir.
- Audit log'a `AUTH_REFRESH_REUSE_DETECTED` yazılır.
- Kullanıcıdan yeniden login istenir.

MVP concurrent refresh policy: kısa grace window içinde ikinci parallel istek `AUTH_REFRESH_CONFLICT` ile reddedilir ve session revoke edilmez. Grace window dışındaki tekrar kullanım gerçek replay kabul edilir.

## EmailVerificationToken

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Token kayıt kimliği. |
| `userId` | String | `User` ilişkisi. |
| `tokenHash` | String unique | E-posta token hash değeri. |
| `expiresAt` | DateTime | Varsayılan 24 saat. |
| `usedAt` | DateTime nullable | Başarılı doğrulama zamanı. |
| `revokedAt` | DateTime nullable | Yeni token üretimi veya güvenlik iptali zamanı. |
| `createdAt` | DateTime | Oluşturulma zamanı. |

Yeni doğrulama tokenı üretildiğinde aynı kullanıcıya ait önceki kullanılmamış tokenlar revoke edilir.

Önerilen indexler:

- `userId`
- `expiresAt`
- `tokenHash` unique

## PasswordResetToken

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Token kayıt kimliği. |
| `userId` | String | `User` ilişkisi. |
| `tokenHash` | String unique | Reset token hash değeri. |
| `expiresAt` | DateTime | Varsayılan 30 dakika. |
| `usedAt` | DateTime nullable | Başarılı kullanım zamanı. |
| `revokedAt` | DateTime nullable | Yeni token üretimi veya güvenlik iptali zamanı. |
| `requestedIpHash` | String nullable | Talep eden normalize IP'nin hash değeri. |
| `createdAt` | DateTime | Oluşturulma zamanı. |

Yeni reset tokenı üretildiğinde aynı kullanıcıya ait önceki kullanılmamış tokenlar revoke edilir. Reset tamamlandığında aynı kullanıcıya ait aktif sessionlar revoke edilmelidir.

Önerilen indexler:

- `userId`
- `expiresAt`
- `tokenHash` unique

## LoginAttempt

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Deneme kayıt kimliği. |
| `emailHash` | String | Normalize e-postanın hash değeri. |
| `userId` | String nullable | Kullanıcı bulunursa ilişki. |
| `context` | String enum | `WEB`, `ADMIN`; ileride `MOBILE` eklenebilir. |
| `success` | Boolean | Deneme sonucu. |
| `failureReason` | String nullable | Internal reason; response'a bire bir yansımaz. |
| `ipHash` | String | Normalize IP hash değeri. |
| `userAgentHash` | String nullable | User-agent hash değeri. |
| `createdAt` | DateTime | Deneme zamanı. |

`LoginAttempt`, brute-force analizi için PostgreSQL'de kalıcı kayıt ve Redis'te hızlı sayaçlarla birlikte kullanılabilir.

Önerilen indexler:

- `emailHash + createdAt`
- `ipHash + createdAt`
- `userId + createdAt`

## AuditLog

| Alan | Tip önerisi | Açıklama |
| --- | --- | --- |
| `id` | String uuid | Audit kayıt kimliği. |
| `actorUserId` | String nullable | İşlemi yapan kullanıcı. |
| `targetUserId` | String nullable | Etkilenen kullanıcı. |
| `action` | String | `AUTH_LOGIN_SUCCEEDED`, `AUTH_ROLE_CHANGED` gibi olay. |
| `entityType` | String nullable | UserSession, RefreshToken, User gibi değer. |
| `entityId` | String nullable | İlgili entity id. |
| `metadata` | JSON nullable | Allowlist ile sınırlı ve hassas veri içermeyen ek bilgi. |
| `ipHash` | String nullable | Normalize kaynak IP hash. |
| `createdAt` | DateTime | Olay zamanı. |

Audit metadata hardening:

- Metadata allowlist ile yazılır.
- Maksimum serialized metadata boyutu belirlenir.
- Parola, token, raw cookie, raw IP, full authorization header, raw user-agent ve secret loglanmaz.
- `AUTH_ROLE_CHANGED` event'i actor/target ayrımıyla yazılır.
- Uygulama DB rolünün mümkünse `AuditLog` için INSERT-only olması hedeflenir.
- Harici append-only/SIEM entegrasyonu ileri faz backlog olarak tutulur.

Önerilen indexler:

- `actorUserId`
- `targetUserId`
- `action`
- `createdAt`

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

Model bazlı başlangıç kararları:

| Model | onDelete kararı | Gerekçe |
| --- | --- | --- |
| `UserSession.userId` | Cascade | Session operasyonel kullanıcı oturumu verisidir. |
| `RefreshToken.sessionId` | Cascade | Refresh token session altında anlamlıdır. |
| `EmailVerificationToken.userId` | Cascade | Verification token kullanıcı hesabına bağlı geçici auth kaydıdır. |
| `PasswordResetToken.userId` | Cascade | Reset token kullanıcı hesabına bağlı geçici auth kaydıdır. |
| `LoginAttempt.userId` | SetNull | Güvenlik analizi retention süresince korunur, kullanıcı kimliği ayrıştırılır. |
| `AuditLog.actorUserId` | SetNull | Actor silinse bile audit olayı korunur. |
| `AuditLog.targetUserId` | SetNull | Target silinse bile güvenlik olayı korunur. |

DEC-012 ile çelişki yoktur. DEC-012 yalnız operasyonel kullanıcıya bağlı `ManagerProfile` ve `Club` gibi kayıtlar için cascade yaklaşımını kapsar. Güvenlik ve audit kayıtları SetNull ile kimliksizleştirilerek retention süresince korunabilir.

Kullanıcı kapatma, `User.isActive=false` ve session revoke ile yapılmalıdır. Kalıcı hesap silme talebinde kişisel veriler anonimleştirilmeli veya ayrıştırılmalı; güvenlik logları mevzuat ve kötüye kullanım incelemesi için sınırlı süre saklanmalıdır.

## Retention

Başlangıç retention kararları:

| Kayıt | Süre |
| --- | --- |
| `LoginAttempt` | 180 gün |
| `AuditLog` | 2 yıl |
| Revoked/expired `UserSession` | 90 gün |
| Expired auth token records | Cleanup sonrasında 30 gün veya daha kısa |

Retention süreleri KVKK/GDPR ve operasyonel gereksinimlere göre config/policy ile değiştirilebilir. Cleanup job daha sonraki sprintte uygulanacaktır.

## Index notu

Yukarıdaki indexler başlangıç önerisidir. Her alanı indekslemek yazma maliyetini artırır; sadece sorgu, cleanup, rate-limit analizi ve audit incelemesi için gerekli indexler eklenmelidir.

## Bu sprintte dokunulmayacak alanlar

Para, kulüp ekonomisi, maç motoru, transfer, sezon ve oyun tabloları bu auth tasarım sprintinin kapsamı dışındadır.
