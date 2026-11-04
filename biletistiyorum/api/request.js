const SUPABASE_URL = process.env.SUPABASE_URL || "https://kgchdufcqgyhycgyydhf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T";

// Fallback in-memory store if SQL table is not created yet
let fallbackStore = [];

function getHeaders(extra = {}) {
  const h = {
    apikey: SUPABASE_KEY,
    "Content-Type": "application/json",
    ...extra
  };
  if (SUPABASE_KEY.startsWith("eyJ")) {
    h.Authorization = `Bearer ${SUPABASE_KEY}`;
  }
  return h;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, apikey, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    try {
      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc`, {
        headers: getHeaders()
      });
      if (sbRes.ok) {
        const data = await sbRes.json();
        return res.status(200).json(data);
      }
    } catch (e) {
      // Fallback to in-memory
    }
    return res.status(200).json(fallbackStore);
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

      const rand = Math.floor(100 + Math.random() * 900);
      const id = body.id || `ZS-${rand}`;
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

      // Try inserting into Supabase
      try {
        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests`, {
          method: "POST",
          headers: getHeaders({ Prefer: "return=representation" }),
          body: JSON.stringify(newReq)
        });
        if (sbRes.ok) {
          const inserted = await sbRes.json();
          if (Array.isArray(inserted) && inserted.length > 0) {
            return res.status(200).json(inserted[0]);
          }
        }
      } catch (e) {
        // Fallback if table not created yet
      }

      fallbackStore.push(newReq);
      return res.status(200).json(newReq);
    } catch (err) {
      return res.status(500).json({ detail: "Talep işlenirken hata oluştu: " + err.message });
    }
  }

  return res.status(405).json({ detail: "Method not allowed" });
}
