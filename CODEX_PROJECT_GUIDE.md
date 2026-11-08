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
5. **Durum Takibi:** Biletleri WhatsApp üzerinden gönderilen talepler ana listeden "Gönderilen Talepler" sekmesine otomatik aktarılır.

---

## 2. Çift Katmanlı Hibrit Mimari (Dual-Tier Hybrid Architecture)

Sistem iki ana parçadan oluşur ve Supabase üzerinden gerçek zamanlı haberleşir:

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
│  │   Supabase'deki `virtual_assignments` haritasını okur.                  │
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
- Form gönderildiğinde Supabase `portal_requests` tablosuna benzersiz `ZS-XXX` formatında `request_id` ile `status: "pending"` olarak eklenir.

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
- **Şifre Koruması:** `ZEREN_ADMIN_PASSWORD` (Varsayılan: `zeren2026`). HMAC SHA-256 token üretilir (`zeren_admin_token`).
- Token `localStorage` ve Cookie'de saklanır; sayfa yenilendiğinde parola tekrar sorulmaz.
- `/api/state`: Aktif maç durumunu, blokları, biletleri ve atamaları döner.
- `/api/excel/summary`: Portal taleplerini Supabase'den çeker, atanan koltukları eşleştirir, WhatsApp gönderim durumlarını (`sent_map`) işler.
- `/api/excel/assign-request`: Talebe seçili koltukları veya ardışık boş koltukları otomatik bağlar.
- `/api/open-explorer`: Yerel Windows Gezgini'ni tetiklemek için `__SYSTEM_STATE__` kaydına `explorer_cmd` yazar.

### 3.4. Yerel Arka Plan Servisi (`bilet_app/server.py`)
- Python 3 + FastAPI tabanlı yerel daemon (Port 8765).
- **Otomatik Senkronizasyon Döngüsü (`_auto_folder_sync_loop`):**
  - Her 1.5 saniyede bir Supabase'deki `__SYSTEM_STATE__` kaydını sorgular.
  - Yeni bir atama varsa, ana maç klasöründeki PDF biletleri otomatik olarak `<Kişi>/<request_id>/` klasörüne taşır.
  - Buluttan gelen `explorer_cmd` emrini yakalayarak ilgili klasörü kullanıcının masaüstünde `explorer.exe` ile açar (`desktop_helper.py`).

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
  "admin_password": "...",
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
  "explorer_cmd": {
    "id": "1731055000",
    "group": "Kerem Taha Solmaz",
    "request_id": "ZS-257",
    "ts": 1731055000000
  }
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
│   └── portal.js            # Talep formu REST API işleyicisi
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
   - Gönderim yapıldığı an talep `sent_map` içine kaydedilir ve "Gönderilen Talepler" sekmesine taşınır.
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
*(Sunucu 0.0.0.0:8765 adresinde çalışır ve yerel maç klasörünü dinler).*

---

## 8. Otomatik Commit & Push Kuralı
Bu depoda tamamlanan her geliştirme, hata düzeltmesi veya UI iyileştirmesi sonrasında değişiklikler kullanıcıdan onay beklenmeksizin otomatik olarak `git add .`, anlamlı bir commit mesajı ile `git commit` ve ardından `git push origin main` yapılarak uzak depoya aktarılmalıdır.
