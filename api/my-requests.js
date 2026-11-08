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

const myReqRateMap = new Map();
function isMyReqRateLimited(ip, limit = 20, windowMs = 60000) {
  const now = Date.now();
  let timestamps = myReqRateMap.get(ip) || [];
  timestamps = timestamps.filter((t) => now - t < windowMs);
  if (timestamps.length >= limit) {
    myReqRateMap.set(ip, timestamps);
    return true;
  }
  timestamps.push(now);
  myReqRateMap.set(ip, timestamps);
  return false;
}

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const isAllowed = !origin || origin.includes("biletistiyorum.vercel.app") || origin.includes("localhost") || origin.includes("127.0.0.1") || origin.endsWith(".vercel.app");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? (origin || "*") : "https://biletistiyorum.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, apikey, Authorization");
  res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ detail: "Method not allowed" });
  }

  const clientIp = (req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local").split(",")[0].trim();
  if (isMyReqRateLimited(clientIp, 25, 60000)) {
    return res.status(429).json({ detail: "Çok fazla sorgu yapıldı. Lütfen 1 dakika bekleyiniz." });
  }

  const rawQ = (req.query.q || "").trim();
  if (!rawQ || rawQ.length < 4) {
    return res.status(200).json([]);
  }

  const qLower = rawQ.toLowerCase();
  const digitsOnly = rawQ.replace(/\D/g, "");

  try {
    const sbRes = await fetch(
      `${SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__&select=id,match_name,person,phone,requested_count,target_block,assigned_block,assigned_seats,status,whatsapp_sent,created_at&order=created_at.desc`,
      { headers: getHeaders() }
    );
    if (!sbRes.ok) {
      return res.status(500).json({ detail: "Veritabanı hatası." });
    }

    const allReqs = await sbRes.json();
    if (!Array.isArray(allReqs)) {
      return res.status(200).json([]);
    }

    const filtered = allReqs.filter((r) => {
      const rId = String(r.id || "").toLowerCase();
      // Match by exact or prefix ZS- request id
      if (qLower.startsWith("zs-") && rId === qLower) {
        return true;
      }
      if (rId === qLower) {
        return true;
      }
      // Match by phone number (at least 7 matching digits to prevent broad collision)
      if (digitsOnly.length >= 7) {
        const rPhoneDigits = String(r.phone || "").replace(/\D/g, "");
        if (rPhoneDigits && (rPhoneDigits.endsWith(digitsOnly) || digitsOnly.endsWith(rPhoneDigits))) {
          return true;
        }
      }
      return false;
    });

    // Data minimization: Return only sanitized tracking fields (do not leak private notes or full phone)
    const sanitized = filtered.map((r) => {
      const asg = Array.isArray(r.assigned_seats) ? r.assigned_seats : [];
      const reqCount = parseInt(r.requested_count || 1, 10);
      const isComp = asg.length >= reqCount && reqCount > 0;
      const isPart = asg.length > 0 && !isComp;
      const maskedPhone = r.phone ? r.phone.replace(/(\d{3})\d{4}(\d{2})/, "$1****$2") : "";

      return {
        id: r.id,
        match_name: r.match_name,
        person: r.person,
        masked_phone: maskedPhone,
        requested_count: reqCount,
        assigned_count: asg.length,
        target_block: r.target_block,
        assigned_block: r.assigned_block,
        assigned_seats: asg,
        status: r.status,
        fulfillment_status: isComp ? "completed" : isPart ? "partial" : "pending",
        whatsapp_sent: Boolean(r.whatsapp_sent),
        created_at: r.created_at
      };
    });

    return res.status(200).json(sanitized);
  } catch (e) {
    return res.status(500).json({ detail: "Sorgu hatası: " + e.message });
  }
}
