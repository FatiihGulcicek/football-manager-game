# Authentication Design

Bu klasör, Sprint 4A kapsamında authentication sisteminin teknik tasarımını tutar.

Bu sprint yalnızca tasarım sprintidir. Auth modülü, endpoint, Prisma migration, paket kurulumu, UI veya gerçek secret değişikliği içermez.

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
- Access token kısa ömürlü JWT olacaktır.
- Refresh token opaque üretilecek ve veritabanında yalnızca hash değeri saklanacaktır.
- Her cihaz veya tarayıcı bağlamı ayrı `UserSession` kaydıyla temsil edilecektir.
- Admin ve oyuncu girişi aynı auth altyapısını kullanacak, fark role guard ile uygulanacaktır.

## Sınırlar

- Bu belgeler Prisma şemasını değiştirmez.
- Bu belgeler gerçek endpoint veya service kodu eklemez.
- Bu belgeler `.env` veya secret değeri üretmez.
- Bu belgeler oyun ekonomisi, maç motoru, kulüp veya para tablolarını değiştirmez.
