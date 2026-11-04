export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

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
