# ZEREN SPOR KULÜBÜ — GELİŞTİRME VE AGENT DEVİR PLANI

## 1. Belgenin amacı ve kapsamı

Bu belge, Bilet Dağıtım ve Koltuk Yönetim Sistemi için yapılan teknik inceleme ve UI/UX değerlendirmelerinin uygulama planıdır. Başka bir agent, konuşma geçmişine ihtiyaç duymadan geliştirmeleri bu belge üzerinden yürütebilmelidir.

- **Hazırlanma tarihi:** 8 Kasım 2026, Türkiye saati esas alınmıştır.
- **Depo:** https://github.com/utkugunce/biletistiyorum
- **Canlı personel portalı:** https://biletistiyorum.vercel.app/
- **Canlı yönetim paneli:** https://biletistiyorum.vercel.app/admin
- **İncelenen son commit:** `449c2ceca115d6d20185ee2e35096523c5bf2c62`.
- **Zorunlu başlangıç okuması:** Depo kökündeki `CODEX_PROJECT_GUIDE.md` ve varsa geçerli `AGENTS.md` dosyaları.
- **Bu teslimin kapsamı:** Yalnızca bu Markdown belgesi hazırlanmıştır. Belge hazırlanırken uygulama kodu, canlı veriler, dağıtım veya ayarlar değiştirilmemiştir.

Bu belgedeki işler henüz tamamlanmış sayılmaz. Tek istisna, Bölüm 5'te açıkça belirtilen bilet adedi düzeltmesidir. Uygulayıcı agent başlangıçta güncel depoyu kontrol etmeli; arada tamamlanan işleri tekrar yapmamalıdır.

## 2. Kanıt düzeyi ve incelemenin sınırları

İşlerde aşağıdaki kanıt etiketleri kullanılır:

- **CANLI:** Gerçek Vercel sitesi Chromium ile açılmış, ilgili davranış veya görünüm gözlenmiştir.
- **KOD:** Kaynak kodda ilgili uygulama veya risk görülmüştür; canlıda veri değiştirerek hata üretilmemiştir.
- **DOĞRULA:** Canlı altyapı, Windows veya erişim politikası ayrıca kontrol edilmeden kesin sonuca varılamaz.
- **TASARIM:** İş akışını iyileştiren hedef davranıştır; mevcut sistemde gerçekleştiği iddia edilen bir hata değildir.

### 2.1. Canlıda incelenen alanlar

- Personel talep formu ve salon rehberi.
- Yönetici giriş ekranı ve giriş sonrası panel.
- Koltuk planı, koltuk seçimi ve seçim sonrası alt atama çubuğu.
- Yönetim panelindeki salon haritası görünümü.
- Gelen Talepler, Gönderilen Talepler ve Dağılım Özeti sekmeleri.
- 1920, 1440, 1366 ve 390 piksel genişlikleri; ayrıca dokunmatik mobil emülasyon.
- Bilet adedi alanında boşaltma, `30` yazma ve alandan çıkma.

İnceleme sırasında gerçek talep gönderilmedi; koltuk atanmadı, kaldırılmadı veya takas edilmedi; WhatsApp gönderimi işaretlenmedi; dosya yüklenmedi veya silinmedi. Windows Gezgini'nin gerçekten açılması ve PDF'lerin Windows diskinde taşınması bu ortamda doğrulanmadı.

### 2.2. Sertifika konusu uygulama hatası olarak ele alınmamalı

İlk tarayıcı denemesindeki sertifika engeli, inceleme ortamının proxy CA sertifikasının Chromium tarafından tanınmamasından kaynaklanmıştır. Ortamın bilinen proxy sertifikasına geçici tarayıcı oturumunda özel güven tanımlanınca gerçek HTTPS sayfaları açılmış ve HTTP 200 alınmıştır.

Bu gözlem, sitenin üretim TLS sertifikasının bozuk olduğu anlamına gelmez. Uygulayıcı agent bu nedenle Vercel, DNS veya üretim sertifikalarını değiştirmemeli; genel TLS doğrulamasını kapatmamalıdır. Sonraki incelemede gerekirse ortamın güven zinciri düzeltilmeli ve kullanılan yöntem raporlanmalıdır.

## 3. Korunması gereken mimari ve iş kuralları

1. **Şirket içi kapsam korunmalı.** Personel, sponsor ve misafir bilet tahsisini sağlayan mevcut operasyon esas alınmalı.
2. **Hibrit yapı korunmalı.** Vercel/Node.js API + Supabase bulut katmanı; Windows/FastAPI yerel PDF ve masaüstü köprüsü olarak devam etmeli. Sırf sadeleştirme amacıyla yeniden yazım veya platform değişikliği yapılmamalı.
3. **Talep kimliği temel alınmalı.** Aynı kişinin aynı maçta birden fazla bağımsız talebi olabilir. Atama, gönderim ve klasörleme kişi adına göre birleştirilmemeli.
4. **Maç ayrımı zorunlu.** Aynı blok/sıra/koltuk başka maçlarda tekrar kullanılabilir; farklı maçların atamaları ve PDF'leri karışmamalı.
5. **Klasör düzeni korunmalı.** Maça ait kök altında `<Kişi Adı>/<request_id>/` kullanılmalı; geçerli talep kimliği olan işlemler kişi klasörüne topluca uygulanmamalı.
6. **WhatsApp masaüstü akışı korunmalı.** İlgili sohbet ve doğru talebin klasörü açılmalı. İstenmeyen otomatik dosya indirme veya otomatik mesaj gönderme eklenmemeli.
7. **Üç sekme korunmalı.** Gelen Talepler, Gönderilen Talepler ve Dağılım Özeti aynı iş anlamını sürdürmeli.
8. **Koltuk davranışları korunmalı.** Beyaz boş koltuklar, grup renkleri, tekli/çoklu seçim, Shift ile aralık seçimi, sürükleme, seçim temizleme ve geçici karartmanın sıfırlanması bozulmamalı.
9. **Windows oturumu korunmalı.** Explorer, arka plan servisinin oturumunda görünmez şekilde değil, operatörün etkileşimli masaüstünde açılmalı.
10. **Kopyalar senkron tutulmalı.** Her değişiklik ilgili tüm dağıtım kopyalarına uygulanmalı. Dosya adlarının her hedefte aynı olduğuna varsayımla karar verilmemeli; gerçek HTML referansları ve `vercel.json` okunmalı.

## 4. Dosya haritası ve başlangıç kontrolü

| Alan | Başlıca dosyalar | Not |
|---|---|---|
| Personel portalı | `index.html`, `bilet_istiyorum.js`, `bilet_istiyorum.css` | Güncel canlı kök portal bu dosyalarla çalışıyor. |
| Yönetici arayüzü | `admin.html`, `app.js`, `styles.css` | Statik kopyaları ayrıca kontrol et. |
| Bulut yönetim API'si | `api/admin.js`, `api/base_state.json` | Kimlik doğrulama, atama, gönderim, sistem durumu. |
| Portal API'leri | `api/request.js`, `api/my-requests.js`, diğer mevcut `api/*` dosyaları | Kılavuzdaki `api/portal.js` adı güncel depoda bulunmayabilir; gerçek yönlendirmeyi izle. |
| Yönlendirme | `vercel.json` | Portal uçları ve genel admin rewrite sırası önemli. |
| Yerel servis | `bilet_app/server.py`, `portal_storage.py` | Yerel ve bulut API davranışlarını karşılaştır. |
| Windows köprüsü | `bilet_app/sync_helper.py`, `desktop_helper.py` | Dosya mutabakatı, komut işleme, oturum açılışı. |
| PWA | `sw.js`, manifest ve ilgili kopyaları | Eski istemcilerin güncellenmesi doğrulanmalı. |

Başlangıçta çalışma ağacını, dalı, güncel commit'i ve mevcut yerel değişiklikleri kaydet. Kullanıcıya ait değişiklikleri silme veya istemeden commit'e katma. Canlı veritabanına ve gerçek bilet klasörlerine dokunmadan önce yerel/test verisiyle geliştirmeleri tamamla.

### 4.1. Bilinen portal JavaScript kopyaları

```text
bilet_istiyorum.js
static/bilet_istiyorum.js
biletistiyorum/bilet_istiyorum.js
biletistiyorum/static/bilet_istiyorum.js
bilet_app/static/bilet_istiyorum.js
```

### 4.2. Bilinen service worker kopyaları

```text
sw.js
biletistiyorum/sw.js
bilet_app/static/sw.js
```

Yönetici dosyalarının, portal HTML/CSS dosyalarının ve diğer varlıkların kopyaları da değiştirilecek dosyaya göre keşfedilmelidir. Tek bir kopyayı değiştirip iş tamamlandı denmemelidir.

## 5. Daha önce tamamlanan iş: Bilet adedini elle yazabilme

**Durum:** TAMAMLANDI; yeniden geliştirme değil, regresyon kontrolü gerekiyor.

- Commit: https://github.com/utkugunce/biletistiyorum/commit/449c2ceca115d6d20185ee2e35096523c5bf2c62
- Önceki hata: Her `input` olayında değer normalize edildiği için alanı boşaltmak hemen `1` yazılmasına neden oluyordu; çok basamaklı sayı girişi engelleniyordu.
- Yeni davranış: Yazma sırasında yalnızca hızlı adet seçeneklerinin aktif durumu güncelleniyor. Değerin 1–100 aralığına normalizasyonu `blur` sırasında yapılıyor.
- Artı/eksi ve hazır adet seçenekleri çalışmaya devam ediyor.
- Beş JavaScript kopyası güncellendi; üç service worker kopyasında önbellek sürümü `zeren-bilet-pwa-v2` yapıldı.
- Yerel tarayıcı testinde 1440 ve 390 pikselde `30` yazma, sahte API'ye `requested_count: 30` gönderme, sınırlar ve kontroller doğrulandı.
- Gerçek canlı sayfada alan temizlenip `30` yazıldı; yazarken ve alandan çıkınca `30` kaldığı doğrulandı. Canlıya talep gönderilmedi.

**Korunacak kabul kriterleri:** Alan yazma sırasında boş bırakılabilmeli; `30` ve `100` girilebilmeli; artı/eksi ve hazır adetler doğru çalışmalı; alandan çıkınca sınırlar uygulanmalı. Boş/geçersiz değer, Enter ile gönderim ve mobil klavye senaryoları da sonraki regresyon testine dahil edilmeli.

## 6. Öncelik ve uygulama sırası

| Aşama | İşler | Gerekçe |
|---|---|---|
| 1 — Erişim ve güvenlik | T01, T02, T03 | Personel bilgilerinin ve yönetim işlemlerinin korunması. |
| 2 — Veri tutarlılığı | T04, T05, T06, T07, T08 | Kayıp talep, çakışan atama ve maçlar arası karışmayı önleme. |
| 3 — Yerel köprü ve gönderim | T09, T10, U07 | Fiziksel PDF durumu ve gönderim bilgisini güvenilir kılma. |
| 4 — Canlı arayüz hataları | U01, U02, U03, U04 | Görünmeyen kontroller, taşma ve erişilebilirlik sorunları. Bağımsız olanları önce ele almak mümkündür. |
| 5 — Akışların sadeleştirilmesi | U05–U12 | Personel ve operatörün daha az hatayla çalışması. |
| 6 — Bakım ve yayına hazırlık | M01, M02, M03 | Kopya tutarlılığı, regresyon ve kalıcı dokümantasyon. |

Öncelik sırası, erişim veya altyapı bağımlılığı bulunan işi yapılmış sayma gerekçesi değildir. Bir işin altyapı kısmı bekliyorsa bağımsız arayüz ve yerel test işleri sürdürülebilir; eksik kalan kısım açıkça kaydedilmelidir.

## 7. Teknik geliştirme görevleri

### T01 — Portal taleplerinin yetkisiz listelenmesini kapat

**Öncelik:** Kritik. **Kanıt:** KOD; canlı erişim politikası ayrıca DOĞRULA.

**Bulgu:** `api/request.js` GET akışında yönetici doğrulaması olmadan tüm talepleri sorguluyor. `api/my-requests.js`, boş `q` geldiğinde tüm kayıtları döndürebiliyor; kişi adı veya tahmin edilebilir talep numarası da tek başına yetki kanıtı değil.

**İş:** Yönetici listeleme yetkisini portalın kendi talebini görüntüleme yetkisinden ayır. Personelin kendi taleplerine güvenilir erişimini sağlayan kimlik veya ayrı güvenli erişim anahtarı kullan. İçeride kullanılmasını anonim erişim izni sayma. Personel dizini, telefon defteri ve varsa doğrudan PDF yollarında da aynı veri minimizasyonu ilkesini uygula; erişim durumunu doğrulamadan bunların açık olduğunu iddia etme.

**Kabul:** Anonim kullanıcı tüm ad/telefon/not/talep listesini alamamalı. Boş sorgu, başka kişinin adı veya başka bir `request_id` özel kayda erişim vermemeli. Yönetici yetkili kapsamı görebilmeli. Portalın meşru talep oluşturma akışı çalışmalı.

### T02 — Yönetici parolası, token ve oturum yönetimini güçlendir

**Öncelik:** Yüksek. **Kanıt:** KOD.

**Bulgu:** `api/admin.js` içinde sabit HMAC sırrı, bilinen varsayılan parola, paroladan deterministik token üretimi ve parola bilgisinin sistem JSON'unda tutulması var. Giriş çerezi ile parola değiştirme çerezinin güvenlik nitelikleri tutarlı değil. Çıkış yalnızca çerezi temizliyor; eldeki token'ın sunucu tarafında iptali ayrı ele alınmalı. Yerel servis farklı oturum mantığı kullanıyor.

**İş:** Sırları environment üzerinden zorunlu sağla; üretimde sessiz varsayılan parolaya düşme. Parolayı uygun hash ile sakla. Süresi dolan, iptal edilebilen oturumlar ve tutarlı logout/parola değişikliği davranışı sağla. Çerezlerde dağıtım bağlamına uygun `Secure`, `HttpOnly`, `SameSite` uygula; token'ı JavaScript depolamasında tutma ihtiyacını azalt. Parola denemelerine ölçülü hız sınırlaması ekle. Bulut ve yerel istemci sözleşmesini bozma; mevcut oturumlar için geçişi planla.

**Kabul:** Süresi dolmuş, iptal edilmiş ve parola değişimiyle geçersizleşmiş oturumlar reddedilmeli. Kaynak kodda veya API yanıtında parola/özel imzalama sırrı bulunmamalı. Giriş, yenileme, çıkış ve yerel kullanım test edilmeli. Sırlar loglara veya bu belgeye eklenmemeli.

### T03 — Supabase izinleri ve mutasyon sınırlarını doğrula

**Öncelik:** Kritik/Yüksek. **Kanıt:** KOD + DOĞRULA.

**Bulgu:** Kodda publishable Supabase anahtarı kullanılıyor. Publishable anahtarın görünür olması tek başına gizli anahtar sızıntısı değildir; gerçek sınır veritabanı izinleri ve RLS politikalarıdır. İncelemede canlı politikalar görülmedi.

**İş:** Anonim ve yetkili rollerin gerçek okuma/yazma kapsamını incele. `__SYSTEM_STATE__`, parola/oturum verisi ve Explorer komutları anonim istemci tarafından okunup değiştirilememeli. Gerekli sunucu ayrıcalıkları tarayıcıya aktarılmamalı. CORS'u gerçek istemci kökenleriyle sınırla; çerezle yetkilendirilen mutasyonlarda CSRF/Origin kontrolünü ele al. Yerel servisin `0.0.0.0` dinleme ve CORS tercihini gerçek LAN ihtiyacına göre daralt; gerekli bulut–yerel köprüyü koru.

**Ek kod bulgusu:** Talep silme dalı, beklenen DELETE/POST yöntemiyle açıkça sınırlandırılmamış görünüyor. Genel başarılı yanıt veren bilinmeyen rotalar da hatayı gizleyebilir. Rotalarda yöntem kontrolü, 404/405 ve sunucu doğrulaması ekle. Kullanıcının gönderdiği ID ile sistem satırının hedeflenmesine izin verme.

**Kabul:** GET gibi salt okunur istekler kayıt silmemeli veya Explorer komutu üretmemeli. Yanlış yöntem 405 dönmeli; bilinmeyen rota başarı gibi görünmemeli. Anonim rol sistem satırını okuyup yazamamalı. Pozitif ve negatif erişim testleri gerçek politikaya uygun test ortamında çalışmalı.

### T04 — Veritabanı hatalarını başarı gibi gösterme

**Öncelik:** Yüksek. **Kanıt:** KOD.

**Bulgu:** `saveSystemState()` ve çeşitli PATCH/DELETE çağrılarında HTTP sonucu kontrol edilmiyor. `loadSystemState()` başarısız okumada boş atamalar ve varsayılan parola döndürebiliyor. `api/request.js`, kayıt başarısız olduğunda serverless süreç belleğindeki `fallbackStore` dizisine yazıp başarı döndürüyor.

**İş:** Merkezi, kontrollü hata işleme kullan. Başarısız veri okumasını boş başlangıç durumu sanıp mevcut veriyi ezme. Kalıcı yazma başarısızsa portal talebini başarılı gösterme; üretimde geçici bellek fallback'ini kaldır. Ağ zaman aşımı, başarısız HTTP ve geçersiz JSON durumlarını yönet. Tekrar denemelerin çift talep üretmemesi için idempotency yaklaşımı belirle.

**Kabul:** Supabase kesintisinde kullanıcı açık hata görmeli, doldurduğu form korunmalı. Kalıcı olarak kaydedilmeyen talep için takip kodu/başarı ekranı gösterilmemeli. Admin kaydı başarısızsa UI başarı durumu kalıcılaştırmamalı. Geçici okuma hatası mevcut atamaları veya yönetici parolasını sıfırlamamalı.

### T05 — Çakışmaya dayanıklı talep kimliği üret

**Öncelik:** Yüksek. **Kanıt:** KOD.

**Bulgu:** `api/request.js`, yalnızca 900 olasılık içeren üç basamaklı rastgele sayıdan `ZS-...` üretiyor ve istemciden gelen `body.id` değerini kabul edebiliyor.

**İş:** Kimliği sunucuda üret; veritabanı benzersizlik kısıtıyla güvenceye al. Tercihen benzersiz dahili kimlik ile insan tarafından okunabilir `ZS-...` takip kodunu ayır veya veritabanı sequence kullan. Takip kodunu erişim sırrı sayma. Eski `ZS-...` kayıtlarının atama, gönderim ve klasör eşleşmelerini koru.

**Kabul:** Paralel oluşturma testlerinde ID çakışması, başka kaydın üzerine yazılması veya kaybolan talep olmamalı. İstemci `__SYSTEM_STATE__` veya mevcut talep ID'sini zorlayamamalı. Eski talepler görüntülenebilmeli ve yönetilebilmeli.

### T06 — Atamaları atomik ve çakışmaya dayanıklı yap

**Öncelik:** Yüksek. **Kanıt:** KOD; yarış durumu canlıda tetiklenmedi.

**Bulgu:** Tek sistem JSON'u okunup tümüyle yazılıyor. Paralel iki yönetici aynı sürümden başlayıp birbirinin değişikliğini ezebilir. Sistem JSON'u ve talep satırları ayrı yazılıyor. Elle verilen koltuklarda ve kaydırma/takas akışında sahiplik ve veri bütünlüğü kontrolleri incelenmeli.

**İş:** Veritabanı transaction/RPC veya eşdeğer güvenilir atomik işlem kullan; gerekiyorsa sürüm kontrolü/CAS ekle. Koltuk benzersizliğini maç bazında sunucuda güvenceye al. Talep ataması, kaldırma, takas, toplu atama ve ilgili talep durumunu aynı tutarlılık sınırında işle. Kaynak/hedef sayısını, gerçek koltukları ve mevcut sahipliği doğrula. Çakışmada güncel veriyi alıp operatöre açık sonuç göster.

**Kabul:** Aynı koltuğa iki paralel atamadan biri kontrollü şekilde reddedilmeli. Farklı koltuklardaki iki başarılı işlem de korunmalı. İşlem ortasında hata olursa yarım güncelleme kalmamalı. Dolu hedefe izinsiz yazma, eşit olmayan takas dizilerinden veri kaybı ve hayali koltuk ataması engellenmeli.

### T07 — Tüm akışlarda kesin request_id izolasyonu sağla

**Öncelik:** Yüksek. **Kanıt:** KOD.

**Bulgu:** Özetin gönderim hesabında kişi adına geri dönüş var: `sentMap[pr.id] || (isComp && sentMap[person])`. Bazı mevcut atama eşleştirmeleri kişi adına dayanıyor. Kişiye dock üzerinden atama ve talep silme/kaldırma yolları aynı kişinin farklı taleplerini yanlış etkileyebilir.

**İş:** Gönderim, koltuk tamamlama, silme, takas ve klasör komutlarında talep kimliğini esas al. Kişi adına toplu temizleme yalnızca açıkça seçilmiş grup işlemi olarak kalsın. Talep belirsizse sessizce ilk talebe bağlamak yerine operatöre talep seçtir. Eski kişi bazlı `sent_map` kayıtları için güvenli geçiş hazırla; belirsiz geçmişi otomatik olarak tüm taleplere yayma.

**Kabul:** Aynı kişinin A ve B taleplerinden A'nın gönderilmesi/silinmesi/atamasının kaldırılması B'yi değiştirmemeli. Kısmi A tamamlanırken B'nin koltukları sayılmamalı. Koltuk başka talebe yeniden atanmışsa eski talebi silmek yeni atamayı kaldıramamalı. Kişi bazlı özet bağımsız taleplerin doğru toplamını göstermeli.

### T08 — Maç bazlı veriyi ve dinamik bilet eşlemelerini tamamla

**Öncelik:** Yüksek. **Kanıt:** KOD.

**Bulgu:** Bulutta maç adı/tarihi ve `TICKET_FILES` eşlemeleri sabit; sistem atamalarının anahtarı yalnızca blok/koltuk içeriyor. Özet sorguları tüm maçların taleplerini alabiliyor. Yerel serviste de sabit maç oluşturma/eleme kuralları var.

**İş:** Kalıcı `match_id` ve maç bazlı durum kapsamı tanımla. Portal, admin, atama, gönderim, PDF havuzu, indirme ve yerel komutlar aynı maç kimliğini kullanmalı. Sabit maç ve dosya eşlemelerini yükleme/metadata akışıyla değiştir. Yeni maç, boş plan, ZIP/PDF yükleme, blok seçimi, aktif maç değiştirme ve arşiv işlemlerinin bulut/yerel destek durumunu doğrula. Gerçek API desteği olmayan kontrol sessiz başarı vermemeli.

**Kabul:** İki maçta aynı koltuk birbirinden bağımsız atanabilmeli. Maç değişince ilgili talepler, sayaçlar, biletler ve dağıtım listesi değişmeli. Eski maça ait Explorer komutu aktif başka maç klasörüne uygulanmamalı. Mevcut maçın kayıtları ve PDF bağlantıları geçişte kaybolmamalı.

### T09 — Windows PDF senkronizasyonunu iki yönlü mutabakatla güvenilir yap

**Öncelik:** Yüksek. **Kanıt:** KOD; Windows üzerinde DOĞRULA.

**Bulgu:** `sync_helper.py` mevcut bulut atamalarını kişi/talep klasörüne taşıyor. Bulutta ataması kaldırılan PDF'lerin havuza geri dönmesi bu yardımcıda görünmüyor. Sonuçlar ağırlıkla konsola yazılıyor.

**İş:** İstenen bulut durumu ile gerçek disk durumunu karşılaştır. Yeni atama, yeniden atama, kaldırma ve talep silme işlemlerinde doğru fiziksel konumu sağla. Eksik/kilitli/aynı adlı dosya durumlarını veri kaybetmeden yönet; kullanıcı PDF'sini sessizce ezme veya silme. Yol bileşenlerini Windows kurallarına göre güvenli hale getir; maç kökü dışına çıkışı engelle ve aynı güvenli ada dönüşen kişiler arasında çakışmayı yönet. 1,5 saniyelik döngüde değişiklik yoksa gereksiz tam disk taramasını azalt; zaman aşımı ve tekrar denemeleri gözlemlenebilir kıl.

**Kabul:** A talebinden B'ye taşınan bilet yalnızca doğru talep klasöründe bulunmalı. Kaldırılan atama sonrası PDF havuza dönmeli. Servis yeniden başlatılınca aynı durumu tekrar işlemek dosyayı çoğaltmamalı veya kaybetmemeli. Windows'ta kilitli dosya, eksik PDF, erişim hatası ve geçersiz kişi adı test edilmeli.

### T10 — Yerel servis durumu ve Explorer komut teyidi ekle

**Öncelik:** Yüksek. **Kanıt:** KOD + TASARIM.

**Bulgu:** Tek bir `explorer_cmd` yuvası ve zaman penceresi var; yeni komut eskisini ezebilir. Bulutta komutun kaydedilmesi, klasörün gerçekten açıldığını göstermiyor. Doğrudan localhost ve bulut üzerinden tetikleme aynı işlemi iki kez açabilir. Servis açılışında mevcut komutun atlanması bekleyen işlemi etkileyebilir.

**İş:** Benzersiz işlem kimliği, hedef maç/istemci, oluşturulma/son kullanma zamanı, alınma/başarı/hata teyidi tanımla. İhtiyaca uygun kalıcı kuyruk veya eşdeğer mekanizma kullan. Tekrarlanan komutları idempotent işle. Yerel servis için son görülme/bağlantı ve PDF hazırlık durumunu panele taşı. Komut güncellemeleri atama durumunu ezmemeli; T06 ile uyumlu olmalı.

**Kabul:** Panel “İstek alındı”, “PDF hazırlanıyor”, “Klasör açıldı”, “Yerel servis çevrimdışı” ve “İşlem başarısız” durumlarını ayırmalı. İki hızlı talep komutu kaybolmamalı veya yanlış klasör açmamalı. Aynı komut iki kanal üzerinden gelirse tek işlem olmalı. Windows yeniden başlatma sonrası servis başlatma yöntemi ve durum kontrolü belgelenmeli.

## 8. UI/UX geliştirme görevleri

### U01 — Mobil yönetim panelindeki sayfa taşmasını gider

**Öncelik:** Yüksek. **Kanıt:** CANLI.

**Bulgu:** 390 piksel genişlikte kararlı mobil ölçümde `document.documentElement.scrollWidth = 1086`; ekran genişliği 390. Üst görünüm sekmeleri ve blok özeti sağa taşıyor. Sorun yalnızca koltuk planının kendi yatay kaydırması değil, tüm sayfanın taşması.

**İş:** Flex/grid minimum genişliklerini, toolbar sarılmasını, sabit genişlikleri ve mobil çekmece konumunu düzelt. Koltuk planını kendi kaydırılabilir sahnesinde tut. Genel `overflow-x: hidden` ile erişilemeyen kontrolleri gizlemek çözüm sayılmamalı. Talep çekmecesi kapalıyken görünümden ve klavye odağından çıkmalı; açıkken ekran içine oturmalı.

**Kabul:** 360, 390 ve 430 pikselde kök belge yatay taşmamalı; tüm temel kontrollere erişilmeli. Yatay kaydırma yalnızca gerekli koltuk sahnesinde olmalı. Çekmece aç/kapa, arka plan etkileşimi ve uzun liste kullanımı düzgün çalışmalı. Masaüstü düzeni bozulmamalı.

### U02 — Masaüstü üst menüde kesilen araçları erişilebilir yap

**Öncelik:** Yüksek. **Kanıt:** CANLI.

**Bulgu:** 1440 ve 1366 pikselde üst sağ araç grubu ekran dışına uzanıyor; ekran görüntülerinde sağdaki aksiyonlar kesiliyor. 1920 pikselde daha fazla kontrol görünmesi sorunu ortadan kaldırmıyor.

**İş:** Üst bardaki öncelikleri yeniden düzenle; maç seçimi ve günlük temel aksiyonları görünür tut. PNG/ZIP, klasör, arşiv ve hesap araçlarını anlaşılır gruplara veya “Diğer işlemler” menüsüne taşı. Azalan genişlikte metinleri kaldırıp açıklamasız simgeye dönüştürmek tek çözüm olmamalı.

**Kabul:** 1280, 1366, 1440 ve 1920 pikselde hiçbir eylem ekran dışında kalmamalı. Maç adı anlaşılır gösterilmeli; kesilirse tam adına erişilmeli. Menü klavye ve dokunmayla çalışmalı. Bilet yükleme, dağıtım ve hesap işlemleri bulunabilir olmalı.

### U03 — Portalın gizli kontrollerinin görünmesini düzelt

**Öncelik:** Yüksek. **Kanıt:** CANLI.

**Bulgu:** Personel seçilmeden `#selectedPersonBadge` boş rozet ve “Temizle” butonuyla görünüyor. `#selectStaffDropdown` küçük boş native select olarak listelerin altında görünüyor. `#btnClearStaffSearch` arama boşken görünüyor. Üçünde de `hidden` sınıfı olmasına karşın computed display gizli değil. Başarı modalı ise başlangıçta gerçekten gizli; bütün gizleme davranışları topluca bozuk kabul edilmemeli.

**İş:** Ortak gizleme sözleşmesini ve CSS önceliğini düzelt. Kullanılmayan uyumluluk alanını görsel ve erişilebilirlik ağacından çıkar; gerekli veri bağımlılığını koru. Boş durum kontrollerini yalnızca anlamlı olduğunda göster.

**Kabul:** İlk açılışta boş rozet, temizleme düğmesi ve uyumluluk select'i görünmemeli/odak almamalı. Personel seçildiğinde doğru rozet görünmeli; seçim temizlendiğinde kalkmalı. Arama temizleme düğmesi yalnızca arama doluyken görünmeli. Modal/sekme/PWA gizleme davranışları da regresyon kontrolünden geçmeli.

### U04 — Mobil ve klavye erişilebilirliğini tamamla

**Öncelik:** Yüksek. **Kanıt:** KOD + CANLI.

**Bulgu:** Yönetici viewport tanımı yakınlaştırmayı kapatıyor. Mobil koltuk yüksekliği CSS'te 34 piksel, kişi etiketi 8 piksel; canlıda isimler küçük ve çok satırlı. Bazı kontroller yalnızca simge/title ile açıklanıyor.

**İş:** Kullanıcı yakınlaştırmasını aç. Önemli dokunma hedeflerini tercihen en az 44×44 CSS piksel yap veya eşdeğer rahat etkileşim alanı sun. Koltuk için satır, numara, kişi ve talep bilgisini okunabilir ayrıntı alanında göster. Klavye odağı, semantik butonlar, sekmelerde `aria-selected`, modal diyalog semantiği, odak yönetimi, Escape ve odağın geri dönmesini tamamla. Durumları yalnızca renkle anlatma. Normal metinde 4,5:1, büyük metinde ve gerekli arayüz bileşenlerinde uygun WCAG kontrastını doğrula. Durum/hata bildirimlerini erişilebilir canlı bölgelerle sun; gereksiz odak çalma yapma.

**Kabul:** Temel portal ve admin akışları klavyeyle kullanılmalı. Kapalı panel/modal içindeki elemanlara Tab ile gidilmemeli. %200 yakınlaştırmada temel kontrollere erişilmeli. Renk ayırt edemeyen kullanıcı seçili/boş/atanmış durumları metin veya işaretten anlayabilmeli. Dokunmatik kaydırma yanlışlıkla atama veya kontrolsüz seçim üretmemeli.

### U05 — Personel seçimini tek ve anlaşılır akışa indir

**Öncelik:** Orta. **Kanıt:** TASARIM + CANLI.

**Bulgu:** Ad yazma, ayrı arama, grup akordeonları, rozet ve uyumluluk select'i aynı ihtiyacı tekrarlıyor. Altı personel grubunun listesi formun büyük kısmını kaplıyor.

**İş:** Tek aramalı personel seçimi tasarla. Ad/soyad ve Türkçe karakter araması çalışsın; uygun sonuç yoksa “Bu isimle devam et” yolu sun. Grup gezintisi gerekiyorsa ikincil ve katlanabilir kalsın. Serbest isim ile gerçek personel hesabı/yetkisi birbirine karıştırılmasın; T01 ile uyumlu olsun. Hatırlanan kullanıcı bilgisi anlaşılır biçimde gösterilsin ve temizlenebilsin.

**Kabul:** Personel en az adımla bulunup seçilebilmeli; seçim, arama ve temizleme tutarlı olmalı. Sonuç yoksa açıklama gösterilmeli. Seçim başka kişinin telefonunu yanlış taşımamalı. İki aynı adlı kişi varsa ayırt edici güvenli bilgi gösterilmeli.

### U06 — Portal formunu kısalt, telefon ve blok beklentisini netleştir

**Öncelik:** Orta. **Kanıt:** CANLI + TASARIM.

**Bulgu:** Mobil portal yaklaşık 1806 piksel yüksekliğinde; 844 piksel yüksek ekranda gönder butonu yaklaşık 1699 piksel aşağıda. Maç adı mobil select içinde kesiliyor. WhatsApp numarası isteniyor ancak alanın zorunluluğu ve kayıtlı numara kullanımı açık değil. Blok tercihi kesin tahsis gibi algılanabilir.

**İş:** Formun dikey yoğunluğunu azalt; tek maç varsa seçili maçı kısa okunabilir özet olarak göster. Uzun maç adının tamamına erişim sağla. İsim akışını U05 ile kısalt. Adet, blok ve telefon temel alanlar; not ikincil kalsın. Blok altına müsaitliğe göre değerlendirme açıklaması ekle. Aktif maçın gerçekten desteklediği blokları göster; “Fark etmez” sunucu tarafında anlamlı çalışsın. Kayıtlı numaranın maskeli özetini ve değiştirme yolunu göster; yoksa WhatsApp teslimi için numara iste. Sabit gönder alanı kullanılırsa klavye ve güvenli ekran alanını örtmesin.

**Kabul:** 390 pikselde portalın kökünde yatay taşma olmamalı. Tarih/salon özeti okunmalı. Telefon boş/geçersizken kullanıcı ne yapacağını anlamalı; hata ilgili alanın yanında kalmalı. Talep bloğu kesin tahsis sözü vermemeli. Bilet adedi düzeltmesi korunmalı. Gönderim sürerken buton çift gönderimi engellemeli; ağ hatasında form kaybolmamalı.

### U07 — WhatsApp başlatma ile gerçek gönderim kaydını ayır

**Öncelik:** Yüksek. **Kanıt:** KOD + TASARIM.

**Mevcut kural:** Kılavuza göre WhatsApp butonu açılınca talep hemen gönderilmiş işaretleniyor. Bu, önceki tasarım tercihidir; gerçek teslimat teyidi değildir. Bu görev, bilinçli bir iş akışı iyileştirmesi olarak ele alınmalıdır.

**İş:** “WhatsApp'ı ve klasörü aç” ile “Gönderildi olarak işaretle” işlemlerini ayır. Sohbet/klasör açılması sonrasında operatöre açık gönderim tamamlama aksiyonu sun. Otomatik teslimat iddiasında bulunma. `request_id` ile gönderim zamanı ve mümkünse işlemi yapan yönetici kaydedilsin. Yanlış işaretleme geri alınabilsin. Mobil Web Share tamamlanmasının da WhatsApp teslim kanıtı olmadığını dikkate al.

**Kabul:** Sohbeti açıp iptal eden kullanıcının talebi Gönderilen Talepler'e taşınmamalı. Operatör tamamladığında yalnızca ilgili talep taşınmalı. Yerel servis çevrimdışıyken klasör açıldı mesajı verilmemeli. Eski gönderim kayıtları korunmalı; geçmişi doğrulanmış teslimat olarak yeniden adlandırma.

### U08 — Talep kartlarını talep kimliği ve ilerleme etrafında düzenle

**Öncelik:** Yüksek/Orta. **Kanıt:** CANLI + TASARIM.

**İş:** Kartın üstünde ad ile birlikte `request_id` göster. Maç, talep adedi, atanan adet, eksik adet ve blok okunabilir olsun. Örnek: “Örnek Personel · ZS-257 / 6 istendi · 4 ayrıldı · 2 eksik”. Duruma uygun tek ana aksiyon göster: “Koltuk ata”, “Eksik 2 koltuğu tamamla” veya “WhatsApp'ı aç”. Düzenle, sil, kaldır gibi ikincil/yıkıcı aksiyonları uygun menüye al. Şu an Gönderilen Talepler kartlarında buton satırları sağa kesiliyor; sığma ve sarılmayı düzelt.

**Kabul:** Aynı kişinin iki talebi ilk bakışta ayırt edilebilmeli. 380–390 piksel panel genişliğinde metin/aksiyonlar kesilmemeli. Kısmi talepte tamamlama, kalan adet kadar atama yapmalı. Atanmış talepte mevcut koltukları görüntülemek kolay olmalı. Silme/kaldırmanın kapsamı işlem öncesi açık olmalı.

### U09 — Sayaçları ve durum dilini tek sözleşmeye bağla

**Öncelik:** Orta. **Kanıt:** KOD + CANLI + TASARIM.

**Bulgu:** “Dağıtılan”, “Dolu”, “Gönderilen”, “Boş/Diğer”, “Atanan Koltuk” ifadeleri farklı aşamaları benzer gösteriyor. Blok özetinde “Boşta/Diğer” ve ayrıca “Boş” sayılması kapasiteyi yorumlamayı zorlaştırabiliyor.

**İş:** Sunucu verisi ve UI için ortak tanımlar yap. En az “Atama bekliyor”, “Kısmen atandı (4/6)”, “Koltuklar hazır”, “Gönderildi olarak işaretlendi” ayrımı olsun. Kapasite, PDF'si bulunan bilet, atanmış koltuk, sanal koltuk, boş koltuk ve eksik PDF sayısını karıştırma. Gelen Talepler sekmesinin atanmış ama gönderilmemiş talepleri de içerdiğini yardımcı metinle açıkla. Her sayının birimini yaz: kişi, talep, koltuk veya bilet.

**Kabul:** Aynı maçta kartlar, sekme sayaçları, üst özet, blok özeti ve dağıtım merkezi birbirini tutmalı. Kısmi atama tamamlanmış görünmemeli. Gönderilmemiş atanmış talep kaybolmamalı. Filtrelenmiş ve genel toplamın kapsamı anlaşılmalı.

### U10 — Başarı ekranı ve güvenli talep takibi ekle

**Öncelik:** Orta. **Kanıt:** CANLI sayfanın yapısı + KOD + TASARIM; gerçek başarı modalı canlıya talep gönderilerek açılmadı.

**Bulgu:** Başarı modalında takip kodu var; görünür bir takip akışı yok. “Tamam (Yeni Talep Gönder)” iki farklı niyeti aynı düğmede birleştiriyor.

**İş:** Talep kodu kopyalama, güvenli “Talebimi görüntüle” ve ayrı “Başka talep oluştur” eylemleri sun. Başarı metni talebin alındığını, biletin henüz kesinleşmediğini ve sonraki iletişim kanalını açıklasın. Takip mekanizması T01/T05'e bağlıdır; herkese açık isim veya sıralı kod araması üzerinden özel bilgi gösterme. Hata durumunda modal yerine düzeltilebilir açıklama göster.

**Kabul:** Kopyalama geri bildirimi olmalı. Kullanıcı kendi talebinin bekleyen/kısmi/hazır/gönderildi durumunu anlayabilmeli; başka talebe erişememeli. Yeni talep aynı kişinin mevcut talebini değiştirmemeli. Modal odağı ve klavye davranışı U04'e uymalı.

### U11 — Koltuk atama ve kaydırma/takas akışını açıklaştır

**Öncelik:** Orta. **Kanıt:** CANLI seçim görünümü + TASARIM.

**İş:** Aktif talebi, gereken adet ve seçilen koltuk sayısını aynı yerde göster. Atama öncesinde hedef kişi/talep/blok ve koltukları okunabilir özetle. Seçim ile kaydırma/takas modu açıkça ayırt edilsin; adım yönergesi ve vazgeçme yolu bulunsun. Gereğinden az/fazla seçimde ne olacağı önceden anlaşılsın. Saha yönü sabit ve anlaşılır kalsın. Yanlış işlemi geri alma varsa gerçek API desteğini doğrula; çalışanmış gibi görünen ancak no-op kalan geri al/ileri al kontrolleri bırakma.

**Kabul:** Seçim temizleme ve Escape çalışmalı. Mod değişiminde eski geçici seçim hedefi yanlış işlemi tetiklememeli. Koltuk tıklama/sahne boşluğu tıklama karartmayı sıfırlamalı. Sürükleme ve mobil kaydırma birbirini bozmamalı. Başarısız atamada UI eski doğru duruma dönmeli. Sunucu koltuk sahipliğini T06 kapsamında tekrar doğrulamalı.

### U12 — Görsel hiyerarşi, tekrar eden yollar ve geri bildirimleri düzenle

**Öncelik:** Orta/Düşük. **Kanıt:** CANLI + TASARIM.

**İş:** Zeren mor marka dili, beyaz boş koltuklar ve tutarlı grup renkleri korunsun. Salon haritası ve WhatsApp dağıtımına tekrar eden erişimler bağlama göre sadeleşsin; farklı kapsamlı eylemler aynı etiketle gösterilmesin. Uzun kullanımda küçük metin ve yoğun rozetleri azalt. Yerel servis durumu, devam eden işlem, boş liste, arama sonucu yok, hata ve tekrar deneme için ayrı geri bildirim tasarla. Yıkıcı işlemleri ana aksiyondan görsel olarak ayır; kapsamı açık onay veya güvenilir geri alma sun. Toast tek başına kalıcı hata kanalı olmasın. PWA yükleme önerisi formu veya mobil klavyeyi örtmesin.

**Kabul:** Kullanıcı her ekranın ana işini ve sonraki adımını anlayabilmeli. Boş liste, bağlantı hatası ve filtre sonucu yok birbirine karışmamalı. İşlem sürerken çifte tıklama engellenmeli; başarı yalnızca gerçek sonuçtan sonra gösterilmeli. Mobilde yalnız hover/title ile anlaşılabilen temel kontrol kalmamalı.

## 9. Bakım, geçiş ve dağıtım görevleri

### M01 — Statik kopya senkronizasyonunu otomatikleştir

**Öncelik:** Orta. **Kanıt:** Depo yapısı + kılavuz.

Tek kaynak dosyaları ve hedeflerini açıkça tanımlayan bir senkronizasyon komutu oluştur. Kopyaların eşitliğini denetleyen kontrol ekle; farklı hedefe özgü içerikleri körlemesine ezme. `app.js`, `styles.css`, `admin.html`, portal dosyaları ve PWA varlıklarını gerçek dağıtım yollarıyla kapsa. Vercel kökü, `static/`, `biletistiyorum/`, onun altındaki `static/` ve `bilet_app/static/` referanslarını doğrula.

**Kabul:** Tek komut ilgili kopyaları üretmeli; eksik veya farklı kopya kontrolde yakalanmalı. Hem Vercel hem yerel Windows sunucusu aynı sürümün davranışını sunmalı. Komut ve kaynak/hedef tablosu kılavuza yazılmalı.

### M02 — Büyük dosyaları davranışı koruyarak böl

**Öncelik:** Orta/Düşük. **Kanıt:** KOD.

`app.js` yaklaşık 2865, `server.py` yaklaşık 2646 satır. Hata düzeltmelerinden sonra kimlik doğrulama, talep/atama, dağıtım, maç yönetimi, UI oluşturma ve senkronizasyonu anlaşılır sorumluluklara ayır. Yeni framework veya gereksiz bağımlılık ekleme. Bulut/yerel API'lerin aynı isimli uçlarında davranış farklarını belgeleyip ortak sözleşmeye yaklaştır. Gerçek çalışma yollarıyla uyuşmayan kılavuz bölümlerini güncelle.

**Kabul:** URL ve mevcut iş akışları korunmalı veya kontrollü uyumluluk katmanı olmalı. Statik kopyalar/modül yükleme Vercel ve yerel sunucuda çalışmalı. Bölme işi iş mantığı değişikliklerinden gözden geçirilebilir şekilde ayrılmalı.

### M03 — Güvenli veri geçişi, PWA güncellemesi ve yayın raporu

**Öncelik:** Her aşamada zorunlu.

- Veri modeli/RLS değişikliği için sürümlü migration ve gerekli geri dönüş yolunu hazırla; mevcut veriyle uyumlu geçiş planı oluştur.
- Parola, telefon, PDF veya bilet kodlarını rapora, ekran görüntüsü paylaşımına, test fixture'ına veya loglara gereksiz şekilde koyma. Temsili veriler kullan.
- Yedek ve doğrulama tamamlanmadan eski sistem satırını, kişi bazlı gönderim bilgisini veya bilet klasörlerini topluca silme.
- PWA cache sürümünü gerekli dağıtımlarda güncelle; mevcut istemcinin güncel dosyayı gerçekten aldığını test et. Sürekli önbellek temizlemeyi kullanıcıya yükleme.
- Kılavuz tamamlanan geliştirmelerin anlamlı commit ile `main` dalına push edilmesini istiyor; `main` push'u Vercel dağıtımını tetikliyor. Uygulama oturumundaki güncel kullanıcı yetkisi ve depo kurallarıyla birlikte değerlendir. Bu belgeyi yazmak tek başına üretim migration'ı çalıştırma veya canlı veri değiştirme talimatı değildir.
- Commit'e yalnızca ilgili değişiklikleri dahil et. Mevcut kullanıcı değişikliklerini, sırları, gerçek PDF'leri ve geçici tarayıcı dosyalarını ekleme.
- Push, başarılı build, Vercel dağıtımı ve canlı doğrulama ayrı aşamalardır; her birinin gerçek sonucunu raporla. Windows üzerinde test edilmemiş işi tamamlanmış gösterme.

## 10. Zorunlu test ve doğrulama matrisi

Testler mümkün olduğunca sahte personel ve test maçlarıyla, test veritabanı/klasörleri üzerinde yapılmalıdır. Gerçek WhatsApp mesajı veya canlı talep oluşturmak regresyon testi değildir.

| ID | Senaryo | Beklenen sonuç |
|---|---|---|
| V01 | Anonim/boş sorguyla talep listesi | Özel kayıtlar dönmez; yetki sınırı korunur. |
| V02 | Başkasının adı veya talep koduyla sorgu | Başka kişinin özel talebine erişilmez. |
| V03 | Logout, süre dolumu, parola değişimi | Eski oturumlar belirlenen politikaya göre geçersizleşir. |
| V04 | Yanlış HTTP yöntemi / bilinmeyen rota | Mutasyon oluşmaz; doğru 404/405 döner. |
| V05 | Supabase okuma/yazma hatası | Sessiz başarı veya boş veriyle ezme yok; form korunur. |
| V06 | Paralel talep oluşturma / aynı POST'u tekrar deneme | Çakışan ID veya istenmeyen çift talep oluşmaz. |
| V07 | İki yönetici aynı koltuğu atar | Tek atama geçerli; diğer işlem kontrollü çakışma alır. |
| V08 | İki yönetici farklı koltukları atar | Her iki değişiklik de kalıcıdır. |
| V09 | Aynı kişinin iki bağımsız talebi | Atama, tamamlama, gönderim ve silme birbirini etkilemez. |
| V10 | Kısmi talebi tamamla | Yalnız eksik adet atanır; başka talebin koltuğu sayılmaz. |
| V11 | Takas/kaydırma; dolu hedef veya yanlış sayıda hedef | Veri kaybı ve sessiz sahiplik ezmesi olmaz. |
| V12 | İki maçta aynı koltuk; maç değiştir | Talepler, dosyalar, durumlar ve sayaçlar ayrı kalır. |
| V13 | Yeni maç, boş plan, ZIP/PDF yükleme | Doğru maça bağlanır; desteklenmeyen işlem sahte başarı vermez. |
| V14 | Windows atama, yeniden atama, kaldırma, yeniden başlatma | PDF doğru yerde; dosya kaybı/çoğalma yok. |
| V15 | Eksik/kilitli PDF, geçersiz yol adı | Güvenli hata ve tekrar deneme; kök dışına erişim yok. |
| V16 | Yerel servis kapalı; sonra yeniden bağlı | Durum doğru görünür; yanlış klasör açıldı mesajı yok. |
| V17 | İki hızlı Explorer komutu / aynı komut iki kanaldan | Komut kaybı veya çift açılış yok. |
| V18 | WhatsApp'ı aç, gönderme ve vazgeç | Talep otomatik gönderildi sayılmaz. |
| V19 | Gönderildi işaretle / geri al | Yalnız ilgili request_id ve sayaçlar güncellenir. |
| V20 | Adet alanını sil; 30 ve 100 yaz; Enter ve blur | Yazma engellenmez; geçerli adet doğru gönderilir. |
| V21 | Adet artı/eksi, hazır adetler, boş/0/101 | Sınırlar ve aktif hızlı seçenekler tutarlı. |
| V22 | İlk portal açılışı, personel seç/temizle, arama | Gizli kontroller görünmez; sonuç yok durumu anlaşılır. |
| V23 | 360/390/430 px mobil ve 768 px tablet | Kök yatay taşma yok; panel ve ana aksiyonlara erişilir. |
| V24 | 1280/1366/1440/1920 px masaüstü | Üst menü ve kart aksiyonları kesilmez. |
| V25 | Dokunmatik kaydırma, seçim, mod değiştirme, Escape | Seçim/atama kazası yok; mevcut davranışlar korunur. |
| V26 | Klavye, modal odak yönetimi, %200 zoom | Temel akışlar erişilebilir; odak kaybı/tuzak yok. |
| V27 | Sayaçlar, üç sekme, kişi özeti, filtreler | Adet/birim ve kapsamlar aynı veriyi doğru temsil eder. |
| V28 | Başarı ekranı, takip, yeni talep | Kayıt sonrası net adım; güvenli erişim ve bağımsız yeni talep. |
| V29 | Eski PWA oturumu ve yeni dağıtım | Güncel dosyalar alınır; eski cache davranışı sürmez. |
| V30 | Statik kopya eşitliği; Vercel ve yerel servis | Hedefler aynı sürümü sunar; referanslar kırılmaz. |

İlgili değişiklikler için anlamlı birim/entegrasyon testleri ve gerçek tarayıcı senaryoları ekle. Sadece uygulama kodunu tekrar eden testlerle güvence varmış gibi davranma. Windows oturumu ve Explorer için gerçek Windows kabul testi gerekir; Linux üzerindeki mock test bunun yerine geçmez.

## 11. Agent çalışma yöntemi ve teslim biçimi

1. Güncel kılavuz, çalışma ağacı, commit ve gerçek dosya yollarını kontrol et.
2. Bu belgedeki görevleri başlangıçta **bekliyor / sürüyor / tamamlandı / engelli** olarak takip et. Tümünü tek bir belirsiz “iyileştirme yapıldı” ifadesiyle kapatma.
3. Her görevi mevcut davranış, hedef davranış, değişen dosyalar ve kabul testiyle somutlaştır.
4. Veri/kimlik/maç geçişlerinde eski kayıtların korunmasını doğrula; geri dönüş planını kaydet.
5. Bağımsız ve küçük değişikliklerle ilerle; yalnız bu görevin gerektirdiği kapsamda refactor yap.
6. İlgili statik kopyaları aynı değişiklikte güncelle ve kontrol et.
7. Testleri tamamla; izin verilen yayın adımlarını uygula; gerçek canlı görünümü yeniden incele.
8. Son teslimde aşağıdaki şablonu kullan:

```markdown
## Tamamlanan işler
- Görev ID'si — davranış değişikliği — ilgili dosyalar — commit/PR

## Doğrulama
- Test/senaryo — ortam — sonuç
- Tarayıcı genişlikleri ve doğrulanan ekranlar
- Windows üzerinde doğrulanan PDF/Explorer işlemleri

## Veri ve uyumluluk
- Migration ve mevcut kayıtların korunması
- API ve statik kopya uyumluluğu
- PWA güncelleme sonucu

## Yayın durumu
- Commit/push, build, dağıtım ve canlı doğrulamanın ayrı sonuçları

## Açık kalanlar
- Görev ID'si — neden eksik — gerekli erişim/karar — uygulanabilir sonraki adım
```

## 12. Son kabul kontrol listesi

- [ ] T01–T10 teknik görevleri kabul kriterleriyle tamamlandı.
- [ ] U01–U12 UI/UX görevleri kabul kriterleriyle tamamlandı.
- [ ] M01–M03 bakım, geçiş ve yayın gereksinimleri karşılandı.
- [ ] Önceden tamamlanan bilet adedi düzeltmesi korunuyor.
- [ ] Aynı kişinin çoklu talebi ve farklı maçlar birbirinden izole.
- [ ] Anonim erişimde personel verisi veya sistem durumu açığa çıkmıyor.
- [ ] Kalıcı kayıt başarısızlığı hiçbir yerde başarı olarak sunulmuyor.
- [ ] Paralel atamalarda veri kaybı veya çift koltuk tahsisi yok.
- [ ] PDF ve Explorer akışı gerçek Windows üzerinde doğrulandı.
- [ ] WhatsApp başlatma ile operatörün gönderim kaydı ayrıldı.
- [ ] Mobilde kök belge taşmıyor; masaüstünde menü ve kart aksiyonları kesilmiyor.
- [ ] Portalda boş seçim rozeti ve uyumluluk select'i görünmüyor.
- [ ] Klavye, dokunma, yakınlaştırma ve durum erişilebilirliği doğrulandı.
- [ ] Tüm dağıtım kopyaları ve PWA sürümü uyumlu.
- [ ] `CODEX_PROJECT_GUIDE.md` gerçek dosya/API/veri yapısıyla güncel.
- [ ] Eksik doğrulamalar ve erişim engelleri açıkça listelendi; test edilmemiş işler tamamlandı sayılmadı.
