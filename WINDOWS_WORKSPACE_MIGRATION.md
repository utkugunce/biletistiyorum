# Windows çalışma klasörünü düzenleme ve taşıma

Hedef düzen:

```text
C:\projects\
  biletistiyorum\           Program ve Git deposu
  Zeren_Bilet_Maclar\       Aktif maçlar ve talep PDF klasörleri
  Zeren_Bilet_Arsiv\        Eski kişi klasörleri ve taşıma kayıtları
```

`scripts/migrate_windows_workspace.py` Python standart kütüphanesini kullanır.
İlk çalıştırma yalnızca önizlemedir. Kaynak klasörde:

```powershell
python scripts/migrate_windows_workspace.py --source . --destination C:\projects\biletistiyorum
```

Önizleme doğruysa önce eski Python servisi durdurulur. Ardından aynı komuta
`--apply` eklenir. Çalışan 8765 servisi, dolu hedef veya bozuk sahiplik kaydı
varsa işlem durur. Windows yetki hatasında kaynak klasör üzerinde değişiklik
yapılmaz; hata giderilmeden sonraki adıma geçilmez.

Araç kaynakları silmez. Program ve maçları geçici alanda kopyalayıp SHA-256 ile
doğrular; doğrulama sonrası yeni konumları yayınlar. Kopyadaki yerel storage
içinde `last_folder` ve kayıtlı maç yolları güncellenir. Her maçın sahiplik
journal'ındaki `root`, aynı göreli PDF düzeninin doğrulanmış yeni köküne
bağlanır. Dosya sahipliği, içerik özetleri ve komut geçmişi korunur. Sadece bir
klasörün adını değiştirip journal dosyasını silmek bu işlemin karşılığı değildir.

Git'in izlemediği ve PDF içeren eski kişi klasörleri arşive ayrılır. Program
klasörleri, izlenen kaynaklar ve `tickets` havuzu yerinde kalır. Program kökü
aktif veya journal/maç planı ile yönetilen bir maçsa içindeki PDF klasörleri
yeniden gruplanmaz; göreli konumları korunur. Sembolik link/junction ayrı
inceleme gerektirir ve bu araçla taşınmaz. Önbellek klasörleri yeni kopyaya
alınmaz; kaynak kopyada kalır.

Doğrulama kaydı `Zeren_Bilet_Arsiv\Tasima_Kayitlari` altındadır. Kaynak ve hedef
yollarıyla dosya özetlerini içerir; dosya içerikleri veya sırlar rapora yazılmaz.
Yerel storage ve telefon defteri korunur; bunları geliştirme commit'lerine
eklemeyin. Vercel/Supabase ayarları değişmez.

Taşıma sonrasında yeni PowerShell penceresinde gerekirse kullanıcı ortam
ayarlarını yükleyip servisi yeni konumdan çalıştırın:

```powershell
Set-Location C:\projects\biletistiyorum
$env:ZEREN_COMPANION_TOKEN = [Environment]::GetEnvironmentVariable("ZEREN_COMPANION_TOKEN", "User")
$env:ZEREN_CLOUD_URL = "https://biletistiyorum.vercel.app"
python bilet_app/server.py
```

Canlı panelde servis bağlantısı, doğru maç/PDF klasörü, WhatsApp ve gönderim
işareti kontrol edilir. Eski servis aynı anda başlatılmaz. Eski başlatıcı veya
kısayollar yeni konuma yönlendirilmelidir. Eski klasör bu kabul tamamlanmadan
silinmez; geri dönüşte yeni servis durdurulup eski konumdaki servis başlatılır.

Geçici depolarla testler; önizlemede yazmama, mevcut hedefi koruma, checksum
hatasında yayınlamama, bozuk journal, aktif servis, eski root maç, arşiv ayrımı,
kimlik bilgilerinin korunması ve yeni köke journal bağlama senaryolarını kapsar.
Windows'taki gerçek taşıma ve yeniden başlatma kabulü ayrıca yapılmalıdır.
