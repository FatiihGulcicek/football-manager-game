# Club Domain

Sprint 5A, kulup domaininin backend temelini kurar. Bu belge mevcut kodun davranisini, veri modelini ve API sozlesmelerini tanimlar. Lig fiksturu, mac motoru, oyuncular, transferler, detayli finans hareketleri, sponsorlar, maas bordrosu, scouting, academy, UI ve club creation wizard bu sprintin disindadir.

## Model

`Club` mevcut model uzerinden genisletildi; paralel veya ikinci bir kulup modeli olusturulmadi. Eski fiziksel `"ownerId"` kolonu migration uyumlulugu icin korunur, Prisma tarafinda `currentManagerProfileId @map("ownerId")` olarak okunur.

Ana alanlar:

- Public kimlik: `slug`, `name`, `shortName`, `threeLetterCode`, `primaryColor`, `secondaryColor`, `logoAssetKey`.
- Konum ve profil: `countryCode`, `city`, `reputation`, `fanBase`, `foundedYear`, `status`.
- Manager baglantisi: `currentManagerProfileId`, `managerAssignedAt`, `currentManagerProfile`.
- Finans ozeti: `balance`, `transferBudget`, `wageBudget`, `currencyCode`.
- Tesis ve stadyum: `stadiumName`, `stadiumCapacity`, `trainingFacilityLevel`, `youthFacilityLevel`.
- Rekabet baglantilari: `currentLeagueId`, `divisionLevel`, `boardExpectation`.

Status enum:

- `ACTIVE`: Public endpointlerde gorunur.
- `INACTIVE`: Public endpointlerde gizlenir; atanmis mevcut manager kendi kulubunu gorebilir ve presentation ayarlarini guncelleyebilir.
- `ARCHIVED`: Public endpointlerde ve manager own-club akiminda gizlenir.

Board expectation enum:

- `AVOID_RELEGATION`
- `STABLE_SEASON`
- `TOP_HALF`
- `TITLE_CHALLENGE`
- `PROMOTION_PUSH`
- `DEVELOP_PLAYERS`

## Manager Iliskisi

- Bir manager en fazla bir current club yonetebilir. Bu invariant, `"ownerId"` fiziksel kolonu uzerindeki mevcut unique index ile korunur.
- Bir club en fazla bir current manager tasir.
- Managerless AI/NPC club desteklenir; `currentManagerProfileId` nullable'dir.
- User veya ManagerProfile silinmesi Club kaydini silmez; relation `ON DELETE SET NULL` ile managerless hale gelir.
- Assignment history, club secme/atama endpointi ve club creation wizard bu sprintte yoktur.

## Slug, Kod ve Renk Kurallari

- `slug` lowercase URL-safe formatta tutulur ve manager tarafindan guncellenemez.
- `threeLetterCode` legacy veri guvenligi icin nullable unique tasarlanmistir; yeni verilerde tam 3 buyuk harf hedeflenir.
- `shortName` 2-30 karakterdir.
- `name` 2-100 karakterdir.
- Renkler canonical 6 haneli HEX formatindadir ve API uppercase normalize eder.
- Logo upload yoktur. `logoAssetKey` guvenli asset referansi icin ayrilmistir; backend arbitrary external URL fetch etmez.

## Para ve Sayisal Sinirlar

- Para alanlari JavaScript float olarak tasinmaz.
- `balance`, `transferBudget` ve `wageBudget` Prisma Decimal ile `DECIMAL(14,2)` saklanir.
- API response para alanlarini string olarak dondurur.
- `balance` negatif olabilir.
- `transferBudget` ve `wageBudget` non-negative check constraint altindadir.
- `currencyCode` ISO benzeri 3 harf uppercase koddur; MVP varsayilani `EUR`.
- `reputation` araligi 0-10000.
- `trainingFacilityLevel` ve `youthFacilityLevel` araligi 1-20.
- Facilities manager update payload'i ile degistirilemez.

## Index ve Constraint Ozeti

- Unique: `slug`, `threeLetterCode`, `currentManagerProfileId` fiziksel `"ownerId"`.
- Index: `(status, name, id)` public stable listing icin.
- Index: `(countryCode, status)` country filter icin.
- Check constraintler: slug, code, renk, country/currency code, reputation, fanBase, budget, stadium capacity, facility level, foundedYear ve divisionLevel.

## API Sozlesmeleri

### GET /clubs/me

- Auth: Access token ve active session gerekir.
- Kaynak: `CurrentUser.userId -> ManagerProfile -> Club`.
- Client tarafindan `clubId` kabul edilmez.
- ACTIVE ve INACTIVE assigned club doner; ARCHIVED assigned club `CLUB_NOT_ASSIGNED` olarak ele alinir.
- Private response finans ozeti, facility level, currentLeagueId ve manager relation bilgisini icerir.
- Para alanlari string olarak doner.
- Hata: 401 `AUTH_UNAUTHORIZED`, 404 `CLUB_NOT_ASSIGNED`.

### GET /clubs/:slug

- Auth: Public.
- Yalniz ACTIVE club doner.
- Private finans alanlari, `currentManagerProfileId`, user id, audit ve hidden flag donmez.
- Hata: 404 `CLUB_NOT_FOUND`.

### GET /clubs

- Auth: Public.
- Yalniz ACTIVE club listeler.
- Query: `search`, `countryCode`, `page`, `pageSize`.
- Varsayilan: `page=1`, `pageSize=20`, maksimum `pageSize=100`.
- Sort: `name ASC`, `id ASC`.
- Response: `{ items, pagination: { page, pageSize, totalItems, totalPages } }`.
- Invalid pagination veya country code 400 validation hatasi alir.

### PATCH /clubs/me

- Auth: Access token ve active session gerekir.
- Kaynak: `CurrentUser.userId -> ManagerProfile -> Club`.
- Client tarafindan `clubId` kabul edilmez.
- Guncellenebilir alanlar: `shortName`, `primaryColor`, `secondaryColor`.
- Korumali alanlar: `slug`, `name`, `threeLetterCode`, finans, status, facilities, manager relation, league fields, `logoUrl`, arbitrary external URL.
- PATCH yalniz gonderilen alanlari degistirir; omitted alanlar korunur.
- No-op update 200 doner ve audit yazmaz.
- Gercek degisiklikte update ve audit ayni transaction icinde yapilir.
- Audit event: `CLUB_SETTINGS_UPDATED`.
- Audit metadata allowlist: `changedFields`, `clubId`, `managerProfileId`.
- Hata: 401 `AUTH_UNAUTHORIZED`, 404 `CLUB_NOT_ASSIGNED`, 400 validation veya `CLUB_INVALID_SETTINGS`.

## Guvenlik Notlari

- IDOR korumasi icin private endpointler club id/path parametresi almaz.
- Public endpointler inactive/archived kulup gostermeyerek visibility kuralini uygular.
- Public DTO'lar private finance ve internal relation id alanlarini cekmez.
- Unknown body alanlari Nest ValidationPipe ile reddedilir.
- SQL injection riskine karsi Prisma query builder kullanilir; raw SQL yalniz migration icindedir.
- Search ve pagination sinirlandirilmistir.
- Audit kaydi raw request body, cookie, token, authorization header veya secret icermez.
- Arbitrary logo URL fetch edilmez.

## Test Kapsami

- Unit service testleri: 47 test.
- Controller/HTTP testleri: 13 test.
- Kapsanan ana basliklar: my club, inactive assigned visibility, public active-only visibility, public/private DTO ayrimi, pagination/search, AI club listing, money string precision, protected field rejection, manager-only update, audit allowlist ve transaction rollback.

## Migration Notlari

Migration adi: `20260717150000_club_foundation`.

Destructive islem yoktur:

- DROP TABLE yok.
- DROP COLUMN yok.
- Mevcut `"ownerId"` kolonu korunur ve nullable hale gelir.
- Eski User FK kaldirilir, mevcut degerler `ManagerProfile.id` ile backfill edilir.
- ManagerProfile bulunamayan legacy club kaydi managerless AI/NPC olarak korunur.
- Yeni FK `ON DELETE SET NULL` davranisi kullanir.

Mevcut DEC-012, ilk kimlik modellerindeki cascade kararini anlatir. Club Foundation sonrasinda Club kaydi kullanici silinmesiyle cascade silinmez; bu degisiklik DEC-027 ile kayda alinmistir.
