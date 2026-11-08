export default function handler(req, res) {
  const origin = req.headers.origin || "";
  const isAllowed = !origin || origin.includes("biletistiyorum.vercel.app") || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.endsWith(".vercel.app");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? (origin || "https://biletistiyorum.vercel.app") : "https://biletistiyorum.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Vercel Edge CDN Caching: Cache for 5 minutes at the edge
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=3600");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ detail: "Method not allowed" });

  const matches = [
    {
      id: "20261108_kuzeyboru",
      title: "Zeren Spor - Kuzeyboru",
      date: "08.11.2026 16:00",
      venue: "TVF Ziraat Bankkart Voleybol Salonu",
      folder: "Zeren Spor - Kuzeyboru"
    }
  ];
  return res.status(200).json(matches);
}
