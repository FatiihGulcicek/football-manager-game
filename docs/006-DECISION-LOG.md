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
