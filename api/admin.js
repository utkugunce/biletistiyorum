import fs from 'node:fs';
import path from 'node:path';
import { loadSystemState, authenticated, originGuard, fail, HttpError } from '../lib/store.js';
import { handleAuth } from '../lib/auth.js';
import { runAdmin, handleCompanion } from '../lib/admin-actions.js';
const PALETTE = ['#7E22CE','#2563EB','#059669','#D97706','#DC2626','#0891B2','#4F46E5','#BE185D','#65A30D','#9333EA'];

let cachedBase = null;
function getBaseData() {
  if (!cachedBase) {
    const p = path.join(process.cwd(), "api", "base_state.json");
    cachedBase = JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  return JSON.parse(JSON.stringify(cachedBase));
}

function normalizeName(str) {
  return String(str || '').toLocaleLowerCase('tr').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i').trim();
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

function buildFullState(baseState, sysState) {
  const st = JSON.parse(JSON.stringify(baseState));
  const vMap = sysState.virtual_assignments || {};
  const colorMap = st.colors || {};
  let colorIdx = 0;

  function getGroupColor(gName) {
    const key = gName.toLowerCase();
    if (!Object.hasOwn(colorMap, key) || !/^#[0-9a-f]{6}$/i.test(colorMap[key])) {
      Object.defineProperty(colorMap, key, { value: PALETTE[colorIdx % PALETTE.length], enumerable: true, configurable: true, writable: true });
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
      t.request_id = "";
      if (t.external_owner) {
        t.group = t.external_owner.group;
        t.subgroup = t.external_owner.subgroup || '';
        t.label = t.group + (t.subgroup ? '/' + t.subgroup : '');
        t.status = t.external_owner.status === 'diger' ? 'diger' : 'assigned';
        t.color = getGroupColor(t.group);
      }
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
      t.request_id = val.request_id || "";
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
        request_id: val.request_id || "",
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
  const grpBuckets = Object.create(null);
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
          sub_map: Object.create(null)
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
    return Boolean(t && (t.status === "unassigned" || t.status === "diger"));
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
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    originGuard(req);
    const pathname = new URL(req.url, 'http://' + (req.headers.host || 'localhost')).pathname;
    if (pathname.startsWith('/api/companion/')) return await handleCompanion(req, res, pathname);
    if (pathname.startsWith('/api/auth/')) return await handleAuth(req, res, pathname);
    for (let attempt = 0; attempt < 5; attempt++) {
      const root = await loadSystemState();
      if (!authenticated(req, root)) throw new HttpError(401, 'Yönetici doğrulaması gerekli.');
      try {
        return await runAdmin(req, res, root, { getBaseData, buildFullState, autoPickSeats, normalizeName, formatWaPhone, lookupPhone });
      } catch (error) {
        if (!error.retryable || attempt === 4) throw error;
      }
    }
  } catch (error) { return fail(res, error); }
}

export { getBaseData, buildFullState, autoPickSeats, normalizeName, formatWaPhone, lookupPhone };
