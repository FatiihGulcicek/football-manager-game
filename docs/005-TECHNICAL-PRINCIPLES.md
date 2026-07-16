# Technical Principles

## Temel ilkeler

- Server authoritative yapı kullanılacak; kritik oyun kararları sunucuda verilecek.
- İstemciye güvenilmeyecek; istemci sadece niyet ve giriş gönderir.
- Maç simülasyonu deterministik olacak.
- Aynı seed ve aynı girdiler aynı sonucu üretecek.
- Gerçek dünya futbol verisi ile oyun içi varlıklar ayrı tutulacak.
- API sağlayıcı kimlikleri ayrıca saklanacak ve oyun içi kimlik yerine kullanılmayacak.
- Devam eden sezonlarda gerçek transferler kadroları aniden değiştirmeyecek.
- PostgreSQL ana veri kaynağı olacak.
- Redis cache ve job queue için kullanılacak.
- Background job sistemi zamanlanmış sezon, bildirim ve senkronizasyon işleri için kurulacak.
- Veri senkronizasyonu idempotent tasarlanacak.
- Audit log önemli yönetim ve ekonomi işlemlerini kaydedecek.
- Rate limit API ve auth uçlarında zorunlu olacak.
- DTO doğrulama API sınırlarında uygulanacak.
- Para alanları decimal olarak saklanacak.
- Tarihler UTC saklanacak.
- TypeScript strict mod korunacak.
- Test zorunluluğu Pull Request sürecinin parçası olacak.
- Feature branch ve Pull Request zorunlu olacak.
- Gizli anahtarlar repository'ye eklenmeyecek.

## Mimari kararlar

| Teknoloji | Kullanım | Neden seçildi |
| --- | --- | --- |
| Next.js web | Oyuncu arayüzü | React tabanlı, SSR/SSG seçenekleri güçlü ve PWA yoluna uygun |
| Next.js admin | Operasyon paneli | Web ile ortak bilgi birikimi sağlar, ayrı dağıtım ve yetki sınırı kurar |
| NestJS API | Sunucu API katmanı | Modüler yapı, dependency injection ve DTO tabanlı doğrulama için uygun |
| PostgreSQL | Ana veritabanı | İlişkisel oyun verisi, işlemler ve raporlama için güçlü temel |
| Prisma | ORM ve migration aracı | TypeScript ile tip güvenli veri erişimi sağlar |
| Redis | Cache ve queue altyapısı | Hızlı geçici veri, rate limit ve job queue desteği sağlar |
| BullMQ | Background job sistemi | Redis üzerinde güvenilir ve tekrarlanabilir iş kuyruğu sağlar |
| Socket.IO | Canlı hissi veren olay aktarımı | Maç olayları ve bildirimlerde kontrollü gerçek zamanlı iletişim sağlar |
| Vitest | Unit ve smoke test | TypeScript projelerinde hızlı test koşusu sağlar |
| Playwright | Uçtan uca test | Kritik web akışlarını gerçek tarayıcıyla doğrular |
| Docker | Yerel ve CI ortamı | Servisleri tekrarlanabilir şekilde ayağa kaldırır |
| GitHub Actions | CI | Pull Request doğrulamalarını otomatikleştirir |

## Uygulama notları

- İlk fazlarda basit ve test edilebilir modeller tercih edilecek.
- Ölçekleme kararları gerçek kullanım verisi olmadan gereksiz karmaşıklık yaratmayacak.
- Maç motoru ayrı ve saf fonksiyonlara yakın tasarlanacak.
- Admin işlemleri audit log kapsamına alınacak.
- Lisanslı veya gerçek marka varlıkları için izin doğrulanmadan üretim kullanımı yapılmayacak.
