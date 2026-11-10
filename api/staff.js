export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
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
    staff: [],
    phones: {
      "Eşref Arıcan": "0533 233 43 45",
      "Ayşe Fidan": "0536 476 97 31",
      "Neslihan Erşahin": "0533 680 17 87",
      "Ömer Özdemir": "0533 527 86 96",
      "Tansu Ünal": "0534 291 26 72",
      "Aysu Balcı": "0542 433 90 57",
      "Çağlar Oskay": "0532 548 99 11",
      "Ahmet Salih Canbaz": "0546 464 06 12",
      "Seda Canlı": "+1 (609) 724-5092",
      "Burak Eser": "0554 646 59 58",
      "Kerem Taha Solmaz": "0507 634 78 75",
      "Mehmet Antep": "0538 356 24 40"
    }
  };

  return res.status(200).json(data);
}
