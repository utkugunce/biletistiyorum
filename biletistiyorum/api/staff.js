export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ detail: "GET yöntemi gerekli." });

  const data = {
    groups: [
      {
        group: "İdari Personel",
        icon: "ph-briefcase",
        members: [
          "Utku Günçe",
          "Tansu Ünal",
          "Aysu Balcı",
          "Çağlar Oskay",
          "Neslihan Erşahin",
          "Ayşe Fidan",
          "Eşref Arıcan",
          "Ömer Özdemir"
        ]
      },
      {
        group: "Yönetim",
        icon: "ph-crown",
        members: [
          "Mustafa Yiğit Zeren",
          "Ahmet Salih Canbaz",
          "Manolya Melek Açıkgöz"
        ]
      },
      {
        group: "Teknik Ekip",
        icon: "ph-clipboard-text",
        members: [
          "Ahmetcan Erşimşek",
          "Berk Çanakcı",
          "Enes Boztürk",
          "Seda Canlı",
          "Vladan Šaraba",
          "Teoman Topçu",
          "Lazar Ilınčıć",
          "İbrahim Erten",
          "Burak Eser"
        ]
      },
      {
        group: "Altyapı",
        icon: "ph-plant",
        members: [
          "Kerem Taha Solmaz",
          "Beyza Karatepe"
        ]
      },
      {
        group: "Diğer",
        icon: "ph-dots-three",
        members: [
          "Mehmet Antep"
        ]
      },
      {
        group: "Sporcu",
        icon: "ph-volleyball",
        members: [
          "Anna Dodson",
          "Dicle Nur Babat",
          "Sarah Franklin",
          "Merve Biçer",
          "Fatma Yıldırım",
          "Ekaterina Pipunyrova",
          "Anna Nicoletti",
          "Hilal Kocakara",
          "Seher Aksoy",
          "Adhuoljok Malul",
          "Aslıhan Kılıç",
          "Özlem Alkan",
          "Ceren Önal"
        ]
      }
    ],
    staff: []
  };

  return res.status(200).json(data);
}
