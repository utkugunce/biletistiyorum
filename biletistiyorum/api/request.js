// In-memory store on Vercel runtime (cached per instance)
let requestsStore = [];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    return res.status(200).json(requestsStore);
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const person = (body.person || "").trim();
      const match = (body.match_name || "Zeren Spor - Kuzeyboru").trim();
      const count = parseInt(body.requested_count || 1, 10);
      const department = (body.department || "").trim();
      const phone = (body.phone || "").trim();
      const desc = (body.description || "").trim();
      const ticketType = (body.ticket_type || "Davetiye / Protokol").trim();
      const targetBlock = (body.target_block || "121").trim();

      if (!person) {
        return res.status(400).json({ detail: "Personel seçimi zorunludur." });
      }

      const seq = String(requestsStore.length + 1).padStart(3, "0");
      const id = `ZS-${seq}`;
      const now = new Date().toISOString();

      const newReq = {
        id,
        match_name: match,
        person,
        department,
        phone,
        ticket_type: ticketType,
        requested_count: count,
        target_block: targetBlock,
        description: desc,
        status: "pending",
        created_at: now,
        assigned_seats: [],
        assigned_block: "",
        whatsapp_sent: false
      };

      requestsStore.push(newReq);
      return res.status(200).json(newReq);
    } catch (err) {
      return res.status(500).json({ detail: "Talep işlenirken hata oluştu: " + err.message });
    }
  }

  return res.status(405).json({ detail: "Method not allowed" });
}
