import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kgchdufcqgyhycgyydhf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T";
const DEFAULT_ADMIN_PWD = process.env.ZEREN_ADMIN_PASSWORD || "zeren2026";
const TOKEN_SECRET = process.env.ZEREN_ADMIN_SECRET || process.env.TOKEN_SECRET || "zeren_spor_2026_secret_key_v1";

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

function parseCookies(req) {
  const list = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(";").forEach((cookie) => {
      const parts = cookie.split("=");
      const k = parts.shift().trim();
      const v = decodeURI(parts.join("="));
      list[k] = v;
    });
  }
  return list;
}

function verifyAdminAuth(req, activePwd) {
  const expectedToken = crypto.createHmac("sha256", TOKEN_SECRET).update(String(activePwd)).digest("hex");
  const cookies = parseCookies(req);
  let token = cookies.zeren_admin_token || "";
  if (!token && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    token = req.headers.authorization.slice(7).trim();
  }
  if (!token && req.headers["x-admin-token"]) {
    token = String(req.headers["x-admin-token"]).trim();
  }
  if (!token) return false;
  if (token.length !== expectedToken.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
}

async function getAdminPassword() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.__SYSTEM_STATE__&select=*`, {
      headers: getHeaders()
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows[0] && rows[0].assigned_seats && rows[0].assigned_seats.admin_password) {
        return rows[0].assigned_seats.admin_password;
      }
    }
  } catch (e) {}
  return DEFAULT_ADMIN_PWD;
}

async function generateUniqueRequestId() {
  for (let attempt = 0; attempt < 5; attempt++) {
    const randNum = crypto.randomInt(1000, 10000); // 1000 - 9999
    const candidateId = `ZS-${randNum}`;
    try {
      const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${candidateId}&select=id`, {
        headers: getHeaders()
      });
      if (checkRes.ok) {
        const rows = await checkRes.json();
        if (!Array.isArray(rows) || rows.length === 0) {
          return candidateId;
        }
      } else {
        return candidateId;
      }
    } catch (e) {
      return candidateId;
    }
  }
  return `ZS-${Date.now().toString().slice(-4)}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, apikey, Authorization, X-Admin-Token");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method === "GET") {
    const activePwd = await getAdminPassword();
    const isAuthed = verifyAdminAuth(req, activePwd);
    if (!isAuthed) {
      return res.status(401).json({
        detail: "Yetkisiz erişim. Talepleri toplu listelemek için yönetici doğrulaması gereklidir."
      });
    }

    try {
      const sbRes = await fetch(
        `${SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc`,
        { headers: getHeaders() }
      );
      if (!sbRes.ok) {
        return res.status(500).json({ detail: "Veritabanı okuma hatası." });
      }
      const data = await sbRes.json();
      return res.status(200).json(data);
    } catch (e) {
      return res.status(500).json({ detail: "Veritabanı bağlantı hatası: " + e.message });
    }
  }

  if (req.method === "POST") {
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const person = String(body.person || "").trim();
      const match = String(body.match_name || "Zeren Spor - Kuzeyboru").trim();
      const count = Math.min(100, Math.max(1, parseInt(body.requested_count || 1, 10)));
      const department = String(body.department || "").trim();
      const phone = String(body.phone || "").trim();
      const desc = String(body.description || "").trim();
      const ticketType = String(body.ticket_type || "Davetiye / Protokol").trim();
      const targetBlock = String(body.target_block || "121").trim();

      if (!person) {
        return res.status(400).json({ detail: "Personel seçimi zorunludur." });
      }

      // Generate unique, collision-resistant server-side ID
      const id = await generateUniqueRequestId();
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

      const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests`, {
        method: "POST",
        headers: getHeaders({ Prefer: "return=representation" }),
        body: JSON.stringify(newReq)
      });

      if (!sbRes.ok) {
        const errText = await sbRes.text();
        console.error("Supabase request insert error:", sbRes.status, errText);
        return res.status(500).json({
          detail: "Veritabanı kayıt hatası. Lütfen formu kontrol edip tekrar deneyiniz."
        });
      }

      const inserted = await sbRes.json();
      if (Array.isArray(inserted) && inserted.length > 0) {
        return res.status(200).json(inserted[0]);
      }
      return res.status(200).json(newReq);
    } catch (err) {
      return res.status(500).json({ detail: "Talep işlenirken hata oluştu: " + err.message });
    }
  }

  return res.status(405).json({ detail: "Method not allowed" });
}
