# Feature Map

Bu harita özellikleri hedef kapsamlarına göre ayırır. MVP kapsamındaki maddeler temel ve çalışır sürümleri ifade eder; ileri seviye derinlik sonraki fazlara bırakılır.

## MVP

| Özellik | Kullanıcı değeri | Teknik zorluk | Bağımlı sistemler | Faz |
| --- | --- | --- | --- | --- |
| Kayıt ve giriş | Oyuncu ilerlemesini korur | Orta | Auth, kullanıcı modeli, session | Phase 1 |
| Menajer profili | Oyuncuya kimlik ve ilerleme hissi verir | Düşük | Kullanıcı, profil verisi | Phase 1 |
| Kulüp | Oyuncunun yöneteceği ana varlığı oluşturur | Orta | Kullanıcı, ekonomi başlangıcı | Phase 1 |
| Kadro | Takım yönetiminin merkezini kurar | Orta | Futbolcu modeli, kulüp | Phase 2 |
| Oyuncu detayı | Karar vermek için oyuncu bilgisini gösterir | Orta | Futbolcu özellikleri, performans verisi | Phase 2 |
| Diziliş | Maç hazırlığının temel kararını sağlar | Orta | Kadro, pozisyon kuralları | Phase 2 |
| Taktikler | Oyuncu kararlarının maça etkisini kurar | Orta | Diziliş, maç motoru girdileri | Phase 2 |
| Lig | Rekabet yapısını oluşturur | Orta | Kulüpler, sezon, fikstür | Phase 3 |
| Fikstür | Oyuncuya planlama zemini verir | Orta | Lig, sezon takvimi | Phase 3 |
| Puan durumu | Rekabet sonucunu anlaşılır kılar | Düşük | Lig maç sonuçları | Phase 3 |
| Basit maç motoru | Kararları sonuca bağlar | Yüksek | Kadro, taktik, seed, lig maçı | Phase 3 |
| Transfer pazarı | Kadro geliştirme yolu sunar | Yüksek | Futbolcu, kulüp bütçesi, sözleşme taslağı | Phase 4 |
| Bildirimler | Oyuncuyu önemli olaylardan haberdar eder | Orta | Event sistemi, kullanıcı tercihleri | Phase 5 |
| Admin temeli | Operasyon ve veri kontrolü sağlar | Orta | Yetki, kullanıcı, kulüp ve lig verisi | Phase 1 |

## V1

| Özellik | Kullanıcı değeri | Teknik zorluk | Bağımlı sistemler | Faz |
| --- | --- | --- | --- | --- |
| Antrenman | Kadro gelişimine düzenli karar ekler | Orta | Oyuncu özellikleri, haftalık takvim | Phase 2 |
| Moral ve kondisyon | Kadro kararlarını daha anlamlı yapar | Orta | Maç raporu, antrenman, oyuncu durumu | Phase 2 |
| Sakatlık ve ceza | Risk ve rotasyon kararları üretir | Orta | Maç olayları, oyuncu durumu | Phase 3 |
| Scout | Transfer kararlarına belirsizlik ve keşif katar | Orta | Transfer pazarı, oyuncu havuzu | Phase 4 |
| Kulüp finansı | Uzun vadeli kulüp yönetimi sağlar | Yüksek | Gelir, gider, transfer, maaş | Phase 4 |
| Stadyum | Kulüp gelişimini görünür kılar | Orta | Finans, tesis gelişimi | Phase 6 |
| Arkadaş ligleri | Sosyal rekabet ve bağlılık sağlar | Yüksek | Lig, davet, kullanıcı ilişkileri | Phase 5 |
| Canlı maç anlatımı | Simülasyonu izlenebilir hale getirir | Orta | Maç motoru olayları, bildirimler | Phase 5 |
| Sezon ödülleri | Sezon sonu motivasyonu yaratır | Orta | Lig sonuçları, istatistikler | Phase 5 |

## V2

| Özellik | Kullanıcı değeri | Teknik zorluk | Bağımlı sistemler | Faz |
| --- | --- | --- | --- | --- |
| Gençlik akademisi | Uzun vadeli oyuncu üretimi sağlar | Yüksek | Akademi, oyuncu gelişimi, tesis | Phase 6 |
| Personel sistemi | Kulüp yönetimine uzmanlık katmanı ekler | Orta | Kulüp, ekonomi, görev etkileri | Phase 6 |
| Gelişmiş sözleşmeler | Transfer ve kadro ekonomisini derinleştirir | Yüksek | Finans, transfer, oyuncu beklentisi | Phase 4 |
| Sponsor pazarlığı | Finans kararlarına aktif seçenek ekler | Orta | Kulüp itibarı, finans | Phase 4 |
| Klan veya menajer birlikleri | Sosyal hedefler ve grup rekabeti sağlar | Yüksek | Arkadaş sistemi, ligler, mesajlaşma | Phase 5 |
| 2D maç görünümü | Maçı daha görsel ve anlaşılır kılar | Yüksek | Maç olayları, pozisyon verisi | Phase 6 |
| Temel 3D sunum | Premium sunum hissi verir | Yüksek | 2D olay modeli, görsel varlıklar | Phase 6 |
| Mobil bildirimler | Oyuncuyu doğru zamanda oyuna geri çağırır | Orta | PWA, bildirim tercihleri, event sistemi | Phase 7 |

## Gelecek

| Özellik | Kullanıcı değeri | Teknik zorluk | Bağımlı sistemler | Faz |
| --- | --- | --- | --- | --- |
| Gelişmiş 3D maç | Maç sunumunu üst seviyeye taşır | Çok yüksek | 3D altyapı, varlık üretimi, performans | Phase 7+ |
| Büyük turnuvalar | Daha geniş rekabet hedefleri sunar | Yüksek | Sezon, lig, fikstür, ödül sistemi | Phase 7+ |
| Çok bölgeli sunucu | Ölçeklenebilirlik ve düşük gecikme sağlar | Çok yüksek | Operasyon, veri çoğaltma, gözlemleme | Phase 7+ |
| Yerelleştirme | Daha geniş oyuncu kitlesine erişim sağlar | Orta | Metin yönetimi, içerik süreci | Phase 7 |
| Mobil mağaza yayınları | PWA sonrası platform erişimini büyütür | Yüksek | Mobil paketleme, mağaza uyumluluğu | Phase 7+ |

## Sprint 5A Club Foundation notu

- Kulup MVP maddesinin backend temeli eklendi: public club list/detail, manager own-club okuma ve manager presentation update.
- Kapsam disi kalanlar: lig fiksturu, oyuncular, transferler, detayli finans, club creation wizard, UI ve admin ekranlari.
- Club public gorunurlugu `ACTIVE` status ile sinirlidir; assigned `INACTIVE` club yalniz kendi manager'i tarafindan gorulebilir.
- Para alanlari Decimal saklanir ve API tarafinda string olarak doner.
