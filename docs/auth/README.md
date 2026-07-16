# Authentication Design

Bu klasör authentication sisteminin teknik tasarımını ve uygulama ilerleme notlarını tutar.

Sprint 4C.2 itibarıyla `POST /auth/register` ve `POST /auth/login` uygulanmıştır. Refresh, logout, session listeleme, e-posta doğrulama gönderimi ve UI sonraki alt sprintlerin kapsamındadır.

## Belge haritası

| Belge | Amaç |
| --- | --- |
| `AUTH-ARCHITECTURE.md` | Register, login, refresh, logout, email verification, password reset ve session akışlarını tanımlar. |
| `AUTH-DATA-MODEL.md` | Sprint 4B ve sonrası için önerilen auth veri modellerini tasarlar. |
| `AUTH-API-CONTRACTS.md` | Auth endpoint sözleşmelerini, DTO şekillerini, hata kodlarını ve idempotency davranışını tanımlar. |
| `AUTH-SECURITY.md` | Token taşıma, parola güvenliği, rate limit, CSRF, audit log ve secret yönetimi kararlarını açıklar. |
| `AUTH-TEST-PLAN.md` | Unit, integration, security ve manuel test beklentilerini listeler. |
| `AUTH-IMPLEMENTATION-PLAN.md` | Auth geliştirmesini Sprint 4B-4G alt sprintlerine böler. |

## Mimari yön

- Authentication server authoritative olacaktır.
- İstemci tarafından gönderilen role veya yetki bilgisi kabul edilmeyecektir.
- PostgreSQL kalıcı auth verisinin ana kaynağıdır.
- Redis rate limit, progressive delay ve kısa ömürlü güvenlik sayaçları için kullanılacaktır.
- Access token kısa ömürlü ES256 JWT olacaktır; `kid`, `iss` ve `aud` doğrulanacaktır.
- Refresh token opaque üretilecek ve veritabanında yalnızca hash değeri saklanacaktır.
- Her cihaz veya tarayıcı bağlamı ayrı `UserSession` kaydıyla temsil edilecektir.
- Her authenticated request `sid` üzerinden session-active kontrolünden geçecektir.
- Production refresh cookie `__Host-refresh_token` adıyla host-only, `Path=/`, `Secure`, `HttpOnly`, `SameSite=Lax` olarak taşınacaktır.
- Register akışı hesap varlığını açıklamayan 202 generic response döndürecektir.
- Login akışı credential failure nedenlerini dışarıya açıklamayan `AUTH_INVALID_CREDENTIALS` response döndürecektir.
- Redis kesintisinde bounded in-memory fallback limiter kullanılacak, health degraded olacaktır.
- Admin ve oyuncu girişi aynı auth altyapısını kullanacak, fark role guard ile uygulanacaktır.

## Sınırlar

- Bu belgeler `.env` veya secret değeri üretmez.
- Bu belgeler oyun ekonomisi, maç motoru, kulüp veya para tablolarını değiştirmez.

## Register manuel test örneği

API local ortamda çalışırken PowerShell ile:

```powershell
$baseUrl = "http://localhost:4000"
$payload = @{
  email = "manual-register@example.invalid"
  password = "TestOnlyPass123"
  displayName = "Manual Manager"
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/register" -ContentType "application/json" -Body $payload
Invoke-RestMethod -Method Post -Uri "$baseUrl/auth/register" -ContentType "application/json" -Body $payload

$invalidEmail = @{
  email = "not-an-email"
  password = "TestOnlyPass123"
  displayName = "Manual Manager"
} | ConvertTo-Json

Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/register" -ContentType "application/json" -Body $invalidEmail
```

İlk iki isteğin aynı generic 202 response döndürmesi, geçersiz e-postanın 400 dönmesi beklenir.

## Login manuel test örneği

Email verification endpointi henüz olmadığı için local manuel login testinde test kullanıcısının `emailVerifiedAt` alanı kontrollü development DB güncellemesiyle ayarlanmalıdır.

```powershell
$baseUrl = "http://localhost:4000"
$payload = @{
  email = "manual-register@example.invalid"
  password = "TestOnlyPass123"
  context = "WEB"
} | ConvertTo-Json

$response = Invoke-WebRequest -Method Post -Uri "$baseUrl/auth/login" -ContentType "application/json" -Body $payload
$response.Content
$response.Headers["Set-Cookie"]
```

Başarılı login response body içinde access token, header içinde HttpOnly refresh cookie döndürür.
