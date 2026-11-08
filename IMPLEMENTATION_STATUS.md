# Uygulama ve doğrulama durumu — 8 Kasım 2026

Bu belge `ZEREN_GELISTIRME_VE_AGENT_DEVIR_PLANI.md` içindeki geçmiş inceleme
bulgularını güncel kod ve gerçek doğrulama durumuyla eşler. Kodun testte geçmesi,
üretimdeki izinlerin veya Windows masaüstünün doğrulandığı anlamına gelmez.

| Kapsam | Uygulanan davranış | Doğrulama / kalan bağımlılık |
|---|---|---|
| T01 | Yönetici listesi korunur; personel takibi tek talebe özel gizli anahtar ister; özel statik dosya yolları kapalıdır. | API negatif testleri geçti. Özel dosya yollarının canlı koruması doğrulandı. Yeni takip API'si güvenli backend yayınıyla devreye girecek. |
| T02 | scrypt parola hash'i, rastgele süreli oturum, sunucuda iptal, deneme sınırı, HttpOnly çerez, localStorage token temizliği. | Bulut ve yerel auth testleri geçti. Üretim başlangıç parolası Vercel'de tanımlanmalı. |
| T03 | Yöntem/Origin kontrolleri, dar yerel erişim ve yetkili companion API; anonim tablo izinlerini kaldıran SQL hazır. | API testleri geçti. Supabase RLS/GRANT geçişi kullanıcı tarafından uygulandı; rol yetkileri ekran görüntüsüyle, anonim REST erişimi 401 ile doğrulandı. |
| T04–T05 | Veri hatasında açık hata; boş snapshot/bellek fallback yok; sunucu UUID'si ve idempotent kayıt. | Kesinti, geçersiz girdi ve yeniden gönderim testleri geçti. |
| T06–T07 | PostgreSQL koşullu UPDATE ile CAS; atama, düzenleme, silme ve gönderim ortak snapshot'ta; request_id izolasyonu. | Aynı/farklı koltuk yarışları, aynı kişinin çoklu talebi, kısmi atama, eski kaydı silme ve dolu hedef testleri geçti. |
| T08 | Maça özel atama/şablon, dinamik envanter, fiziksel/sanal ayrımı, açıkça desteklenmeyen bulut işlemlerinde hata. | İki maç izolasyonu ve envanter testleri geçti. Windows klasörü bulut match_id'sine bağlanmalı. |
| T09 | Kalıcı maç bazlı dosya sahipliği, atomik kayıt, üzerine yazmayan taşıma, yeniden başlatmada geri dönüş ve manuel dosya koruması. | Geçici klasörlerde regresyonlar geçti. Gerçek Windows/PDF kabulü bekliyor. |
| T10 | Heartbeat, maç/talep bazlı kuyruk, komut sonucu, kayıp teyitte kalıcı dedup, Explorer başarısızlığını bildirme. | Kuyruk/tekrar deneme/eksik PDF testleri geçti. Etkileşimli Windows masaüstü kabulü bekliyor. |
| U01–U04 | Mobil/masaüstü kontrollerinin sığması, gizli kontroller, modal odak/Escape, klavye sekmeleri ve koltuk seçimi. | Sekiz genişlikte Chromium testi geçti; canlıdaki bağımsız responsive düzeltmeler doğrulandı. |
| U05–U06 | Katlanır personel dizini, kısa form, görünür telefon zorunluluğu, maça uygun blok listesi ve müsaitliğe göre tercih. | Portal ve 30 bilet gönderim senaryosu sahte API ile geçti; canlıya talep gönderilmedi. |
| U07–U10 | WhatsApp açma ile gönderildi işareti ayrı; kartlar request_id/adet/ilerleme gösterir; tek gönderim durumu ve güvenli takip bağlantısı. | API tutarlılık ve tarayıcı başarı/takip testleri geçti. Gerçek mesaj gönderilmedi. |
| U11–U12 | Başarısız atamada seçim korunur; sunucu hedef sahipliğini doğrular; geri alma yeteneği gerçek desteğe göre kapalı; boş arama ve güvenli metin gösterimi düzeltildi. | API, klavye/Escape, boş arama, HTML enjeksiyonu ve bağlantı hatası senaryoları geçti. |
| M01 | Kaynak/kopya eşlemeleri tek scriptte; API yardımcıları ve ortak erişilebilirlik dosyası dahil. | `sync_copies.py --check` geçti. |
| M02 | Bulut veri/auth/işlemler `lib/` altında; Windows köprüsü, dosya mutabakatı ve envanter ayrı modüllerde; ortak erişilebilirlik ayrı dosyada. | Davranış testleri ve sözdizimi kontrolleri geçti. Mevcut ekran ve FastAPI controller dosyaları korunuyor. |
| M03 | Sürümlü izin migration'ı, ortam örneği, geçiş/geri dönüş/kabul kılavuzu, PWA v4 ve doğrulama komutları. | Üretim ayarları ve gerçek Windows kabulü tamamlanmadan tam geçiş bitmiş sayılmaz. |

## Yayınlanan bağımsız değişiklikler

- `3128969`: Yerel özel kayıtların dağıtımdan çıkarılması ve özel yolların korunması.
- `e63452d`: Kalıcı Windows dosya sahipliği ve başarısız geri taşımaların tekrarı.
- `559dc6d`: Responsive yönetim kontrolleri ve ortak klavye erişilebilirliği.
- `10deec3`: Boş dağılım araması ve güvenli metin gösterimi; çalışma dosyalarını hariç tutma.

Bu commit'ler `main` dalına gönderildi. Windows kodunun güncellenmesi için yerel
kurulum ayrıca güncellenip yeniden başlatılmalıdır; Vercel bunu yapmaz.

## Güvenli backend yayını

`fix/secure-ticket-workflow`, `fb8c425` korumalarıyla birleştirilerek `c0c9ec7`
commit’iyle `main` dalına alındı. Kullanıcı Production ve Preview ortam
değişkenlerini Vercel’e ekledi. Tam geçiş sırası
`DEPLOYMENT_CHECKLIST.md` dosyasındadır. Gizli anahtarlar Git'e veya sohbete
konulmamalıdır. Mevcut talepler/sistem snapshot'ı ve manuel PDF'ler topluca silinmez.

Otomatik sonuç: 40 Python testi, 40 Node API testi, sekiz ekran genişliğinde
Chromium senaryoları ve kopya/sözdizimi kontrolleri geçti. Bunlar taklit veritabanı
ve geçici dosyalarla çalışır. Üretim Supabase politikası, Vercel ortam kurulumu,
yetkili gerçek backend erişimi ve Windows Explorer kabulü ayrı adımlardır.

## Son main korumalarıyla birleştirme

`fb8c425` içindeki güvenlik başlıkları, statik personel dizini önbelleği ve
IP başına talep/takip sınırları güvenli backend ile birleştirildi. Dinamik maç
listesi yalnız başarılı yanıtta en çok beş dakika edge cache kullanır; hata
önbelleğe alınmaz. Origin kontrolünde alt dizeye güvenilmez. IP sayaçları
hash'li ve boyutu sınırlı süreç belleğindedir; dağıtık DDoS koruması değildir.
Üretim için Vercel edge koruması ayrıca yapılandırılabilir.

Kullanıcı, üretim geçişinden önce Supabase tablosunun 12 kaydını yerel dosyaya
yedeklediğini doğruladı. Vercel Preview'da dört ortam ayarı eklendikten sonra
maç listesi API'sinin veritabanından başarılı yanıtı kullanıcı tarafından
korumalı önizleme tarayıcısında doğrulandı. Bu doğrulama henüz üretim RLS
geçişi veya Windows kabulü anlamına gelmez.

## Üretimde kod doğrulaması

8 Kasım 2026 tarihinde `c0c9ec7` üretime gönderildi. Canlı Vercel API'sinde
maç listesi 200 ve dinamik blok listesi döndürdü; anonim yönetici state ve gizli
takip anahtarı olmayan talep sorgusu 401 döndürdü. Yetkisiz auth/check false
sonucu verdi. Legacy JWT kontrolü, sunucuya anon anahtarının yapılandırılmasını
reddeder; bu canlı sonuç service_role ile okuma yolunun çalıştığını gösterir.

**Kalan geçiş adımları:** Kullanıcının Supabase SQL migration'ını çalıştırması,
anonim tablo erişiminin kapandığının doğrulanması, yeni parolayla yönetici giriş
kontrolü ve Windows köprüsünün güncellenip gerçek PDF/Explorer kabulünün yapılması.
Bu adımlar bu kayıtta henüz tamamlandı sayılmaz. Windows güncellenene kadar
eski servisin durdurulması gerekir; RLS geçişinden sonra eski anonim köprü çalışmaz.

## Windows bağlantısı ve telefon rehberi uyumluluğu

Kullanıcı üretimde yeni parolayla giriş yapıp verilerin göründüğünü doğruladı.
Windows kurulumu `d4b1b33` sürümüne fast-forward ile güncellendi. Companion anahtarı
Windows'a tanımlandı ve yetkili maç listesi alındı. Eski Python servisi durduruldu;
aktif Kuzeyboru maç klasörünün ayrı yerel yedeği alınıp `cloud_match_id` bağlandı.
Yeniden başlatma sonrasında kullanıcı canlı panelde “Yerel Servis: Bağlı” gördü.
Gerçek PDF/Explorer kabulü henüz tamamlanmadı.

İlk gönderim kontrolünde telefonların görünmediği bildirildi. Geçişte atlanan
legacy rehber fallback'i geri bağlandı: talebe özel numara önceliklidir; boşsa
özelleştirilmiş rehber, ardından mevcut temel rehber kullanılır. Admin özeti,
dağıtım merkezi ve companion listesi aynı çözümlemeyi kullanır. Bu okuma hiçbir
telefon kaydını değiştirmez. Belirsiz kısa isim birden fazla farklı telefonla
eşleşiyorsa rastgele numara seçilmez. Dağıtım ekranının beklediği bilet adedi,
koltuk açıklaması ve gönderim yüzdesi alanları da sözleşmeye eklendi.

Telefon önceliği, eski rehber, companion görünümü, belirsiz isim ve dağıtım alanları
regresyonlarıyla Node API testlerinin sayısı 40 oldu. Son düzeltmenin canlı
telefon görünümü kullanıcıyla ayrıca doğrulanmalıdır.

Son eşzamanlı Windows retry değişikliği birleştirilirken beş kez atomik replace
tekrarı korundu; kalıcı kilitte journal dosyasını atomik olmayan copy ile ezme
fallback'i kaldırıldı. Kilitli journal'ın tüm denemeler sonrasında aynı içerikle
korunduğu regresyonla doğrulandı. Bu nedenle Python test sayısı 40 oldu.

## Gerçek Windows kabulü ve eski arayüz önbelleği

Kullanıcı telefonların tekrar göründüğünü; WhatsApp'ın doğru kişiye açıldığını,
Gezgin'de ilgili talep klasörünün açıldığını ve PDF'lerin içinde olduğunu
bildirdi. Gönderim işaretleme düğmesi ise ekran görüntüsünde görünmedi.
Canlı sunucudaki güncel JS düğmeyi içeriyordu; görüntüde yeni takip bağlantısı
düğmesinin de olmaması eski istemci paketine işaret etti.

Admin/portal JS ve CSS referansları sürümlendi. Ortak `pwa-update.js`, iki
sayfada da worker güncellemesini kontrol eder; doldurulmuş formu otomatik
reload ile silmez. PWA v5 HTML/JS/CSS'i network-first alır, çevrimdışıyken
önbellek kullanır. API'ler önbelleğe girmez; çevrimdışı yanıt 503'tür. Opsiyonel
CDN dosyası başarısızlığı tüm yerel precache işlemini iptal etmez.

Gerçek Chromium testine gönderildi işaretleme ve geri alma eklendi. Ayrı bir
worker testi v4 önbelleğinde eski admin/JS başlatarak v5'e yükseltmeyi, yeni
online paketin cache'i geçmesini ve offline davranışı kontrol eder. Bunlar
canlı talep değiştirmez veya mesaj göndermez. Gönderim düğmesinin üretimdeki
kullanıcı tarayıcısında görünmesi ayrıca doğrulanacaktır.

## Windows klasör düzenleme ve taşıma hazırlığı

Kullanıcı bütün bileşenleri `C:\projects\biletistiyorum` altında toplamak istedi.
Kod `Uygulama`, maçlar `Zeren_Bilet_Maclar`, eski kişi klasörleri ve kayıtlar
`Arsiv` altında hazırlanır. Dışarıda kalıcı program/maç/arşiv hedefi yoktur.
Tek başlatıcı kullanıcı ortamındaki anahtarı yükler; anahtarı dosyaya yazmaz.
Önizleme ve doğrulanmış kopya aracı 10 taşıma regresyonuyla doğrulandı; toplam
Python testi sayısı 50 oldu. Windows taşıması doğrulama kaydıyla tamamlandı. Kullanıcı yeni başlatıcıyla
servisin bağlandığını ve PDF klasörünün yeni konumdan açıldığını doğruladı.

## Yönetim üst bölümü ve talep sekmelerinin yerleşimi

Talep sekmeleri eşit genişlikte kutulara ayrıldı; simge/sayaç ve başlık ayrı
satırlarda tutuluyor. Üç haneli sayaçta dahi başlıklar birbirine taşmıyor.
Üst menü maç/işlem ve görünüm/özet olarak sabit satırlara ayrıldı. Yeni Maç,
maç bilgisinin yanında kalır; tarih seçicide tekrar etmez ve mobilde görünür.
Blok kontrolleri ile metrik özeti ayrı hizalanır. Salon haritasına geçiş ana
görünüm sekmesinde korunarak tekrarlanan araç çubuğu düğmesi kaldırıldı.

Sekiz genişlikte gerçek Chromium testi; metin/sayaç çakışması, taşma, menü,
tarih, modal, gönderim işareti ve temel akışları doğruladı. PWA güncelleme ve
offline davranışı testi de geçti. Statik kopyalar eşitlendi; önbellek sürümü v6.
Bu değişiklik fiziksel PDF düzenini veya Windows senkronizasyonunu değiştirmez.
