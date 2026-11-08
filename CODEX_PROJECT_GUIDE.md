# ZEREN SPOR KULÜBÜ — BİLET DAĞITIM VE KOLTUK YÖNETİM SİSTEMİ
## Kapsamlı Proje Mimarisi, Akış ve Geliştirici Kılavuzu (Internal Documentation)

> **DİKKAT:** Bu proje **Zeren Spor Kulübü** bünyesinde maç biletlerinin (özellikle Başkent Voleybol Salonu maçları) personele, sponsorlara ve misafirlere tahsisi, koltuk planlaması ve WhatsApp üzerinden dağıtımı için geliştirilmiş **şirket içi (internal)** özel bir sistemdir.

---

## 1. Projeye Genel Bakış ve Çözülen Problem

### 1.1. Arka Plan
Zeren Spor Kulübü, ev sahibi olduğu voleybol müsabakaları için bilet satış platformundan (Biletinial) toplu bilet PDF'leri indirmektedir. Bu biletler:
- Standart tribün blokları (Örn: **102 Blok** - 106 koltuk, **121 Blok** vb.)
- VIP ve Saha Kenarı tribünleri (**Saha İçi A** ve **Saha İçi B** sıraları)
gibi farklı lokasyonlarda yer almaktadır.

### 1.2. Çözülen Temel Problemler
1. **Çoklu Talep Yönetimi:** Kulüp personeli portal üzerinden aynı maç için birden fazla zaman diliminde talep oluşturabilir (Örn: Neslihan önce 2 bilet istedi, atandı; daha sonra 6 bilet daha istedi). Sistem her talebi bağımsız bir `request_id` (Örn: `ZS-257`) ile yönetir; talepler birbirine karışmaz veya kısmi atama hatası üretmez.
2. **Görsel ve Etkileşimli Koltuk Seçimi:** Admin panelinde tribün blokları sıra ve koltuk numaralarıyla (1-15, 27-52 vb.) birebir görselleştirilir. Koltuklar tıklanarak veya fare sürüklenerek seçilir, kişilere tek tıkla atanır.
3. **Fiziksel Dosya Senkronizasyonu (Windows Köprüsü):** Biletler buluttaki admin panelinde atandığı anda, adminin yerel Windows bilgisayarındaki maç klasöründe otomatik olarak `<Kişi Adı>\<request_id>\` klasörleri açılır ve ilgili bilet PDF'leri fiziksel olarak bu klasörlere taşınır.
4. **WhatsApp ile Tek Tıkla Dağıtım:** Admin panelindeki WhatsApp butonuna basıldığında:
   - İlgili personelin WhatsApp sohbet penceresi açılır (`whatsapp://send?phone=...`).
   - Adminin Windows masaüstünde personelin o talebine ait bilet klasörü otomatik olarak açılır. Admin biletleri doğrudan sohbete sürükleyip bırakabilir.
5. **Durum Takibi:** Operatör "Gönderildi olarak işaretle" dediğinde yalnız ilgili talep "Gönderilen Talepler" sekmesine aktarılır. Sohbeti/klasörü açmak teslimat teyidi değildir.

---

## 2. Çift Katmanlı Hibrit Mimari (Dual-Tier Hybrid Architecture)

Sistem iki ana parçadan oluşur. Supabase erişimi yalnız Vercel sunucusundadır; Windows, yetkili companion API üzerinden polling yapar:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       1. BULUT KATMANI (Cloud Layer)                        │
│                                                                             │
│  [Personel Portalı]               [Admin Paneli]                            │
│  biletistiyorum.vercel.app/portal  biletistiyorum.vercel.app                │
│             │                               │                               │
│             └───────────────┬───────────────┘                               │
│                             ▼                                               │
│                  Vercel Serverless API (/api/*)                             │
│                  (api/admin.js - Node.js ESM)                               │
│                             │                                               │
│                             ▼                                               │
│             Supabase Veritabanı (PostgreSQL / REST)                         │
│             Tablo: `portal_requests` (Talepler & `__SYSTEM_STATE__`)        │
└─────────────────────────────────────┬───────────────────────────────────────┘
                                      │ Gerçek Zamanlı Polling (1.5 sn)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│               2. YEREL WINDOWS KATMANI (Local Companion Layer)              │
│                                                                             │
│  FastAPI Yerel Sunucu (bilet_app/server.py - 127.0.0.1:8765)                │
│                                                                             │
│  ├── sync_helper.py:                                                        │
│  │   Yetkili companion API’den maçın atamalarını okur.                     │
│  │   Yerel diskteki PDF'leri `<Kişi Adı>/<request_id>/` klasörüne taşır.    │
│  │                                                                          │
│  └── desktop_helper.py:                                                     │
│      Windows Session 1 (WinSta0\Default) masaüstü köprüsünü kurar.          │
│      Admin WhatsApp'a bastığında doğru bilet klasörünü Gezgin'de açar.      │
│                                                                             │
│  Yerel Maç Klasörü: C:\...\121 BLOK\ (Bilet PDF'leri)                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Bileşenler ve Görev Dağılımı

### 3.1. Personel Talep Portalı (`portal.html` / `/bilet-istiyorum` / `/talep`)
- Kulüp personelinin maça bilet talep ettiği mobil uyumlu web arayüzü.
- **Alanlar:** Ad Soyad, Departman / Görev, WhatsApp Telefon No, Talep Edilen Blok (Örn: 102 Blok, Saha İçi), Bilet Adedi, Not / Açıklama.
- Form gönderildiğinde Supabase `portal_requests` tablosuna sunucuda üretilen UUID tabanlı `ZS-...` formatında `request_id` ile `status: "pending"` olarak eklenir.

### 3.2. Yönetici Paneli (`admin.html` + `app.js` + `styles.css`)
- **Üst Menü (Primary Topbar):**
  - Zeren Spor logosu ve marka rozeti.
  - Maç Seçici dropdown'ı.
  - "Yeni Maç" modalı ve "Bilet Yükle" (ZIP arşivi veya PDF yükleme).
  - Görünüm Sekmeleri: **Koltuk Planı** (`seating`) ve **Salon Haritası** (`arena`).
  - Maç istatistik rozetleri (Toplam Bilet, Dolu, Boşta, Dağıtılan Kişi).
- **İkinci Kontrol Menüsü (Secondary Toolbar):**
  - Tüm ekran genişliğinde uzanır.
  - Blok seçici (102 Blok, Saha İçi vb.) ve aktif blok hapları.
  - Blok Kapasite Özeti (Kapasite, Dolu, Boş).
  - Mod Değiştirici: **Seçim** (`select`) ve **Kaydır / Takas** (`shift`).
  - Renklendirme Modu: Grup Renkleri / Klasik Mod.
  - "Orijinal Şema" önizleme butonu.
- **Koltuk Izgarası Sahnesi (`seating-view`):**
  - Saha yönü göstergeleri (Üst/Alt/Yan saha bantları).
  - Koltuk hücreleri (`seat-cell`): Sıra ve koltuk numarası, kişi etiketi.
  - Çoklu seçim desteği (Shift + Tık aralık seçimi, fare sürükleyerek seçim).
  - Koltuk karartma (dimming) koruması: Herhangi bir koltuğa veya sahne boşluğuna tıklandığında soluklaştırma kalkar, normal görünüme dönülür.
- **Sağ Yan Panel (3 Sekmeli Talep & Dağıtım Takibi):**
  1. **Gelen Talepler (Bekleyenler):** Henüz WhatsApp ile biletleri gönderilmemiş, atanmayı bekleyen talepler. Koltuk Ata butonu, Koltuklar (önizleme) butonu, WhatsApp gönderim butonu, Düzenle ve Sil aksiyonları.
  2. **Gönderilen Talepler:** WhatsApp üzerinden biletleri teslim edilmiş tamamlanmış talepler. Yeşil sayaç rozeti taşır.
  3. **Dağıtım Özeti:** Kişi bazlı gruplanmış toplam bilet dökümü, Tek PDF birleştirme, ZIP indirme ve atama kaldırma araçları.

### 3.3. Bulut Backend (`api/admin.js` - Vercel Serverless)
- Tüm admin yetkilendirme ve state yönetimini sağlar.
- **Şifre Koruması:** İlk üretim geçişinde `ZEREN_ADMIN_PASSWORD` en az 12 karakterle zorunludur. Parola scrypt hash olarak tutulur.
- `zeren_admin_token` rastgele, 7 gün süreli HttpOnly/Secure çerezdir; sunucuda yalnız hash ve süre saklanır. Token localStorage’a yazılmaz. Çıkış/parola değişimi oturumları iptal eder.
- `/api/state`: Aktif maç durumunu, blokları, biletleri ve atamaları döner.
- `/api/excel/summary`: Portal taleplerini Supabase'den çeker, atanan koltukları eşleştirir, WhatsApp gönderim durumlarını (`sent_map`) işler.
- `/api/excel/assign-request`: Talebe seçili koltukları veya ardışık boş koltukları otomatik bağlar.
- `/api/open-explorer`: Yerel Windows Gezgini'ni tetiklemek için ilgili maçın kalıcı `explorer_commands` kuyruğuna benzersiz komut yazar.

### 3.4. Yerel Arka Plan Servisi (`bilet_app/server.py`)
- Python 3 + FastAPI tabanlı yerel daemon (Port 8765).
- **Otomatik Senkronizasyon Döngüsü (`_auto_folder_sync_loop`):**
  - Her 1.5 saniyede bir yetkili `/api/companion/state` endpoint’inden bağlı maçın atamalarını ve komutlarını sorgular.
  - Yeni bir atama varsa, ana maç klasöründeki PDF biletleri otomatik olarak `<Kişi>/<request_id>/` klasörüne taşır.
  - Buluttan gelen maç/talep bazlı kuyruk komutlarını işleyerek ilgili klasörü kullanıcının masaüstünde `explorer.exe` ile açar (`desktop_helper.py`).

---

## 4. Veritabanı ve State Mimarisi (Supabase)

Tüm bulut durumu Supabase'deki `portal_requests` tablosunda saklanır:

### 4.1. Talep Satırları (`id != '__SYSTEM_STATE__'`)
| Kolon | Tip | Açıklama |
|---|---|---|
| `id` | text (PK) | Benzersiz talep ID'si (Örn: `ZS-257`) |
| `person` | text | Talep sahibi personel adı |
| `department` | text | Departman / Görev bilgisi |
| `phone` | text | WhatsApp telefon numarası |
| `target_block` | text | Tercih edilen blok (Örn: `102`, `Saha İçi`) |
| `requested_count` | int | İstenen bilet adedi |
| `status` | text | `"pending"` veya `"assigned"` |
| `assigned_seats` | jsonb | Atanan koltuk ID'leri dizisi `["7-1", "7-2", ...]` |
| `description` | text | Ekstra not / açıklama |

### 4.2. Sistem Durumu Satırı (`id = '__SYSTEM_STATE__'`)
Sistem çapındaki dinamik ayarlar tek bir özel satırın `assigned_seats` jsonb alanında tutulur:
```json
{
  "version": 1,
  "admin_password_hash": "<scrypt salt:hash>",
  "sessions": {"<token hash>": {"expires_at": 0}},
  "virtual_assignments": {
    "102:7-1": {
      "group": "Kerem Taha Solmaz",
      "subgroup": "",
      "request_id": "ZS-257"
    }
  },
  "sent_map": {
    "ZS-257": true
  },
  "custom_phones": {
    "Kerem Taha Solmaz": "0533..."
  },
  "explorer_commands": [{
    "id": "<uuid>",
    "match_id": "20261108_kuzeyboru",
    "group": "Örnek Personel",
    "request_id": "ZS-257",
    "status": "pending",
    "attempts": 0,
    "ts": 0
  }],
  "request_overrides": {},
  "deleted_requests": {},
  "tracking_access": {},
  "match_states": {},
  "match_templates": {}
}
```

---

## 5. Dizin Yapısı ve Dosya Haritası

```
121 BLOK/
├── admin.html               # Yönetici Paneli HTML şablonu (Kök dizin)
├── app.js                   # Yönetici Paneli Frontend mantığı ve UI kontrolcüsü
├── styles.css               # Yönetici Paneli CSS stilleri ve responsive kuralları
├── portal.html              # Kulüp Personeli Bilet Talep Formu
├── api/
│   ├── admin.js             # Vercel Serverless API (Tüm /api/* rotalarını yönetir)
│   ├── base_state.json      # Varsayılan koltuk ve blok verisi (102 Blok & Saha İçi)
│   ├── request.js           # İdempotent talep alımı
│   └── my-requests.js       # Gizli takip anahtarıyla tek talep görüntüleme
├── lib/                     # store.js (CAS/veri), auth.js, admin-actions.js
├── bilet_app/               # Yerel Windows Eşlikçi Uygulaması
│   ├── server.py            # FastAPI yerel sunucu (Port 8765) + senkronizasyon döngüsü
│   ├── sync_helper.py       # Supabase -> Yerel disk bilet taşıma mantığı
│   ├── desktop_helper.py    # Windows Explorer'ı kullanıcı oturumunda açma köprüsü
│   ├── tickets_parser.py    # Biletinial PDF bilet dosya adı ayrıştırıcısı
│   └── static/              # Yerel server tarafından servis edilen statik kopyalar
├── biletistiyorum/          # Vercel dağıtım çalışma dizini (app.js, styles.css kopyaları)
├── static/                  # Web varlıkları (Logolar, ikonlar, css, js kopyaları)
├── tickets/                 # Bilet PDF'leri havuzu
└── CODEX_PROJECT_GUIDE.md   # Bu teknik dokümantasyon dosyası
```

> **ÖNEMLİ:** `app.js`, `styles.css` veya `admin.html` üzerinde bir değişiklik yapıldığında; bu dosyaların `static/`, `biletistiyorum/` ve `bilet_app/static/` altındaki kopyalarının senkronize tutulması zorunludur.

---

## 6. Kritik İş Mantığı ve Kurallar

1. **Aynı Kişinin Birden Fazla Talebi:**
   - Bir personel (Örn: *Neslihan Erşahin*) daha önce bilet almış olsa bile, yeni talebi bağımsız değerlendirilir.
   - Koltuklar atanırken ve klasörlenirken mutlaka `request_id` baz alınır (`<Kişi>/<request_id>/`).
2. **Koltuk Renkleri:**
   - Boşta olan koltuklar her zaman **beyaz** renktedir.
   - Bir gruba/kişiye atanan koltuklar otomatik renk paletinden (`PALETTE`) canlı bir renk alır.
   - Bir koltuğa tıklanması veya sahne boşluğuna tıklanması, geçici karartma filtresini (`dimmed-group`) derhal sıfırlar.
3. **WhatsApp Dağıtım Protokolü:**
   - WhatsApp butonuna tıklandığında doğrudan tekli dosya indirme yerine; yerel dosya gezgini tetiklenir (`whatsapp://send?phone=...` + Gezgin açılışı).
   - Operatör ayrı “Gönderildi olarak işaretle” eylemiyle `sent_map[request_id]` ve zamanını kaydeder. İşaret geri alınabilir.
4. **Yerel Arka Plan Servisi Sürekliliği:**
   - Windows üzerinde `bilet_app/server.py` arka planda çalışmıyorsa, bulutta atanan biletler yerel klasörlere taşınamaz. Bilgisayar yeniden başladığında servisin ayakta olduğu doğrulanmalıdır.

---

## 7. Dağıtım ve Çalıştırma

### Bulut Dağıtımı (Vercel):
- Depo: GitHub `utkugunce/biletistiyorum`
- Canlı URL: `https://biletistiyorum.vercel.app`
- Otomatik Dağıtım: `main` dalına push yapıldığında Vercel derlemesi otomatik tetiklenir.

### Yerel Servisin Çalıştırılması:
```powershell
cd "c:\Users\UtkuGünçe-ZerenSporK\Downloads\wetransfer_121-blok_2026-10-15_1215\121 BLOK"
python "bilet_app\server.py"
```
*(Sunucu varsayılan olarak 127.0.0.1:8765 adresinde çalışır. Ortam değişkenleri ve maç eşleşmesi için `DEPLOYMENT_CHECKLIST.md` izlenmelidir.)*

---

## 8. Otomatik Commit & Push Kuralı
Bu depoda tamamlanan her geliştirme, hata düzeltmesi veya UI iyileştirmesi sonrasında değişiklikler kullanıcıdan onay beklenmeksizin otomatik olarak `git add .`, anlamlı bir commit mesajı ile `git commit` ve ardından `git push origin main` yapılarak uzak depoya aktarılmalıdır.

---

## 9. Yerel PDF Senkronizasyonu: Kalıcı Sahiplik Kaydı

`bilet_app/folder_sync.py`, uygulamanın yönettiği PDF'leri her maç kökünde ayrı
`.zeren-folder-sync.json` dosyasında takip eder. Dosya Git'e eklenmez; yerel
operasyon verisidir. Bir maçın kaydı başka maçın klasörüne uygulanmaz.

- Buluttan açıkça atanan bir PDF taşınmadan önce kaynak/hedef ve içerik özeti
  atomik olarak kaydedilir. Başarılı taşıma sonrasında kayıt güncellenir.
- Atama kaldırılınca yalnız bu kayıtta sahipliği bilinen, içeriği değişmemiş
  PDF kök havuza döner. Başarısız geri taşıma kayıtta kalır; sonraki döngülerde
  ve servis yeniden başladıktan sonra tekrar denenir.
- Bilinmeyen manuel dosyalar, elle başka yere taşınmış dosyalar ve içeriği
  değiştirilmiş dosyalar eski atama varsayılarak köke taşınmaz. Farklı içerikli
  mevcut hedef dosyanın üzerine yazılmaz; işlem bekler ve konsola hata yazılır.
- Kayıt bozuksa veya başka maç köküne aitse senkronizasyon güvenli şekilde
  durur. Kaydı silerek düzeltmeye çalışmayın; sahiplik geçmişi kaybolur.
- İlk yükseltmede eski sürümün kalıcı geçmişi bulunmadığından, yalnız halen
  bulutta atanmış ve diskte görülen biletler takip altına alınır. Yükseltmeden
  önce kaldırılmış atamalar ile manuel klasörler güvenle ayırt edilemez;
  bunlar otomatik taşınmaz ve operatör tarafından kontrol edilmelidir.

`bilet_app/ticket_inventory.py` hem blok hem havuz isimlerini tam klasör adına
göre tanır. Yalnız kişi klasöründen önceki envanter katmanları kaldırılır:
`Havuz/Kişi/ZS-123` ve `121 BLOK/Kişi/Genel` kişiye atanmış kalır.
`Saha Ekibi` gibi kişi/grup isimleri kısmi kelime eşleşmesiyle envanter sayılmaz.

Regresyon testleri (canlı Supabase veya gerçek bilet klasörüne erişmez):

```bash
python -m unittest discover -s tests -v
python scripts/sync_copies.py --check
```

Bu değişiklikler yerel Python servisindedir. Windows bilgisayarda güncel
`bilet_app` kodu alınmalı; `folder_sync.py` ve `ticket_inventory.py` dahil yeni
dosyalar bulunmalı ve servis yeniden başlatılmalıdır. Vercel dağıtımı yerel
Windows servisini güncellemez. Gerçek Explorer/Windows oturum kabul testi ayrı
yapılmalıdır; Linux üzerindeki dosya testleri bu kabul testinin yerine geçmez.

## 10. Güvenli bulut/yerel sözleşmesi ve yayın bağımlılıkları

- Supabase `service_role` anahtarı yalnız Vercel ortamında tutulur. Windows
  `ZEREN_COMPANION_TOKEN` ile sınırlı companion API’yi kullanır. Üretimde anonim
  tablo erişimi `migrations/001_protect_portal_requests.sql` ile kapatılmalıdır.
- Yetkili yönetim listesi ile personel takibi ayrıdır. Personel yalnız talebe
  özel gizli takip bağlantısıyla erişir; isim, telefon veya ID yetki sağlamaz.
- İlk talep satırı alım kaydıdır. Güncel atama, metadata düzenleme, silme ve
  gönderim tek sürümlü sistem snapshot’ından hesaplanır. `request_overrides`
  değişiklikleri, `deleted_requests` silme işaretlerini tutar. Talep satırının
  eski `status/assigned_seats` alanları doğrudan okunarak güncel durum bulunamaz.
- PostgREST PATCH, JSON `version` koşuluyla atomik compare-and-swap yapar.
  Çakışmalar güncel snapshot üzerinden tekrar değerlendirilir. Okuma/yazma
  hatasında bellek fallback’i veya boş durumla ezme yapılmaz.
- Eski maçın kök atamaları korunur; diğer maçlar `match_states[match_id]` altında
  ayrıdır. Her Windows klasörü kendi `cloud_match_id` değeriyle bağlanır.
- Windows, PDF dosya adlarını ve koltuk şemasını envanter olarak raporlar;
  PDF içeriği ve mutlak yerel yollar buluta gönderilmez. Elle düzenlenen
  klasörlerdeki biletler otomatik atamaya karşı korunur. Yerel adminin atama ve
  talep işlemleri de aynı bulut snapshot’ına uygulanır; bağlantı yokken ikinci
  bir bağımsız başarılı durum üretilmez.
- Bulut dosya yükleme ve geri alma gibi desteklenmeyen işlemlerde açık hata
  döndürür. Fiziksel PDF yükleme/klasör yönetimi Windows panelinde yapılır.
- Ortak erişilebilirlik davranışı `accessibility.js` içindedir. API sorumlulukları
  `lib/` altında ayrılmıştır; yeni framework veya veritabanı tablosu gerekmez.
- `python scripts/sync_copies.py` kök kaynakları dağıtım kopyalarına taşır;
  `--check` eksik/farklı kopyada hata verir. Eşleme tablosu aynı script içindedir.
- PWA sürümü `zeren-bilet-pwa-v4` olmuştur. Çevrimdışı API başarısı taklit edilmez.
- Ortam kurulumu, veri yedeği, RLS geçiş sırası, otomatik kontroller ve gerçek
  Windows kabulü için `DEPLOYMENT_CHECKLIST.md` temel alınır. Yönetim bağlantısı
  olmadan yeni güvenli backend’i üretime almak mevcut sistemi kesebilir;
  önce erişim ve ortam bağımlılıkları tamamlanmalıdır.
