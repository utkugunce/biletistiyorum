const SUPABASE_URL = process.env.SUPABASE_URL || "https://kgchdufcqgyhycgyydhf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T";

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
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = (req.query.q || "").trim().toLowerCase();

  try {
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc`, {
      headers: getHeaders()
    });
    if (sbRes.ok) {
      const allReqs = await sbRes.json();
      if (!q) return res.status(200).json(allReqs);
      const filtered = allReqs.filter(
        (r) =>
          (r.person || "").toLowerCase().includes(q) ||
          (r.id || "").toLowerCase() === q
      );
      return res.status(200).json(filtered);
    }
  } catch (e) {
    // Fallback
  }

  return res.status(200).json([]);
}
