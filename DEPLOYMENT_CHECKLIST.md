# Üretim geçişi ve kabul kontrolü

Bu geçişte uygulama kodu, veritabanı izinleri ve Windows servisi birlikte ele
alınmalıdır. `main` dalına push Vercel dağıtımını tetikler. Yönetim bağlantısı ve
ortam ayarları doğrulanmadan güvenli backend dalı üretime alınmamalıdır.

## 1. Uygulanan bağımsız koruma

`.vercelignore` yerel `bilet_app/` kayıtlarını ve çalışma dosyalarını dağıtım
haricinde bırakır. Vercel rewrite kuralları özel klasör yollarını da kapatır.
Telefon defteri, yerel oturum dosyası ve yerel talep JSON'ları webden statik
olarak sunulmamalıdır. Daha önce erişilebilir olan veriler için Git geçmişi
ayrıca kurumun veri yönetimi politikasına göre değerlendirilmelidir.

## 2. Vercel sunucu ayarları

Gizli değerleri sohbete, Git'e veya istemci JavaScript'ine yazmayın.

| Değişken | Nerede | Açıklama |
|---|---|---|
| `SUPABASE_URL` | Vercel | Mevcut projenin URL'si. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yalnız Vercel | Veritabanına yetkili sunucu erişimi. Windows'a verilmez. |
| `ZEREN_ADMIN_PASSWORD` | Yalnız Vercel | İlk geçişte en az 12 karakterlik yeni yönetici parolası. Üretimde bilinen varsayılan parola kullanılmaz. |
| `ZEREN_COMPANION_TOKEN` | Vercel ve Windows | Aynı, en az 32 karakterlik rastgele companion anahtarı. Örneğin yerel güvenli terminalde `secrets.token_urlsafe(48)` ile üretilebilir. |

Yeni backend ilk başarılı girişte parolayı scrypt ile hash'ler; düz metin alanı
kaldırır. Oturumlar 7 gün süreli, rastgele, sunucuda yalnız hash'i saklanan
anahtarlardır. Çıkış ve parola değişimi eski oturumları iptal eder. Eski
HMAC/localStorage oturumları yeniden giriş gerektirir. Başlangıç parolası
ortam değişkeni, daha sonra UI'den değiştirilen parolayı sessizce sıfırlamaz.

## 3. Supabase erişim geçişi

1. Mevcut tablo izinlerini ve `__SYSTEM_STATE__` satırının yedeğini proje
   sahibinin güvenli yönetim ortamında alın; özel verileri Git'e koymayın.
2. Vercel ayarlarını ve yeni sürümün yetkili sunucu erişimini doğrulayın.
   Eski sürüm geçici olarak çalışacaksa onun kullandığı `SUPABASE_KEY` de
   sunucuda yetkili anahtar olmalıdır; eski public fallback'e güvenmeyin.
3. Yeni backend'i önce yapılandırılmış önizleme/test ortamında doğrulayın.
4. Üretim kodunu yayınlayın ve `migrations/001_protect_portal_requests.sql`
   dosyasını Supabase SQL Editor veya bağlı yönetim aracıyla çalıştırın.
   Geçiş hiçbir talebi veya sistem JSON'unu silmez; anonim tablo erişimini
   kaldırır. Sunucunun `service_role` erişimi devam eder.
5. Publishable/anon anahtarıyla sistem satırı ve talep tablosu artık okunup
   yazılamamalıdır. Yetkili backend ise talep oluşturma ve yönetimi sürdürmelidir.
6. Bir izin hatasını düzeltmek için anonim tablo erişimini yeniden açmayın.
   Önce sunucu anahtarını ve dağıtım ayarlarını kontrol edin.

Geri dönüş gerekirse önce yetkili erişimi kullanan uygulama sürümünü hazırlayın.
Eski public anahtarlı koda dönmek için veritabanını herkese açmayın.

## 4. Veri sözleşmesi ve eski kayıtların korunması

- İlk talep satırı kalıcı alım kaydıdır. Atama, gönderim, düzenleme ve silme
  kararlarının ortak doğruluk kaynağı sürümlü `__SYSTEM_STATE__` JSON'udur.
- Düzenlemeler `request_overrides`; silmeler `deleted_requests` altında tutulur.
  Silinen talep API'lerde görünmez ve yalnız ona ait atamalar kaldırılır;
  ilk alım satırı denetim/geri kazanım için yerinde kalır.
- Admin listesi, dağıtım merkezi, personel takibi ve Windows köprüsü aynı
  snapshot'tan hesaplanan durumu kullanır. SQL'den yalnız eski talep satırının
  `status/assigned_seats` alanını okumak güncel tahsisi temsil etmez.
- Kayıt, JSON `version` değerine koşullu PostgreSQL UPDATE ile yapılır. Çakışan
  işlem güncel snapshot'la yeniden değerlendirilir; soğuk süreçte okuma hatası
  boş durum üretemez. Yeni tablo veya RPC kurulumuna ihtiyaç yoktur.
- Eski talep ID'leri değişmez. Yeni talepler UUID tabanlı `ZS-...` kimliği alır.
  Aynı formun tekrar gönderilmesi aynı idempotency anahtarıyla tek kayıt üretir.
- İlk maçın eski kök atamaları korunur. Yeni maçlar ayrı `match_states` alanı
  kullanır. Bilinmeyen eski maç adı aktif maça otomatik bağlanmaz; kendi maç
  kaydıyla eşleştirilmelidir.
- Kişi adına dayanan eski gönderim işaretleri tüm taleplere otomatik yayılmaz.
  Belirsiz geçmiş operatörce talep bazında kontrol edilmelidir.
- Personel artık yalnız kod veya telefon numarasıyla özel talebe erişemez.
  Yeni talebin başarı ekranında güvenli takip bağlantısı verilir. Eski talep
  için yönetici kartındaki “Takip bağlantısı” butonu yeni erişim bağlantısı
  üretir; bu işlem o talebin eski bağlantısını geçersizleştirir.

## 5. Windows güncellemesi

1. Yerel servisi durdurup güncel `bilet_app/` dosyalarını alın. Yeni
   `folder_sync.py`, `ticket_inventory.py` ve `cloud_bridge.py` dahil olmalıdır.
2. `ZEREN_COMPANION_TOKEN` ve `ZEREN_CLOUD_URL` ayarlarını yerel güvenli ortamda
   tanımlayın. Service-role anahtarını Windows bilgisayarına kurmayın.
3. Her maçın `mac_bilet_plani.json` dosyasında `cloud_match_id` bulunmalıdır.
   Buluttaki maç ID'si yönetici state'inin `match_info.match_id` alanındadır.
   Tek maçlı bir servis için `ZEREN_MATCH_ID` kullanılabilir; farklı maç
   klasörlerine aynı ID'yi uygulamayın. Eşleşmeyen klasör senkronize edilmez.
4. Servisi operatörün etkileşimli Windows oturumunda başlatın. Varsayılan
   dinleme adresi `127.0.0.1:8765` olmuştur. LAN erişimi gerçekten gerekiyorsa
   `ZEREN_BIND_HOST` ve izin verilen kökenler ayrıca bilinçli yapılandırılmalıdır.
5. `.zeren-folder-sync.json` maç klasörüyle birlikte korunmalıdır. Dosya yalnız
   uygulamanın sahipliği bilinen PDF'lerini izler; bilinmeyen manuel dosyalar
   geçmiş atama varsayılarak taşınmaz. İlk yükseltmeden önce kaldırılmış bir
   atamanın geçmişi yoksa otomatik geri taşıma yapılmaz; operatör kontrol eder.
6. Yerel portal talepleri de yetkili cloud bridge üzerinden eşitlenir. Yerel
   veritabanı dosyaları cache/projeksiyondur; ağ hatası kalıcı cloud başarısı
   gibi gösterilmez.
7. Yerel yönetim panelinin atama, kaydırma, talep düzenleme/silme ve gönderim
   işlemleri de aynı bulut snapshot'ına yönlendirilir. Dosya yükleme ve maç
   klasörü seçimi yereldir. Servis PDF adları/koltuk şemasını envanter olarak
   raporlar; PDF içeriği veya mutlak dosya yolu göndermez. Elle düzenlenmiş kişi
   klasörlerindeki PDF'ler otomatik atamaya karşı ayrılmış görünür.
8. Yerel servis heartbeat ve komut sonucunu buluta bildirir. Birden fazla
   Explorer isteği saklanır; tekrarlanan ağ teyidi klasörü yeniden açtırmaz.
   Eksik PDF veya açılamayan Explorer başarı diye gösterilmez. En fazla üç
   başarısız denemeden sonra operatör yeni istek verebilir.

## 6. Otomatik kontroller

```bash
python scripts/verify_all_tasks.py
python scripts/verify_all_tasks.py --browser
```

Python testleri geçici klasörler kullanır; Node testleri veritabanını taklit
eder. Chromium testi gerçek HTML/JS/CSS'i açar, API'leri test verisiyle karşılar.
Canlı personele mesaj veya gerçek talep göndermez. Tarayıcı testinin ortamında
Playwright ve Chromium bulunmalıdır; `CHROMIUM_EXECUTABLE` ile binary seçilebilir.
Proxy CA'sı gereken yönetilen test ortamlarında yalnız ortamın bilinen güven
zinciri kurulmalıdır; genel TLS doğrulaması kapatılmamalıdır.

## 7. Yayın sonrası kontrol

```bash
python scripts/check_production.py
# SUPABASE_ANON_KEY ve SUPABASE_URL güvenli ortamda tanımlıysa:
python scripts/check_production.py --check-anon-database
# ZEREN_ADMIN_PASSWORD ortamda tanımlıysa (giriş/çıkış oturum testi):
python scripts/check_production.py --authenticated
```

Ek olarak gerçek Windows'ta şu kabul testleri gerekir:

- İki maçta aynı koltuk birbirinden bağımsız taşınır.
- Aynı kişinin iki talebi farklı klasörlerde ve gönderim durumlarında kalır.
- Kilitli PDF'nin kilidi kalkınca bekleyen işlem tekrar denenir.
- Servis kapalıyken kaldırılan, kayıt altında olan atama açılışta havuza döner.
- Manuel dosya, farklı içerikli hedef dosya ve başka maçın klasörü korunur.
- İki hızlı klasör isteği kaybolmaz; doğru talebin klasörü etkileşimli masaüstünde
  açılır. Komutun başlatılması WhatsApp teslimatı anlamına gelmez.
- WhatsApp'tan vazgeçilince talep gönderildi sayılmaz. Operatörün açık işareti
  sonrası admin, dağıtım ve personel takip ekranı aynı durumu gösterir.

Bu kontroller gerçekten yapılmadan Windows kabulü veya üretim RLS geçişi
“tamamlandı” olarak raporlanmamalıdır.
