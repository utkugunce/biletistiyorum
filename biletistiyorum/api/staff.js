export default function handler(req, res) {
  const origin = req.headers.origin || "";
  const isAllowed = !origin || origin.includes("biletistiyorum.vercel.app") || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.endsWith(".vercel.app");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? (origin || "https://biletistiyorum.vercel.app") : "https://biletistiyorum.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Vercel Edge CDN Caching: Cache for 1 hour at the edge to prevent serverless function billing on high traffic
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ detail: "Method not allowed" });

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
