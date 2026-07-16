# Decision Log

Bu dosya ADR benzeri karar kayıtlarını tutar. Kararlar değişirse yeni karar eklenir; geçmiş kararlar silinmez.

## DEC-001: Monorepo kullanılacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Web, admin, API ve ortak paketler aynı ürünün parçalarıdır.
- Karar: Proje pnpm workspace ve Turborepo tabanlı monorepo olarak yönetilecek.
- Sonuçlar: Ortak tipler ve paketler kolay paylaşılır; CI ve cache düzeni dikkatli tutulmalıdır.

## DEC-002: Ana geliştirme branch'i develop olacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Main branch yanlışlıkla foundation merge'i almıştır ve bu merge geri alınmayacaktır.
- Karar: Bundan sonraki entegrasyon hedefi develop branch'i olacaktır.
- Sonuçlar: Main doğrudan geliştirme için kullanılmaz; release kararı ayrıca verilir.

## DEC-003: Feature branch'ler develop üzerinden açılacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Yeni işler izole branchlerde geliştirilmelidir.
- Karar: Her feature branch güncel develop üzerinden oluşturulacak.
- Sonuçlar: Pull Request tabanı develop olur; main'e doğrudan commit veya push yapılmaz.

## DEC-004: Gerçek dünya futbol verisi ile oyun içi futbolcu örnekleri ayrılacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Lisans, telif ve oyun dengesi riskleri vardır.
- Karar: Oyun içi oyuncular ve kulüpler kurgusal kimliklerle modellenir; gerçek veri ayrı kaynak olarak ele alınır.
- Sonuçlar: Lisanssız görsel veya marka kullanılmaz; veri senkronizasyonu oyun sezonunu otomatik bozmaz.

## DEC-005: Maç sonucu sunucuda hesaplanacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Maç sonucu oyunun rekabet bütünlüğünü belirler.
- Karar: Maç simülasyonu server authoritative olacak ve istemci sadece görüntüleme yapacak.
- Sonuçlar: Hile riski azalır; sunucu tarafı test ve performans ihtiyacı artar.

## DEC-006: İlk sürümde tam fizik tabanlı 3D maç motoru yapılmayacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Tam 3D maç motoru MVP kapsamını aşırı büyütür.
- Karar: İlk sürüm basit maç motoru ve olay anlatımıyla ilerleyecek.
- Sonuçlar: Ürün daha erken oynanabilir hale gelir; görsel sunum sonraki fazlara kalır.

## DEC-007: İlk hedef responsive web ve PWA olacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Hem masaüstü hem mobil tarayıcı desteği istenmektedir.
- Karar: İlk platform responsive web olacak, PWA desteği yayın hazırlığı fazında eklenecek.
- Sonuçlar: Native mağaza yayınları ertelenir; mobil web kalitesi baştan dikkate alınır.

## DEC-008: Gerçek takım armaları ve oyuncu fotoğrafları lisans doğrulanmadan kullanılmayacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Görsel varlıklar telif ve marka riski taşır.
- Karar: Lisans doğrulanmadan gerçek arma, forma, fotoğraf ve marka varlığı kullanılmayacak.
- Sonuçlar: Kurgusal veya özgün varlık üretimi gerekir; marka riski düşer.

## DEC-009: Prisma şeması packages/database içinde tek kaynak olacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Prisma şemasının birden fazla uygulama altında çoğalması migration ve client üretiminde tutarsızlık yaratır.
- Karar: Prisma şeması, migration dosyaları ve Prisma Client export noktası `packages/database` altında tutulacak.
- Sonuçlar: API veritabanına `@football-manager/database` üzerinden erişir; schema değişiklikleri tek pakette izlenir.

## DEC-010: PostgreSQL ana kalıcı veri kaynağıdır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Kullanıcı, menajer, kulüp ve sezon verileri ilişkisel bütünlük gerektirir.
- Karar: Kalıcı oyun ve kimlik verileri PostgreSQL içinde saklanacak.
- Sonuçlar: Migration disiplini zorunludur; para alanlarında `Decimal` kullanılacak ve tarih verileri UTC saklanacaktır.

## DEC-011: Redis cache, geçici durum ve ileride job queue için kullanılacaktır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Bazı veriler hızlı erişim, geçici durum veya arka plan iş kuyruğu gerektirecektir.
- Karar: Redis kalıcı ana veri kaynağı olmayacak; cache, geçici durum, rate limit ve ileride job queue altyapısı için kullanılacak.
- Sonuçlar: Redis kaybı ana veriyi kaybettirmez; health endpoint Redis durumunu ayrı dependency olarak raporlar.

## DEC-012: İlk kimlik modellerinde cascade delete kullanılacak

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Sprint 3 modellerinde `User`, `ManagerProfile` ve `Club` arasında bire bir sahiplik ilişkisi vardır.
- Karar: `User` silindiğinde bağlı `ManagerProfile` ve `Club` kayıtları `onDelete: Cascade` ile silinecek.
- Sonuçlar: Geliştirme verisi temiz kalır ve yetim kayıt oluşmaz; üretim öncesinde hesap kapatma, audit ve veri saklama politikaları ayrıca değerlendirilecektir.

## DEC-013: Şifreler Argon2id ile hashlenir

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Kullanıcı parolaları çevrim dışı brute-force saldırılarına karşı güçlü ve güncel bir hashing yaklaşımı gerektirir.
- Karar: Parolalar Argon2id ile hashlenir; üretim parametreleri deployment ortamında benchmark edilerek belirlenir.
- Sonuçlar: Argon2id bağımlılığı uygulama sprintinde eklenecektir; parametreler config ile yönetilmeli ve eski hashler için rehash stratejisi tasarlanmalıdır.

## DEC-014: Access token kısa ömürlü JWT olacaktır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Web ve PWA istemcileri API'ye sık istek gönderecek, ancak uzun ömürlü bearer token çalınma riski büyüktür.
- Karar: Access token kısa ömürlü JWT olacak ve varsayılan süre 15 dakika kabul edilecektir.
- Sonuçlar: JWT payload minimum tutulur; `sub`, `role`, `sid`, `iat` ve `exp` dışına hassas veri eklenmez.

## DEC-015: Refresh token opaque ve hashlenmiş biçimde saklanacaktır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Refresh token uzun ömürlüdür ve veritabanı sızıntısında açık metin tokenlar kullanıcı hesaplarını riske atar.
- Karar: Refresh token opaque random değer olarak üretilecek, istemciye HttpOnly cookie ile verilecek ve veritabanında yalnız hash değeri saklanacaktır.
- Sonuçlar: Refresh token response body içinde dönmez; token hashing pepper/secret gerektirir ve secret repository'ye eklenmez.

## DEC-016: Her cihaz için ayrı UserSession kaydı oluşturulacaktır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Kullanıcıların cihaz bazlı oturumlarını görmesi, tek cihazdan çıkış yapması ve şüpheli oturumları iptal etmesi gerekir.
- Karar: Her başarılı login ayrı `UserSession` oluşturur ve JWT `sid` claim'i bu session kaydını işaret eder.
- Sonuçlar: Oturum ekranı cihaz, tarayıcı, yaklaşık lokasyon ve son görülme bilgisini gösterebilir; raw IP ve tam user-agent saklanmaz.

## DEC-017: Refresh token rotation ve reuse detection uygulanacaktır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Uzun ömürlü refresh tokenlar çalındığında saldırganın sessizce oturumu sürdürmesini engellemek gerekir.
- Karar: Refresh token tek kullanımlı olacaktır; başarılı refresh sonrası yeni token üretilir, eski token tekrar kullanılırsa reuse detection session ailesini revoke eder.
- Sonuçlar: Concurrent refresh senaryoları dikkatli test edilmelidir; reuse olayı audit log'a yazılır ve kullanıcı yeniden login olur.

## DEC-018: İstemci tarafından gönderilen role bilgisine güvenilmeyecektir

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Admin ve kullanıcı arayüzleri aynı auth altyapısını kullanacak, ancak istemci verisi manipüle edilebilir.
- Karar: Role bilgisi request body, query, local state veya istemci iddiasından alınmaz; yalnız server tarafındaki kullanıcı kaydı ve imzalı minimum claim değerlendirilir.
- Sonuçlar: Yetkilendirme role guard ile yapılır; role yükseltme denemeleri güvenli şekilde reddedilir ve kritik durumlarda audit log'a yazılır.

## DEC-019: Authentication hata mesajları kullanıcı enumeration riskini azaltacaktır

- Tarih: 2026-07-16
- Durum: Kabul edildi
- Bağlam: Login, register, e-posta doğrulama ve şifre sıfırlama akışları kullanıcı hesabının varlığını saldırgana açıklayabilir.
- Karar: Auth hata mesajları e-posta varlığı, parola yanlışlığı veya verification/reset hesabı hakkında gereksiz ayrıntı vermeyecektir.
- Sonuçlar: Kullanıcı deneyimi ve güvenlik dengesi endpoint bazında tasarlanmalıdır; detaylı nedenler response yerine audit log ve internal metric içinde tutulur.
