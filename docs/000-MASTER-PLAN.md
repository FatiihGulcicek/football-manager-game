# Master Plan

## Proje özeti

Bu proje, tarayıcı üzerinden oynanabilen çevrim içi futbol menajerlik oyunudur. Oyuncu bir menajer profili oluşturur, kulübünü yönetir, kadro ve taktik kararları alır, liglerde rekabet eder ve zamanla kulüp itibarını büyütür.

## Ürün hedefi

Modern, anlaşılır ve kısa oturumlarla oynanabilen bir futbol menajerlik deneyimi sunmak. Oyun, derin stratejik kararlar üretirken oyuncuyu karmaşık tablolar içinde kaybetmemelidir.

## Hedef platformlar

- Masaüstü web tarayıcıları
- Mobil web tarayıcıları
- İlerleyen fazlarda PWA

## Hedef oyuncu kitlesi

- Futbol yönetimi oyunlarını seven oyuncular
- Arkadaşlarıyla çevrim içi lig oynamak isteyen gruplar
- Gün içinde kısa oturumlarla ilerleme görmek isteyen mobil oyuncular
- Taktik, transfer ve kulüp gelişimi kararlarından keyif alan strateji oyuncuları

## Temel oyun döngüsü

Oyuncu günlük hazırlık yapar, kadro ve taktik kararlarını günceller, maç simülasyonunu takip eder, raporları inceler ve kulübünü uzun vadeli hedeflere göre geliştirir.

## İlk oynanabilir sürüm kapsamı

- Kullanıcı hesabı ve menajer profili
- Kulüp oluşturma
- Temel dashboard
- Kadro, diziliş ve taktik ekranları
- Lig, fikstür ve puan durumu
- Basit ve sunucu taraflı maç simülasyonu
- Temel transfer pazarı
- Temel admin yönetimi

## İleri sürüm kapsamı

- Arkadaş ligleri
- Scout ve sözleşme yönetimi
- Kulüp ekonomisi ve stadyum gelişimi
- Canlı hissi veren maç anlatımı
- Sezon sistemi ve ödüller
- 2D maç görünümü
- Temel 3D maç sunumu
- PWA ve mobil bildirimler

## Teknik aşamalar

- Monorepo, CI ve Docker temelinin korunması
- API, web ve admin uygulamalarının ayrı sorumluluklarla geliştirilmesi
- PostgreSQL ve Prisma ile kalıcı veri modeli kurulması
- Redis ve job queue ile zamanlanmış işler ve cache katmanının eklenmesi
- Maç motorunun deterministik ve test edilebilir hale getirilmesi
- Yetkilendirme, rate limit, audit log ve güvenlik kontrollerinin eklenmesi

## Riskler

- MVP kapsamının gereksiz büyümesi
- Maç motorunun erken fazda fazla karmaşık tasarlanması
- Gerçek dünya futbol verisi ve lisanslı varlıkların yanlış kullanılması
- Mobil deneyimin masaüstü arayüzünden türetildiği için ağır kalması
- Ekonomi ve transfer sisteminin dengesiz hale gelmesi

## Başarı ölçütleri

- Kullanıcı 10 dakikadan kısa sürede kulüp kurup ilk maç hazırlığına başlayabilmeli
- MVP maç simülasyonu aynı seed ve girdilerle aynı sonucu üretmeli
- Temel oyun döngüsü mobil ve masaüstünde tamamlanabilmeli
- CI kontrolleri her Pull Request için çalışmalı
- MVP kapsamındaki ekranlar tamamlanmış ve test edilebilir olmalı

## Geliştirme fazları

### Phase 0

- Teknik temel
- Git ve CI
- Docker
- Veritabanı temeli

### Phase 1

- Kullanıcı hesabı
- Menajer profili
- Kulüp oluşturma
- Dashboard

### Phase 2

- Futbolcular
- Kadro
- Diziliş
- Taktikler
- Antrenman

### Phase 3

- Lig
- Fikstür
- Puan durumu
- Basit maç motoru

### Phase 4

- Transfer pazarı
- Scout
- Sözleşmeler
- Kulüp ekonomisi

### Phase 5

- Arkadaş ligleri
- Bildirimler
- Canlı maç olayları
- Sezon sistemi

### Phase 6

- 2D maç görünümü
- Temel 3D maç sunumu
- Stadyum geliştirme

### Phase 7

- Mobil PWA
- Ölçeklendirme
- Güvenlik
- Yayın hazırlığı
