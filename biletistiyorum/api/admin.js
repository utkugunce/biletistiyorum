import fs from "fs";
import path from "path";
import crypto from "crypto";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://kgchdufcqgyhycgyydhf.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_aT8iwPOs6AOg5HfaAQpGhg_TlvHwG2T";
const DEFAULT_ADMIN_PWD = process.env.ZEREN_ADMIN_PASSWORD || "zeren2026";
const TOKEN_SECRET = "zeren_spor_2026_secret_key_v1";

const PALETTE = [
  "#7E22CE", "#2563EB", "#059669", "#D97706", "#DC2626",
  "#0891B2", "#4F46E5", "#BE185D", "#65A30D", "#9333EA"
];

const TICKET_FILES = {"102:3-1": "102 3 - -1.pdf", "102:3-10": "102 3 - -10.pdf", "102:3-11": "102 3 - -11.pdf", "102:3-12": "102 3 - -12.pdf", "102:3-13": "102 3 - -13.pdf", "102:3-14": "102 3 - -14.pdf", "102:3-15": "102 3 - -15.pdf", "102:3-2": "102 3 - -2.pdf", "102:3-3": "102 3 - -3.pdf", "102:3-4": "102 3 - -4.pdf", "102:3-5": "102 3 - -5.pdf", "102:3-6": "102 3 - -6.pdf", "102:3-7": "102 3 - -7.pdf", "102:3-8": "102 3 - -8.pdf", "102:3-9": "102 3 - -9.pdf", "102:4-1": "102 4 - -1.pdf", "102:4-10": "102 4 - -10.pdf", "102:4-11": "102 4 - -11.pdf", "102:4-12": "102 4 - -12.pdf", "102:4-13": "102 4 - -13.pdf", "102:4-14": "102 4 - -14.pdf", "102:4-15": "102 4 - -15.pdf", "102:4-2": "102 4 - -2.pdf", "102:4-3": "102 4 - -3.pdf", "102:4-4": "102 4 - -4.pdf", "102:4-5": "102 4 - -5.pdf", "102:4-6": "102 4 - -6.pdf", "102:4-7": "102 4 - -7.pdf", "102:4-8": "102 4 - -8.pdf", "102:4-9": "102 4 - -9.pdf", "102:5-1": "102 5 - -1.pdf", "102:5-10": "102 5 - -10.pdf", "102:5-11": "102 5 - -11.pdf", "102:5-12": "102 5 - -12.pdf", "102:5-13": "102 5 - -13.pdf", "102:5-14": "102 5 - -14.pdf", "102:5-15": "102 5 - -15.pdf", "102:5-2": "102 5 - -2.pdf", "102:5-3": "102 5 - -3.pdf", "102:5-4": "102 5 - -4.pdf", "102:5-5": "102 5 - -5.pdf", "102:5-6": "102 5 - -6.pdf", "102:5-7": "102 5 - -7.pdf", "102:5-8": "102 5 - -8.pdf", "102:5-9": "102 5 - -9.pdf", "102:6-1": "102 6 - -1.pdf", "102:6-10": "102 6 - -10.pdf", "102:6-11": "102 6 - -11.pdf", "102:6-12": "102 6 - -12.pdf", "102:6-13": "102 6 - -13.pdf", "102:6-14": "102 6 - -14.pdf", "102:6-15": "102 6 - -15.pdf", "102:6-2": "102 6 - -2.pdf", "102:6-3": "102 6 - -3.pdf", "102:6-4": "102 6 - -4.pdf", "102:6-5": "102 6 - -5.pdf", "102:6-6": "102 6 - -6.pdf", "102:6-7": "102 6 - -7.pdf", "102:6-8": "102 6 - -8.pdf", "102:6-9": "102 6 - -9.pdf", "102:7-1": "102 7 - -1.pdf", "102:7-10": "102 7 - -10.pdf", "102:7-11": "102 7 - -11.pdf", "102:7-12": "102 7 - -12.pdf", "102:7-13": "102 7 - -13.pdf", "102:7-14": "102 7 - -14.pdf", "102:7-15": "102 7 - -15.pdf", "102:7-2": "102 7 - -2.pdf", "102:7-3": "102 7 - -3.pdf", "102:7-4": "102 7 - -4.pdf", "102:7-5": "102 7 - -5.pdf", "102:7-6": "102 7 - -6.pdf", "102:7-7": "102 7 - -7.pdf", "102:7-8": "102 7 - -8.pdf", "102:7-9": "102 7 - -9.pdf", "102:8-1": "102 8 - -1.pdf", "102:8-10": "102 8 - -10.pdf", "102:8-11": "102 8 - -11.pdf", "102:8-12": "102 8 - -12.pdf", "102:8-13": "102 8 - -13.pdf", "102:8-14": "102 8 - -14.pdf", "102:8-15": "102 8 - -15.pdf", "102:8-2": "102 8 - -2.pdf", "102:8-3": "102 8 - -3.pdf", "102:8-4": "102 8 - -4.pdf", "102:8-5": "102 8 - -5.pdf", "102:8-6": "102 8 - -6.pdf", "102:8-7": "102 8 - -7.pdf", "102:8-8": "102 8 - -8.pdf", "102:8-9": "102 8 - -9.pdf", "102:9-1": "102 9 - -1.pdf", "102:9-10": "102 9 - -10.pdf", "102:9-11": "102 9 - -11.pdf", "102:9-12": "102 9 - -12.pdf", "102:9-13": "102 9 - -13.pdf", "102:9-14": "102 9 - -14.pdf", "102:9-15": "102 9 - -15.pdf", "102:9-16": "102 9 - -16.pdf", "102:9-2": "102 9 - -2.pdf", "102:9-3": "102 9 - -3.pdf", "102:9-4": "102 9 - -4.pdf", "102:9-5": "102 9 - -5.pdf", "102:9-6": "102 9 - -6.pdf", "102:9-7": "102 9 - -7.pdf", "102:9-8": "102 9 - -8.pdf", "102:9-9": "102 9 - -9.pdf", "SAHA:1-27": "Saha İci A27.pdf", "SAHA:1-28": "Saha İci A28.pdf", "SAHA:1-29": "Saha İci A29.pdf", "SAHA:1-30": "Saha İci A30.pdf", "SAHA:1-31": "Saha İci A31.pdf", "SAHA:2-27": "Saha İci B27.pdf", "SAHA:2-28": "Saha İci B28.pdf", "SAHA:2-29": "Saha İci B29.pdf", "SAHA:2-30": "Saha İci B30.pdf", "SAHA:2-31": "Saha İci B31.pdf", "SAHA:2-39": "Saha İci B39.pdf", "SAHA:2-40": "Saha İci B40.pdf", "SAHA:2-41": "Saha İci B41.pdf", "SAHA:2-42": "Saha İci B42.pdf", "SAHA:2-43": "Saha İci B43.pdf", "SAHA:2-44": "Saha İci B44.pdf", "SAHA:2-45": "Saha İci B45.pdf", "SAHA:2-46": "Saha İci B46.pdf", "SAHA:2-47": "Saha İci B47.pdf", "SAHA:2-48": "Saha İci B48.pdf", "SAHA:2-49": "Saha İci B49.pdf", "SAHA:2-50": "Saha İci B50.pdf", "SAHA:2-51": "Saha İci B51.pdf", "SAHA:2-52": "Saha İci B52.pdf"};

let cachedBase = null;
function getBaseData() {
  if (!cachedBase) {
    const p = path.join(process.cwd(), "api", "base_state.json");
    cachedBase = JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  return JSON.parse(JSON.stringify(cachedBase));
}

function sbHeaders(extra = {}) {
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

function makeAdminToken(pwd) {
  return crypto.createHmac("sha256", TOKEN_SECRET).update(String(pwd)).digest("hex");
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

function normalizeName(str) {
  if (!str) return "";
  const map = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", İ: "i", I: "i" };
  return String(str)
    .toLowerCase()
    .replace(/[çğıöşüİI]/g, (m) => map[m] || m)
    .trim();
}

function formatWaPhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("0") && digits.length === 11) return "90" + digits.slice(1);
  if (digits.startsWith("5") && digits.length === 10) return "90" + digits;
  return digits;
}

function lookupPhone(person, phonebook) {
  if (!person) return "";
  const pNorm = normalizeName(person);
  for (const [k, v] of Object.entries(phonebook)) {
    if (normalizeName(k) === pNorm) return v;
  }
  if (pNorm === "asc" || pNorm === "ahmet salih") {
    if (phonebook["Ahmet Salih Canbaz"]) return phonebook["Ahmet Salih Canbaz"];
  }
  for (const [k, v] of Object.entries(phonebook)) {
    const kNorm = normalizeName(k);
    if (pNorm.length >= 3 && (pNorm.includes(kNorm) || kNorm.includes(pNorm))) {
      return v;
    }
  }
  return "";
}

async function loadSystemState() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.__SYSTEM_STATE__&select=*`, {
      headers: sbHeaders()
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows) && rows.length > 0 && rows[0].assigned_seats && typeof rows[0].assigned_seats === "object" && !Array.isArray(rows[0].assigned_seats)) {
        return rows[0].assigned_seats;
      }
    }
  } catch (e) {}
  return {
    virtual_assignments: {},
    admin_password: DEFAULT_ADMIN_PWD,
    custom_phones: {},
    sent_map: {}
  };
}

async function saveSystemState(sysState) {
  const row = {
    id: "__SYSTEM_STATE__",
    match_name: "__SYSTEM__",
    person: "__SYSTEM__",
    status: "system",
    assigned_seats: sysState
  };
  await fetch(`${SUPABASE_URL}/rest/v1/portal_requests`, {
    method: "POST",
    headers: sbHeaders({ Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify(row)
  });
}

async function loadPortalRequests() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc`, {
      headers: sbHeaders()
    });
    if (res.ok) {
      const rows = await res.json();
      if (Array.isArray(rows)) return rows;
    }
  } catch (e) {}
  return [];
}

function buildFullState(baseState, sysState) {
  const st = JSON.parse(JSON.stringify(baseState));
  const vMap = sysState.virtual_assignments || {};
  const colorMap = st.colors || {};
  let colorIdx = 0;

  function getGroupColor(gName) {
    const key = gName.toLowerCase();
    if (!colorMap[key]) {
      colorMap[key] = PALETTE[colorIdx % PALETTE.length];
      colorIdx++;
    }
    return colorMap[key];
  }

  // Reset assignment fields on all blocks
  for (const [bId, bObj] of Object.entries(st.blocks || {})) {
    bObj.assigned_tickets = 0;
    bObj.unassigned_tickets = 0;
    bObj.total_tickets = 0;
    for (const t of Object.values(bObj.tickets || {})) {
      t.status = "unassigned";
      t.group = "";
      t.subgroup = "";
      t.label = "";
      t.color = "";
    }
  }

  // Apply assignments from virtual_assignments
  for (const [key, val] of Object.entries(vMap)) {
    const [bId, sid] = key.split(":");
    if (!st.blocks[bId]) continue;
    const [rStr, sStr] = sid.split("-");
    const row = parseInt(rStr, 10);
    const seat = parseInt(sStr, 10);
    const grp = (val.group || "").trim();
    if (!grp) continue;
    const sub = (val.subgroup || "").trim();
    const label = sub ? `${grp}/${sub}` : grp;
    const col = getGroupColor(grp);

    st.blocks[bId].tickets = st.blocks[bId].tickets || {};
    if (st.blocks[bId].tickets[sid]) {
      const t = st.blocks[bId].tickets[sid];
      t.group = grp;
      t.subgroup = sub;
      t.label = label;
      t.status = "assigned";
      t.color = col;
    } else {
      st.blocks[bId].tickets[sid] = {
        key,
        block: bId,
        row,
        seat,
        seat_id: sid,
        filename: `${bId}_${sid}.pdf`,
        rel_path: "",
        group: grp,
        subgroup: sub,
        label,
        status: "assigned",
        is_virtual: true,
        has_pdf: false,
        color: col
      };
    }
  }

  let totalAssigned = 0;
  let totalUnassigned = 0;
  let totalTickets = 0;

  for (const [bId, bObj] of Object.entries(st.blocks || {})) {
    const tickets = bObj.tickets || {};
    let bAssigned = 0;
    let bUnassigned = 0;
    for (const t of Object.values(tickets)) {
      if (t.status === "assigned") {
        bAssigned++;
      } else {
        bUnassigned++;
      }
    }
    bObj.assigned_count = bAssigned;
    bObj.unassigned_count = bUnassigned;
    bObj.diger_count = 0;
    bObj.available_count = bUnassigned;
    bObj.missing_count = Math.max(0, (bObj.capacity || 0) - Object.keys(tickets).length);
    bObj.assigned_tickets = bAssigned;
    bObj.unassigned_tickets = bUnassigned;
    bObj.total_tickets = Object.keys(tickets).length;
    bObj.total_active = bObj.total_tickets;
    bObj.total_pdfs = Object.values(tickets).filter((t) => t.has_pdf).length;

    totalAssigned += bAssigned;
    totalUnassigned += bUnassigned;
    totalTickets += bObj.total_tickets;
  }

  // Build groups_summary
  const grpBuckets = {};
  for (const [bId, bObj] of Object.entries(st.blocks || {})) {
    for (const t of Object.values(bObj.tickets || {})) {
      const gKey = t.group;
      if (!gKey) continue;
      if (!grpBuckets[gKey]) {
        grpBuckets[gKey] = {
          group: gKey,
          display_name: gKey,
          color: t.color || getGroupColor(gKey),
          total_count: 0,
          is_unassigned: false,
          seat_keys: [],
          sub_map: {}
        };
      }
      const gb = grpBuckets[gKey];
      gb.total_count++;
      gb.seat_keys.push(t.key);
      const sgKey = t.subgroup || "";
      if (!gb.sub_map[sgKey]) {
        gb.sub_map[sgKey] = {
          subgroup: sgKey,
          display: sgKey ? `${gKey}/${sgKey}` : gKey,
          count: 0,
          color: gb.color,
          seat_keys: [],
          by_block_row: {}
        };
      }
      const sgb = gb.sub_map[sgKey];
      sgb.count++;
      sgb.seat_keys.push(t.key);
      const brKey = `${t.block}:${t.row}`;
      if (!sgb.by_block_row[brKey]) sgb.by_block_row[brKey] = [];
      sgb.by_block_row[brKey].push(t.seat);
    }
  }

  const groupsSummary = Object.values(grpBuckets).map((gb) => {
    const subgroups = Object.values(gb.sub_map).map((sgb) => {
      const ranges = Object.entries(sgb.by_block_row).map(([brKey, seatsArr]) => {
        const [bId, rStr] = brKey.split(":");
        seatsArr.sort((a, b) => a - b);
        const minS = seatsArr[0];
        const maxS = seatsArr[seatsArr.length - 1];
        const txt = seatsArr.length > 1 ? `${rStr}-${minS}..${rStr}-${maxS}` : `${rStr}-${minS}`;
        return {
          block: bId,
          row: parseInt(rStr, 10),
          count: seatsArr.length,
          text: txt,
          seats: seatsArr.map((s) => `${rStr}-${s}`)
        };
      });
      return {
        subgroup: sgb.subgroup,
        display: sgb.display,
        count: sgb.count,
        color: sgb.color,
        seat_keys: sgb.seat_keys,
        ranges
      };
    });
    return {
      group: gb.group,
      display_name: gb.display_name,
      color: gb.color,
      total_count: gb.total_count,
      is_unassigned: false,
      seat_keys: gb.seat_keys,
      subgroups
    };
  });

  st.total_tickets = totalTickets;
  st.assigned_tickets = totalAssigned;
  st.unassigned_tickets = totalUnassigned;
  st.diger_tickets = 0;
  st.groups_summary = groupsSummary;
  st.colors = colorMap;
  return st;
}

function autoPickSeats(blockObj, count) {
  if (!blockObj || !blockObj.rows) return [];
  const tickets = blockObj.tickets || {};
  const picked = [];

  function isSeatFree(rNum, sNum) {
    const sid = `${rNum}-${sNum}`;
    const t = tickets[sid];
    return !t || t.status === "unassigned" || t.status === "diger";
  }

  // 1. Try finding consecutive seats in a single row
  for (const rObj of blockObj.rows) {
    const rNum = rObj.row;
    const cells = (rObj.cells || rObj.seats || []).filter((c) => c !== null);
    cells.sort((a, b) => a - b);
    let consecutive = [];
    for (const sNum of cells) {
      if (isSeatFree(rNum, sNum)) {
        if (consecutive.length > 0 && consecutive[consecutive.length - 1].seat !== sNum - 1) {
          consecutive = [];
        }
        consecutive.push({ block: blockObj.id, row: rNum, seat: sNum });
        if (consecutive.length === count) {
          return consecutive;
        }
      } else {
        consecutive = [];
      }
    }
  }

  // 2. Otherwise pick across rows
  for (const rObj of blockObj.rows) {
    const rNum = rObj.row;
    const cells = (rObj.cells || rObj.seats || []).filter((c) => c !== null);
    cells.sort((a, b) => a - b);
    for (const sNum of cells) {
      if (isSeatFree(rNum, sNum)) {
        picked.push({ block: blockObj.id, row: rNum, seat: sNum });
        if (picked.length >= count) return picked;
      }
    }
  }
  return picked;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token");
  if (req.method === "OPTIONS") return res.status(200).end();

  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = urlObj.pathname;
  const body = typeof req.body === "string" && req.body ? JSON.parse(req.body) : req.body || {};

  const sysState = await loadSystemState();
  const activePwd = sysState.admin_password || DEFAULT_ADMIN_PWD;
  const validToken = makeAdminToken(activePwd);

  // 1. AUTH ENDPOINTS
  if (pathname === "/api/auth/login" && req.method === "POST") {
    const pwd = String(body.password || "").trim();
    if (pwd === activePwd) {
      res.setHeader(
        "Set-Cookie",
        `zeren_admin_token=${validToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
      );
      return res.status(200).json({ success: true, authenticated: true, token: validToken, message: "Giriş başarılı." });
    }
    return res.status(401).json({ success: false, detail: "Hatalı şifre! Lütfen tekrar deneyiniz." });
  }

  const cookies = parseCookies(req);
  let reqToken = cookies.zeren_admin_token || "";
  if (!reqToken && req.headers.authorization && req.headers.authorization.startsWith("Bearer ")) {
    reqToken = req.headers.authorization.slice(7).trim();
  }
  if (!reqToken && req.headers["x-admin-token"]) {
    reqToken = String(req.headers["x-admin-token"]).trim();
  }
  const isAuthenticated = reqToken === validToken;

  if (pathname === "/api/auth/check") {
    return res.status(200).json({ success: isAuthenticated, authenticated: isAuthenticated });
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    res.setHeader("Set-Cookie", "zeren_admin_token=; Path=/; HttpOnly; Max-Age=0");
    return res.status(200).json({ success: true, authenticated: false, message: "Çıkış yapıldı." });
  }

  // Require authentication for all remaining /api/* admin routes
  if (!isAuthenticated) {
    return res.status(401).json({ detail: "Yetkisiz erişim. Lütfen yönetici şifresi ile giriş yapınız." });
  }

  if (pathname === "/api/auth/change-password" && req.method === "POST") {
    if (String(body.current_password || "").trim() !== activePwd) {
      return res.status(400).json({ success: false, detail: "Mevcut şifreniz hatalı." });
    }
    const newPwd = String(body.new_password || "").trim();
    if (newPwd.length < 4) {
      return res.status(400).json({ success: false, detail: "Yeni şifre en az 4 karakter olmalıdır." });
    }
    sysState.admin_password = newPwd;
    await saveSystemState(sysState);
    const newToken = makeAdminToken(newPwd);
    res.setHeader(
      "Set-Cookie",
      `zeren_admin_token=${newToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
    );
    return res.status(200).json({ success: true, ok: true, token: newToken, message: "Şifre güncellendi." });
  }

  const baseData = getBaseData();
  const phonebook = { ...(baseData.phonebook || {}), ...(sysState.custom_phones || {}) };

  // 2. GET /api/state
  if (pathname === "/api/state" && req.method === "GET") {
    const fullState = buildFullState(baseData.base_state, sysState);
    return res.status(200).json(fullState);
  }

  // 3. POST /api/assign
  if (pathname === "/api/assign" && req.method === "POST") {
    const seats = body.seats || [];
    const grp = String(body.group || "").trim();
    const sub = String(body.subgroup || "").trim();
    const reqId = String(body.request_id || "").trim();
    sysState.virtual_assignments = sysState.virtual_assignments || {};

    const newlyAssignedByBlock = {};
    const unassignedSeats = new Set();

    for (const s of seats) {
      const key = `${s.block}:${s.row}-${s.seat}`;
      if (grp) {
        sysState.virtual_assignments[key] = {
          group: grp,
          subgroup: sub,
          request_id: reqId || undefined
        };
        if (!newlyAssignedByBlock[s.block]) newlyAssignedByBlock[s.block] = [];
        newlyAssignedByBlock[s.block].push(`${s.row}-${s.seat}`);
      } else {
        delete sysState.virtual_assignments[key];
        unassignedSeats.add(key);
      }
    }
    await saveSystemState(sysState);

    // Eğer koltuklar boşa çıkarıldıysa ilgili portal taleplerinden de düş
    if (unassignedSeats.size > 0) {
      const portalReqs = await loadPortalRequests();
      for (const pr of portalReqs) {
        if (!Array.isArray(pr.assigned_seats) || pr.assigned_seats.length === 0) continue;
        let bId = String(pr.assigned_block || pr.target_block || "102").trim();
        if (bId.toLowerCase().includes("saha")) bId = "SAHA";
        const remaining = pr.assigned_seats.filter((sid) => !unassignedSeats.has(`${bId}:${sid}`));
        if (remaining.length !== pr.assigned_seats.length) {
          await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(pr.id)}`, {
            method: "PATCH",
            headers: sbHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({
              status: remaining.length > 0 ? "assigned" : "pending",
              assigned_seats: remaining
            })
          });
        }
      }
    } else if (grp && !reqId) {
      // Alt çubuktan (dock) doğrudan bir personele koltuk atandıysa ve o blokta bekleyen/eksik talebi varsa otomatik bağla
      const portalReqs = await loadPortalRequests();
      // Kronolojik sırala (eskiden yeniye)
      const chronological = [...portalReqs].reverse();
      for (const [bId, sids] of Object.entries(newlyAssignedByBlock)) {
        const matchingReq = chronological.find((pr) => {
          if (normalizeName(pr.person) !== normalizeName(grp)) return false;
          let prBlock = String(pr.assigned_block || pr.target_block || "102").trim();
          if (prBlock.toLowerCase().includes("saha")) prBlock = "SAHA";
          if (prBlock !== bId) return false;
          const curSeats = Array.isArray(pr.assigned_seats) ? pr.assigned_seats : [];
          const reqC = parseInt(pr.requested_count || 1, 10);
          return curSeats.length < reqC;
        });
        if (matchingReq) {
          const curSeats = Array.isArray(matchingReq.assigned_seats) ? matchingReq.assigned_seats : [];
          const merged = Array.from(new Set([...curSeats, ...sids]));
          for (const sid of sids) {
            if (sysState.virtual_assignments[`${bId}:${sid}`]) {
              sysState.virtual_assignments[`${bId}:${sid}`].request_id = matchingReq.id;
            }
          }
          await saveSystemState(sysState);
          await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(matchingReq.id)}`, {
            method: "PATCH",
            headers: sbHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({
              status: "assigned",
              assigned_block: bId,
              assigned_seats: merged
            })
          });
        }
      }
    }

    return res.status(200).json(buildFullState(baseData.base_state, sysState));
  }

  // 4. POST /api/groups/unassign
  if (pathname === "/api/groups/unassign" && req.method === "POST") {
    const grp = String(body.group || "").trim().toLowerCase();
    const sub = String(body.subgroup || "").trim().toLowerCase();
    const reqId = String(body.request_id || "").trim();
    const seatKeys = body.seat_keys || [];
    sysState.virtual_assignments = sysState.virtual_assignments || {};

    if (seatKeys.length > 0) {
      // Sadece belirtilen koltukları (örn. tek bir talebin koltuklarını) boşa çıkar
      for (const k of seatKeys) {
        delete sysState.virtual_assignments[k];
      }
    } else if (grp) {
      // Sağdaki Dağılım listesinden tüm grubu boşa çıkar
      for (const [k, v] of Object.entries(sysState.virtual_assignments)) {
        const vg = String(v.group || "").trim().toLowerCase();
        const vs = String(v.subgroup || "").trim().toLowerCase();
        if (vg === grp || normalizeName(vg) === normalizeName(grp)) {
          if (!sub || vs === sub) {
            delete sysState.virtual_assignments[k];
          }
        }
      }
    }
    await saveSystemState(sysState);

    if (reqId) {
      await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(reqId)}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          status: "pending",
          assigned_seats: []
        })
      });
    } else if (grp && seatKeys.length === 0) {
      // Tüm grup boşa çıkarıldıysa o kişinin tüm taleplerini sıfırla
      const portalReqs = await loadPortalRequests();
      for (const pr of portalReqs) {
        if (normalizeName(pr.person) === normalizeName(grp)) {
          await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(pr.id)}`, {
            method: "PATCH",
            headers: sbHeaders({ Prefer: "return=minimal" }),
            body: JSON.stringify({
              status: "pending",
              assigned_seats: []
            })
          });
        }
      }
    }

    return res.status(200).json(buildFullState(baseData.base_state, sysState));
  }

  // 5. POST /api/shift
  if (pathname === "/api/shift" && req.method === "POST") {
    const src = body.source_seats || [];
    const dst = body.target_seats || [];
    sysState.virtual_assignments = sysState.virtual_assignments || {};
    const temp = src.map((s) => sysState.virtual_assignments[`${s.block}:${s.row}-${s.seat}`]);
    src.forEach((s) => delete sysState.virtual_assignments[`${s.block}:${s.row}-${s.seat}`]);
    dst.forEach((t, idx) => {
      if (temp[idx]) {
        sysState.virtual_assignments[`${t.block}:${t.row}-${t.seat}`] = temp[idx];
      }
    });
    await saveSystemState(sysState);
    return res.status(200).json(buildFullState(baseData.base_state, sysState));
  }

  // 6. GET /api/excel/summary & POST /api/excel/reload
  if (pathname === "/api/excel/summary" || pathname === "/api/excel/reload") {
    const portalReqs = await loadPortalRequests();
    const vMap = sysState.virtual_assignments || {};

    // Her talebi kendi atanan koltuklarıyla bağımsız değerlendir
    const evaluated = portalReqs.map((pr) => {
      const person = pr.person || "";
      const phone = pr.phone || lookupPhone(person, phonebook);
      const reqCount = parseInt(pr.requested_count || 1, 10);
      const targetBlock = pr.target_block || "121";
      let normBlock = String(pr.assigned_block || targetBlock || "121").trim();
      if (normBlock.toLowerCase().includes("saha")) normBlock = "SAHA";

      // 1. Öncelikle bu talebin kendi assigned_seats listesini veya request_id ile eşleşen koltukları al
      let matchedSeats = [];
      let matchedKeys = [];

      // virtual_assignments içinde doğrudan bu request_id'ye bağlı koltuklar var mı?
      for (const [k, v] of Object.entries(vMap)) {
        if (v && v.request_id === pr.id) {
          const [bId, sid] = k.split(":");
          if (!matchedKeys.includes(k)) {
            matchedKeys.push(k);
            matchedSeats.push(sid);
          }
        }
      }

      // Ayrıca pr.assigned_seats içinde kayıtlı olan ve hala virtual_assignments'ta bu kişide duran koltukları ekle
      if (Array.isArray(pr.assigned_seats) && pr.assigned_seats.length > 0) {
        for (const sid of pr.assigned_seats) {
          const k = `${normBlock}:${sid}`;
          const v = vMap[k];
          // Eğer koltuk hala bu kişiye aitse (ve başka bir request_id'ye özel atanmamışsa)
          if (v && normalizeName(v.group) === normalizeName(person) && (!v.request_id || v.request_id === pr.id)) {
            if (!matchedKeys.includes(k)) {
              matchedKeys.push(k);
              matchedSeats.push(sid);
            }
          }
        }
      }

      const asgCount = matchedSeats.length;
      const isComp = asgCount >= reqCount && reqCount > 0;
      const isPart = asgCount > 0 && !isComp;

      return {
        request_id: pr.id,
        source: "portal",
        row_index: 0,
        date_serial: pr.created_at || "",
        match: pr.match_name || "Zeren Spor - Kuzeyboru",
        person,
        department: pr.department || "",
        phone,
        ticket_type: pr.ticket_type || "Davetiye / Protokol",
        requested_count: reqCount,
        description: `🌐 Bilet İstiyorum (${pr.department || "Personel"}): ${pr.description || ""}`.replace(/:\s*$/, ""),
        status: isComp ? "assigned" : "pending",
        target_block: targetBlock,
        suggested_group: person,
        suggested_subgroup: pr.department || "",
        aliases: [person.toLowerCase()],
        matched_keys: matchedKeys,
        matched_seats: matchedSeats,
        assigned_count: asgCount,
        fulfillment_status: isComp ? "completed" : isPart ? "partial" : "pending",
        status_badge: isComp ? "Portal: Koltuklar Ayrıldı ✅" : isPart ? "Portal: Kısmi ⚠️" : "Bilet İstiyorum Talebi ⏳",
        status_color: isComp ? "#059669" : isPart ? "#D97706" : "#2563EB",
        progress_pct: reqCount > 0 ? Math.min(100, Math.round((asgCount / reqCount) * 100)) : 0
      };
    });

    const totalReq = evaluated.reduce((a, r) => a + r.requested_count, 0);
    const totalAsg = evaluated.reduce((a, r) => a + r.assigned_count, 0);

    return res.status(200).json({
      ok: true,
      excel_path: "Supabase Cloud DB",
      excel_exists: true,
      active_match_name: "Zeren Spor - Kuzeyboru",
      available_matches: ["Zeren Spor - Kuzeyboru"],
      requests: evaluated,
      total_requested: totalReq,
      total_assigned: totalAsg,
      total_pending: Math.max(0, totalReq - totalAsg),
      completed_count: evaluated.filter((r) => r.fulfillment_status === "completed").length,
      partial_count: evaluated.filter((r) => r.fulfillment_status === "partial").length,
      pending_count: evaluated.filter((r) => r.fulfillment_status === "pending").length,
      portal_requests_count: evaluated.length,
      fulfillment_pct: totalReq > 0 ? Math.round((totalAsg / totalReq) * 100) : 0
    });
  }

  // 7. POST /api/excel/assign-request
  if (pathname === "/api/excel/assign-request" && req.method === "POST") {
    let targetBlock = String(body.block_id || "102").trim();
    if (targetBlock.toLowerCase().includes("saha")) targetBlock = "SAHA";

    const currentState = buildFullState(baseData.base_state, sysState);
    const blockObj = currentState.blocks[targetBlock];
    if (!blockObj) {
      return res.status(400).json({ detail: `${targetBlock} bloğu bulunamadı.` });
    }

    // Eğer bu talebe daha önce kısmi koltuk atanmışsa onları koru ve üstüne tamamla
    let existingSids = [];
    if (body.request_id) {
      const portalReqs = await loadPortalRequests();
      const targetReq = portalReqs.find((r) => r.id === body.request_id);
      if (targetReq && Array.isArray(targetReq.assigned_seats)) {
        const vMap = sysState.virtual_assignments || {};
        existingSids = targetReq.assigned_seats.filter((sid) => {
          const v = vMap[`${targetBlock}:${sid}`];
          return v && normalizeName(v.group) === normalizeName(body.group || targetReq.person);
        });
      }
    }

    let pickedSeats = [];
    if (Array.isArray(body.seat_ids) && body.seat_ids.length > 0) {
      pickedSeats = body.seat_ids.map((sid) => {
        const [r, s] = sid.split("-").map(Number);
        return { block: targetBlock, row: r, seat: s };
      });
    } else {
      pickedSeats = autoPickSeats(blockObj, parseInt(body.count || 1, 10));
    }

    if (pickedSeats.length === 0 && existingSids.length === 0) {
      return res.status(400).json({ detail: `${targetBlock} bloğunda boş koltuk bulunamadı.` });
    }

    sysState.virtual_assignments = sysState.virtual_assignments || {};
    const newSids = [];
    for (const s of pickedSeats) {
      const sid = `${s.row}-${s.seat}`;
      newSids.push(sid);
      sysState.virtual_assignments[`${s.block}:${sid}`] = {
        group: String(body.group || "").trim(),
        subgroup: String(body.subgroup || "").trim(),
        request_id: body.request_id || undefined
      };
    }
    const finalSids = Array.from(new Set([...existingSids, ...newSids]));
    // Mevcut koltuklara da request_id etiketini işle
    for (const sid of finalSids) {
      if (sysState.virtual_assignments[`${targetBlock}:${sid}`] && body.request_id) {
        sysState.virtual_assignments[`${targetBlock}:${sid}`].request_id = body.request_id;
      }
    }
    await saveSystemState(sysState);

    if (body.request_id) {
      await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(body.request_id)}`, {
        method: "PATCH",
        headers: sbHeaders({ Prefer: "return=minimal" }),
        body: JSON.stringify({
          status: "assigned",
          assigned_block: targetBlock,
          assigned_seats: finalSids
        })
      });
    }

    return res.status(200).json(buildFullState(baseData.base_state, sysState));
  }

  // 8. POST /api/matches/auto-assign-all
  if (pathname === "/api/matches/auto-assign-all" && req.method === "POST") {
    const portalReqs = await loadPortalRequests();
    sysState.virtual_assignments = sysState.virtual_assignments || {};
    let assignedReqsCount = 0;
    let assignedSeatsCount = 0;

    for (const pr of portalReqs) {
      const person = pr.person || "";
      const reqCount = parseInt(pr.requested_count || 1, 10);
      let targetBlock = pr.target_block || "102";
      if (targetBlock.toLowerCase().includes("saha")) targetBlock = "SAHA";

      // Sadece bu talebe ait mevcut koltukları kontrol et
      const curAssigned = Array.isArray(pr.assigned_seats)
        ? pr.assigned_seats.filter((sid) => {
            const v = sysState.virtual_assignments[`${targetBlock}:${sid}`];
            return v && normalizeName(v.group) === normalizeName(person);
          })
        : [];
      const needed = reqCount - curAssigned.length;
      if (needed <= 0) continue;

      const tempState = buildFullState(baseData.base_state, sysState);
      const blockObj = tempState.blocks[targetBlock] || tempState.blocks["121"];
      const picked = autoPickSeats(blockObj, needed);
      if (picked.length > 0) {
        const sids = [...curAssigned];
        for (const s of picked) {
          const sid = `${s.row}-${s.seat}`;
          if (!sids.includes(sid)) sids.push(sid);
          sysState.virtual_assignments[`${s.block}:${sid}`] = {
            group: person,
            subgroup: pr.department || "",
            request_id: pr.id
          };
        }
        assignedReqsCount++;
        assignedSeatsCount += picked.length;

        await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(pr.id)}`, {
          method: "PATCH",
          headers: sbHeaders({ Prefer: "return=minimal" }),
          body: JSON.stringify({
            status: "assigned",
            assigned_block: blockObj.id,
            assigned_seats: sids
          })
        });
      }
    }

    await saveSystemState(sysState);
    const updatedState = buildFullState(baseData.base_state, sysState);
    return res.status(200).json({
      success: true,
      ok: true,
      assigned_requests: assignedReqsCount,
      assigned_seats: assignedSeatsCount,
      message: `${assignedReqsCount} personelin talebi (${assignedSeatsCount} koltuk) otomatik atandı.`,
      state: updatedState
    });
  }

  // 9. GET /api/dispatch/list
  if (pathname === "/api/dispatch/list" && req.method === "GET") {
    const fullState = buildFullState(baseData.base_state, sysState);
    const sentMap = sysState.sent_map || {};
    const recipients = (fullState.groups_summary || []).map((g) => {
      const person = g.display_name;
      const phone = lookupPhone(person, phonebook);
      const cleanPhone = formatWaPhone(phone);
      const seats = g.seat_keys.map((k) => k.split(":")[1]);
      const firstBlock = g.seat_keys[0] ? g.seat_keys[0].split(":")[0] : "121";
      const indTickets = g.seat_keys.map((k) => {
        const [bId, sid] = k.split(":");
        const [r, s] = sid.split("-");
        const isSaha = bId.toUpperCase() === "SAHA";
        const rLabel = isSaha ? (r === "1" ? "A" : "B") : r;
        const bLabel = isSaha ? "Saha İçi" : `${bId} Blok`;
        return {
          block: bId,
          seat: sid,
          label: `${bLabel} · S.${rLabel} K.${s}`,
          filename: `ZEREN_SPOR_${isSaha ? "SahaIci" : bId + "Blok"}_Sira${rLabel}_Koltuk${s}.pdf`,
          download_url: `/tickets/${encodeURIComponent(TICKET_FILES[`${bId}:${sid}`] || `${bId}_${sid}.pdf`)}`,
          has_pdf: Boolean(TICKET_FILES[`${bId}:${sid}`])
        };
      });

      return {
        id: g.group,
        source: "plan",
        person,
        department: g.subgroups[0]?.subgroup || "Koltuk Planı",
        phone,
        clean_phone: cleanPhone,
        block: firstBlock,
        seats,
        seat_count: seats.length,
        has_physical_pdf: false,
        whatsapp_sent: Boolean(sentMap[g.group]),
        whatsapp_sent_at: null,
        download_url: "#",
        individual_tickets: indTickets,
        whatsapp_url: cleanPhone ? `https://web.whatsapp.com/send?phone=${cleanPhone}` : "https://web.whatsapp.com",
        wa_me_url: cleanPhone ? `https://wa.me/${cleanPhone}` : "https://wa.me/",
        message_text: ""
      };
    });

    const sentCount = recipients.filter((r) => r.whatsapp_sent).length;
    return res.status(200).json({
      ok: true,
      match_name: "Zeren Spor - Kuzeyboru",
      match_date: "08.11.2026 16:00",
      total_recipients: recipients.length,
      total_tickets: recipients.reduce((a, r) => a + r.seat_count, 0),
      sent_count: sentCount,
      pending_count: recipients.length - sentCount,
      recipients
    });
  }

  // 9.5 GET /api/tickets/download-single
  if (pathname === "/api/tickets/download-single" && req.method === "GET") {
    const block = (urlObj.searchParams.get("block") || "").trim();
    const seat = (urlObj.searchParams.get("seat") || "").trim();
    const fname = TICKET_FILES[`${block}:${seat}`];
    if (fname) {
      return res.redirect(302, `/tickets/${encodeURIComponent(fname)}`);
    }
    return res.status(404).json({ error: "Bilet bulunamadı." });
  }

  // 9.8 GET/POST /api/open-explorer (Queues open-explorer command in cloud state for local desktop helper)
  if (pathname === "/api/open-explorer") {
    const grp = (urlObj.searchParams.get("group") || body.group || "").trim();
    const sub = (urlObj.searchParams.get("subgroup") || body.subgroup || "").trim();
    const reqId = (urlObj.searchParams.get("request_id") || body.request_id || "").trim();
    sysState.explorer_cmd = {
      id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
      group: grp,
      subgroup: sub,
      request_id: reqId,
      ts: Date.now()
    };
    await saveSystemState(sysState);
    return res.status(200).json({ ok: true, queued: sysState.explorer_cmd });
  }

  // 10. POST /api/dispatch/mark-sent
  if (pathname === "/api/dispatch/mark-sent" && req.method === "POST") {
    sysState.sent_map = sysState.sent_map || {};
    const key = body.request_id || body.recipient_id || body.person;
    if (key) {
      sysState.sent_map[key] = Boolean(body.sent);
      if (body.sent) {
        sysState.explorer_cmd = {
          id: Date.now() + "_" + Math.random().toString(36).slice(2, 7),
          group: (body.person || "").trim(),
          subgroup: "",
          request_id: (body.request_id || "").trim(),
          ts: Date.now()
        };
      }
      await saveSystemState(sysState);
    }
    return res.status(200).json({ success: true, ok: true });
  }

  // 11. POST /api/dispatch/save-phone
  if (pathname === "/api/dispatch/save-phone" && req.method === "POST") {
    sysState.custom_phones = sysState.custom_phones || {};
    if (body.person && body.phone) {
      sysState.custom_phones[body.person.trim()] = body.phone.trim();
      await saveSystemState(sysState);
    }
    return res.status(200).json({ success: true, ok: true, clean_phone: formatWaPhone(body.phone) });
  }

  // 12. DELETE or POST /api/portal/request/{id}/delete
  if (pathname.startsWith("/api/portal/request/")) {
    const parts = pathname.split("/").filter(Boolean);
    const reqId = decodeURIComponent(parts[3] || "");
    if (reqId) {
      const portalReqs = await loadPortalRequests();
      const target = portalReqs.find((r) => r.id === reqId);
      await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=eq.${encodeURIComponent(reqId)}`, {
        method: "DELETE",
        headers: sbHeaders()
      });
      if (target && sysState.virtual_assignments) {
        let bId = String(target.assigned_block || target.target_block || "102").trim();
        if (bId.toLowerCase().includes("saha")) bId = "SAHA";
        const seatsToRemove = Array.isArray(target.assigned_seats) ? target.assigned_seats : [];
        // Sadece bu talebe ait koltukları sil (aynı kişinin diğer taleplerine dokunma)
        for (const sid of seatsToRemove) {
          delete sysState.virtual_assignments[`${bId}:${sid}`];
        }
        for (const [k, v] of Object.entries(sysState.virtual_assignments)) {
          if (v && v.request_id === reqId) {
            delete sysState.virtual_assignments[k];
          }
        }
        await saveSystemState(sysState);
      }
      return res.status(200).json({ success: true, message: "Talep ve bu talebe ait koltuk atamaları silindi." });
    }
  }

  // 13. POST /api/portal/requests/clear-all
  if (pathname === "/api/portal/requests/clear-all" && req.method === "POST") {
    await fetch(`${SUPABASE_URL}/rest/v1/portal_requests?id=neq.__SYSTEM_STATE__`, {
      method: "DELETE",
      headers: sbHeaders()
    });
    sysState.virtual_assignments = {};
    await saveSystemState(sysState);
    return res.status(200).json({ success: true, message: "Tüm talepler ve sanal atamalar temizlendi." });
  }

  return res.status(200).json({ ok: true });
}
