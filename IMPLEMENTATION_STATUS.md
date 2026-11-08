# Uygulama ve doğrulama durumu — 8 Kasım 2026

Bu belge `ZEREN_GELISTIRME_VE_AGENT_DEVIR_PLANI.md` içindeki geçmiş inceleme
bulgularını güncel kod ve gerçek doğrulama durumuyla eşler. Kodun testte geçmesi,
üretimdeki izinlerin veya Windows masaüstünün doğrulandığı anlamına gelmez.

| Kapsam | Uygulanan davranış | Doğrulama / kalan bağımlılık |
|---|---|---|
| T01 | Yönetici listesi korunur; personel takibi tek talebe özel gizli anahtar ister; özel statik dosya yolları kapalıdır. | API negatif testleri geçti. Özel dosya yollarının canlı koruması doğrulandı. Yeni takip API'si güvenli backend yayınıyla devreye girecek. |
| T02 | scrypt parola hash'i, rastgele süreli oturum, sunucuda iptal, deneme sınırı, HttpOnly çerez, localStorage token temizliği. | Bulut ve yerel auth testleri geçti. Üretim başlangıç parolası Vercel'de tanımlanmalı. |
| T03 | Yöntem/Origin kontrolleri, dar yerel erişim ve yetkili companion API; anonim tablo izinlerini kaldıran SQL hazır. | API testleri geçti. **Supabase RLS/GRANT geçişi uygulanmadı; yönetim bağlantısı gerekiyor.** |
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

## Güvenli backend dalı

`fix/secure-ticket-workflow`, yönetim erişimi gerektiren geçiş kodunu içerir.
Üretim yapılandırması olmadan `main` dalına alınmamalıdır. Tam geçiş sırası
`DEPLOYMENT_CHECKLIST.md` dosyasındadır. Gizli anahtarlar Git'e veya sohbete
konulmamalıdır. Mevcut talepler/sistem snapshot'ı ve manuel PDF'ler topluca silinmez.

Otomatik sonuç: 39 Python testi, 36 Node API testi, sekiz ekran genişliğinde
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
