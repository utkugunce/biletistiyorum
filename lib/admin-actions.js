import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { database, saveSystemState, mutateSystemState, HttpError, DEFAULT_MATCH_ID, matchMetadata, matchState, requestMatch, assignedKeys, tokenHash } from './store.js';

const blockId = value => {
  const s = String(value || '102').trim();
  if (/saha/i.test(s)) return 'SAHA';
  const m = s.match(/\d+/);
  return m ? m[0] : s;
};
function method(req, expected) { if (req.method !== expected) throw new HttpError(405, `${expected} yöntemi gerekli.`); }

async function requests(root, id) {
  const rows = await database('?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc');
  const plans = Object.values(matchState(root, id).plan_requests || {});
  return [...rows, ...plans].map(row => ({ ...row, ...root.request_overrides?.[row.id] }))
    .filter(row => !root.deleted_requests?.[row.id] && requestMatch(row, root) === id);
}

function queue(view, matchId, row) {
  view.explorer_commands ||= [];
  if (view.explorer_commands.filter(c => c.status === 'pending').length >= 100)
    throw new HttpError(429, 'Bekleyen klasör işlemleri tamamlanmalı.');
  const command = { id: crypto.randomUUID(), match_id: matchId, group: row.person,
    request_id: row.id, ts: Date.now(), status: 'pending', attempts: 0 };
  view.explorer_commands = [...view.explorer_commands.filter(c => c.status === 'pending' || c.ts > Date.now() - 86400000), command];
  return command;
}

function phoneResolver(root, baseData, helpers) {
  const combined = { ...(baseData.phonebook || {}) };
  for (const [k, v] of Object.entries(root.custom_phones || {})) {
    const kNorm = helpers.normalizeName(k);
    const existingKey = Object.keys(combined).find(name => helpers.normalizeName(name) === kNorm);
    if (existingKey) delete combined[existingKey];
    combined[k] = v;
  }
  const resolve = person => helpers.lookupPhone(person, root.custom_phones || {}) ||
    helpers.lookupPhone(person, baseData.phonebook || {});
  resolve.ownerOf = (phone, excludePerson = '') => {
    const clean = helpers.formatWaPhone(phone);
    if (!clean) return '';
    const excludeNorm = helpers.normalizeName(excludePerson);
    const seen = new Set();
    const owners = [];
    for (const [name, value] of Object.entries(combined)) {
      const nameNorm = helpers.normalizeName(name);
      if (!nameNorm || nameNorm === excludeNorm || seen.has(nameNorm)) continue;
      if (helpers.formatWaPhone(value) === clean) {
        seen.add(nameNorm);
        owners.push(name);
      }
    }
    return owners.join(', ');
  };
  return resolve;
}

function summaries(rows, root, view, phoneForPerson) {
  return rows.map(row => {
    const keys = assignedKeys(row, root), count = keys.length, needed = Number(row.requested_count);
    const complete = count >= needed && needed > 0, partial = count > 0 && !complete;
    const sent = Boolean(view.sent_map?.[row.id]);
    const assignedBlock = keys[0]?.split(':')[0];
    const directoryPhone = phoneForPerson(row.person) || '';
    const resolvedPhone = String(row.phone || '').trim() || directoryPhone;
    const phoneOwner = typeof phoneForPerson.ownerOf === 'function'
      ? phoneForPerson.ownerOf(resolvedPhone, row.person)
      : '';
    return { ...row, request_id: row.id, source: row.source || 'portal', person: row.person,
      match: row.match_name, phone: resolvedPhone,
      directory_phone: directoryPhone, phone_owner: phoneOwner,
      target_block: assignedBlock || (row.target_block ? blockId(row.target_block) : ''), suggested_group: row.person,
      suggested_subgroup: row.department || '', matched_keys: keys,
      matched_seats: keys.map(k => k.split(':')[1]), assigned_count: count,
      requested_count: needed, whatsapp_sent: sent,
      fulfillment_status: complete ? 'completed' : partial ? 'partial' : 'pending',
      status: complete ? 'assigned' : 'pending',
      status_badge: sent ? 'Gönderildi olarak işaretlendi' : complete ? 'Koltuklar hazır' : partial ? 'Kısmen atandı' : 'Atama bekliyor',
      status_color: sent || complete ? '#047857' : partial ? '#b45309' : '#1d4ed8',
      progress_pct: needed ? Math.min(100, Math.round(count / needed * 100)) : 0,
      aliases: [String(row.person).toLocaleLowerCase('tr')],
    };
  });
}

export async function runAdmin(req, res, root, helpers) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const route = url.pathname;
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  let id = String(req.headers['x-match-id'] || root.active_match_id || DEFAULT_MATCH_ID);
  if (!matchMetadata(root).some(m => m.id === id)) throw new HttpError(404, 'Maç bulunamadı.');
  let view = matchState(root, id);
  view.virtual_assignments ||= {};
  view.sent_map ||= {};
  const baseData = helpers.getBaseData();
  const phoneForPerson = phoneResolver(root, baseData, helpers);
  const full = () => {
    const template = structuredClone(root.match_templates?.[id] || baseData.match_templates?.[id] || baseData.base_state);
    if (id !== DEFAULT_MATCH_ID && !root.match_templates?.[id] && !baseData.match_templates?.[id]) {
      for (const block of Object.values(template.blocks || {})) block.tickets = {};
    }
    const result = helpers.buildFullState(template, view);
    const meta = matchMetadata(root).find(m => m.id === id);
    result.folder = id;
    result.folder_name = meta.title;
    result.match_info = { match_id: id, match_name: meta.title, match_date: meta.date || '' };
    result.matches = matchMetadata(root).map(m => ({ ...m, folder: m.id }));
    result.can_undo = false; result.can_redo = false;
    result.history = root.history || [];
    result.local_companion = root.companions?.[id] || Object.values(root.companions || {}).find(c => Date.now() - c.last_seen < 30000) || null;
    return result;
  };
  const all = await requests(root, id);
  const find = requestId => {
    const row = all.find(r => r.id === requestId);
    if (!row) throw new HttpError(404, 'Talep bu maçta bulunamadı.');
    return row;
  };
  const validSeat = key => {
    const [block, sid] = key.split(':');
    const [r, s] = (sid || '').split('-').map(Number);
    const obj = full().blocks?.[block];
    if (!obj || !obj.rows.some(row => row.row === r && (row.cells || row.seats || []).includes(s)))
      throw new HttpError(400, 'Geçersiz blok veya koltuk.');
  };
  const assign = (row, keys) => {
    if (!Array.isArray(keys) || !keys.length || keys.length > 100) throw new HttpError(400, 'Koltuk seçiniz.');
    const existing = assignedKeys(row, root);
    const added = [...new Set(keys)].filter(k => !existing.includes(k));
    if (existing.length + added.length > Number(row.requested_count)) throw new HttpError(400, 'Seçim talebin kalan adedini aşıyor.');
    for (const key of keys) {
      validSeat(key);
      const owner = view.virtual_assignments[key];
      const [b, sid] = key.split(':');
      const physical = full().blocks[b].tickets[sid];
      if (!owner && physical?.external_owner) throw new HttpError(409, 'Bu PDF elle düzenlenen bir kişi klasöründe. Önce Windows üzerinden havuza taşıyınız.');
      if (owner && owner.request_id !== row.id) throw new HttpError(409, 'Koltuk başka bir talebe atanmış.');
    }
    for (const key of keys) view.virtual_assignments[key] = {
      group: row.person, subgroup: row.department || '', request_id: row.id,
    };
    delete view.sent_map[row.id];
  };
  const commit = async () => { await saveSystemState(root); return res.status(200).json(full()); };

  if (route === '/api/state') { method(req, 'GET'); return res.status(200).json(full()); }
  if (route === '/api/excel/summary' || route === '/api/excel/reload') {
    method(req, route.endsWith('reload') ? 'POST' : 'GET');
    const rows = summaries(all, root, view, phoneForPerson);
    const requested = rows.reduce((n, r) => n + r.requested_count, 0), assigned = rows.reduce((n, r) => n + r.assigned_count, 0);
    return res.status(200).json({ ok: true, requests: rows, active_match_name: full().match_info.match_name,
      available_matches: matchMetadata(root).map(m => m.title), total_requested: requested,
      total_assigned: assigned, total_pending: Math.max(0, requested - assigned),
      completed_count: rows.filter(r => r.fulfillment_status === 'completed').length,
      partial_count: rows.filter(r => r.fulfillment_status === 'partial').length,
      pending_count: rows.filter(r => r.fulfillment_status === 'pending').length,
      portal_requests_count: rows.length, fulfillment_pct: requested ? Math.round(assigned / requested * 100) : 0 });
  }
  if (route === '/api/assign') {
    method(req, 'POST');
    const keys = (body.seats || []).map(s => `${s.block}:${s.row}-${s.seat}`);
    keys.forEach(validSeat);
    if (!body.group) {
      for (const key of keys) {
        if (body.request_id && view.virtual_assignments[key]?.request_id !== body.request_id) throw new HttpError(409, 'Koltuk sahipliği değişmiş.');
        const previous = view.virtual_assignments[key]?.request_id;
        delete view.virtual_assignments[key]; if (previous) delete view.sent_map[previous];
      }
    } else {
      let row;
      if (body.request_id) row = find(body.request_id);
      else {
        const candidates = all.filter(r => helpers.normalizeName(r.person) === helpers.normalizeName(body.group) && assignedKeys(r, root).length < r.requested_count);
        if (candidates.length > 1) throw new HttpError(409, 'Bu kişinin birden fazla talebi var. Talep kartından atama yapınız.');
        row = candidates[0];
        if (!row) {
          const planId = 'PLAN-' + crypto.randomUUID();
          row = { id: planId, person: String(body.group).trim(), department: String(body.subgroup || ''),
            requested_count: keys.length, target_block: keys[0]?.split(':')[0], match_name: full().match_info.match_name, source: 'plan' };
          view.plan_requests ||= {}; view.plan_requests[planId] = row;
          root.request_matches ||= {}; root.request_matches[planId] = id;
        }
      }
      assign(row, keys);
    }
    return await commit();
  }
  if (route === '/api/excel/assign-request' || route === '/api/matches/auto-assign-all') {
    method(req, 'POST');
    const rows = route.endsWith('auto-assign-all') ? all : [find(body.request_id)];
    let assignedCount = 0, changed = 0;
    for (const row of rows) {
      const needed = row.requested_count - assignedKeys(row, root).length;
      if (needed <= 0) continue;
      const state = full();
      const preferred = body.block_id || row.target_block;
      const candidates = Object.values(state.blocks).map(obj => ({ obj, seats: helpers.autoPickSeats(obj, needed) }));
      const choice = candidates.find(c => c.seats.length >= needed) || candidates.sort((a,b) => b.seats.length-a.seats.length)[0];
      const block = preferred ? blockId(preferred) : choice?.obj.id;
      const obj = state.blocks[block];
      if (!obj) throw new HttpError(400, 'Blok bulunamadı.');
      const keys = body.seat_ids?.length ? body.seat_ids.map(s => `${block}:${s}`) : helpers.autoPickSeats(obj, needed).map(s => `${s.block}:${s.row}-${s.seat}`);
      if (!keys.length) { if (rows.length === 1) throw new HttpError(409, 'Uygun boş bilet bulunamadı.'); continue; }
      assign(row, keys); assignedCount += keys.length; changed++;
    }
    await saveSystemState(root);
    return res.status(200).json(route.endsWith('auto-assign-all') ? { ok: true, success: true, assigned_requests: changed, assigned_seats: assignedCount, state: full() } : full());
  }
  if (route === '/api/groups/unassign') {
    method(req, 'POST');
    if (body.request_id) find(body.request_id);
    for (const [key, owner] of Object.entries(view.virtual_assignments)) {
      const selected = body.request_id ? owner.request_id === body.request_id :
        body.seat_keys?.length ? body.seat_keys.includes(key) : owner.group === body.group && (!body.subgroup || owner.subgroup === body.subgroup);
      if (selected) { delete view.virtual_assignments[key]; delete view.sent_map[owner.request_id]; }
    }
    return await commit();
  }
  if (route === '/api/shift') {
    method(req, 'POST');
    const sources = (body.source_seats || []).map(s => `${s.block}:${s.row}-${s.seat}`);
    const targets = (body.target_seats || []).map(s => `${s.block}:${s.row}-${s.seat}`);
    if (!sources.length || sources.length !== targets.length || new Set(targets).size !== targets.length || new Set(sources).size !== sources.length)
      throw new HttpError(400, 'Kaynak ve hedef koltuk sayıları eşit ve benzersiz olmalıdır.');
    [...sources, ...targets].forEach(validSeat);
    const moving = sources.map(k => view.virtual_assignments[k]);
    if (moving.some(v => !v)) throw new HttpError(409, 'Kaynak koltuklardan birinin ataması değişmiş.');
    for (const key of targets) {
      const [b, sid] = key.split(':');
      if (!sources.includes(key) && (view.virtual_assignments[key] || full().blocks[b].tickets[sid]?.external_owner)) throw new HttpError(409, 'Hedef koltuk dolu.');
    }
    sources.forEach(k => delete view.virtual_assignments[k]);
    targets.forEach((k, i) => { view.virtual_assignments[k] = moving[i]; delete view.sent_map[moving[i].request_id]; });
    return await commit();
  }
  if (route === '/api/dispatch/list') {
    method(req, 'GET');
    const state = full();
    const recipients = summaries(all, root, view, phoneForPerson).filter(r => r.assigned_count).map(r => ({
      ...r, id: r.request_id, clean_phone: helpers.formatWaPhone(r.phone), seat_count: r.assigned_count,
      ticket_count: r.assigned_count, seats_formatted: r.matched_keys.map(key => { const [block, seat] = key.split(':'); return `${block} Blok · ${seat}`; }).join(', '),
      block: r.target_block, seats: r.matched_seats, individual_tickets: r.matched_keys.map(key => {
        const [block, seat] = key.split(':'), ticket = state.blocks[block]?.tickets?.[seat];
        return { block, seat, label: `${block} · ${seat}`, filename: ticket?.filename || `${block}_${seat}.pdf`,
          download_url: `/api/tickets/download-single?block=${encodeURIComponent(block)}&seat=${encodeURIComponent(seat)}`,
          has_pdf: Boolean(ticket?.has_pdf) };
      }), message_text: '', whatsapp_url: `https://wa.me/${helpers.formatWaPhone(r.phone)}`,
    }));
    return res.status(200).json({ ok: true, recipients, match_name: state.match_info.match_name,
      total_recipients: recipients.length, total_tickets: recipients.reduce((n, r) => n + r.seat_count, 0),
      sent_count: recipients.filter(r => r.whatsapp_sent).length,
      progress_pct: recipients.length ? Math.round(recipients.filter(r => r.whatsapp_sent).length / recipients.length * 100) : 0,
      pending_count: recipients.filter(r => !r.whatsapp_sent).length });
  }
  if (route === '/api/dispatch/mark-sent') {
    method(req, 'POST'); const row = find(body.request_id);
    if (body.sent && assignedKeys(row, root).length < row.requested_count) throw new HttpError(409, 'Talebin tüm koltukları hazır değil.');
    view.sent_map[row.id] = Boolean(body.sent);
    view.sent_at ||= {}; view.sent_at[row.id] = body.sent ? Date.now() : null;
    await saveSystemState(root);
    return res.status(200).json({ ok: true, success: true, request_id: row.id, sent: Boolean(body.sent) });
  }
  if (route === '/api/dispatch/save-phone') {
    method(req, 'POST'); const row = find(body.request_id);
    const phone = String(body.phone || '').replace(/[^+\d]/g, '');
    if (!/^\+?\d{10,15}$/.test(phone)) throw new HttpError(400, 'Geçerli telefon numarası giriniz.');
    root.request_overrides ||= {}; root.request_overrides[row.id] = { ...root.request_overrides[row.id], phone };
    await saveSystemState(root); return res.status(200).json({ ok: true, clean_phone: helpers.formatWaPhone(phone) });
  }
  if (route === '/api/open-explorer') {
    method(req, 'POST'); const row = find(body.request_id || url.searchParams.get('request_id'));
    const command = queue(view, id, row); await saveSystemState(root);
    return res.status(200).json({ ok: true, queued: command, command_id: command.id });
  }
  if (route === '/api/status') {
    method(req, 'GET');
    const companion = root.companions?.[id] || Object.values(root.companions || {}).find(c => Date.now() - c.last_seen < 30000) || null;
    return res.status(200).json({ ok: true, match_id: id,
      companion, commands: view.explorer_commands || [] });
  }
  const requestRoute = route.match(/^\/api\/portal\/request\/([^/]+)\/(delete|update|tracking-link)$/);
  if (requestRoute) {
    method(req, 'POST'); const row = find(decodeURIComponent(requestRoute[1]));
    const action = requestRoute[2];
    if (action === 'tracking-link') {
      const access = crypto.randomBytes(32).toString('hex'); root.tracking_access ||= {}; root.tracking_access[row.id] = tokenHash(access);
      await saveSystemState(root); return res.status(200).json({ token: `${row.id}.${access}` });
    }
    if (action === 'delete') {
      // One atomic snapshot: tombstone and owned assignments change together.
      root.deleted_requests ||= {}; root.deleted_requests[row.id] = Date.now();
      for (const [key, owner] of Object.entries(view.virtual_assignments)) if (owner.request_id === row.id) delete view.virtual_assignments[key];
      delete view.sent_map[row.id]; if (root.tracking_access) delete root.tracking_access[row.id];
    } else {
      const count = Number(body.requested_count ?? row.requested_count);
      if (!Number.isInteger(count) || count < 1 || count > 100 || count < assignedKeys(row, root).length) throw new HttpError(400, 'Geçersiz bilet adedi; önce fazla atamaları kaldırınız.');
      const override = { ...root.request_overrides?.[row.id], requested_count: count };
      for (const field of ['person', 'phone', 'department', 'description', 'target_block']) if (body[field] !== undefined) override[field] = String(body[field]).trim();
      if (override.person === '') throw new HttpError(400, 'Ad soyad boş olamaz.');
      if (override.target_block && blockId(override.target_block) !== blockId(row.target_block) && assignedKeys(row, root).length) throw new HttpError(409, 'Blok değiştirmeden önce mevcut atamaları kaldırınız.');
      root.request_overrides ||= {}; root.request_overrides[row.id] = override;
      for (const value of Object.values(view.virtual_assignments)) if (value.request_id === row.id && override.person) value.group = override.person;
    }
    await saveSystemState(root); return res.status(200).json({ ok: true, success: true });
  }
  if (route === '/api/select-folder') {
    method(req, 'POST'); const selected = matchMetadata(root).find(m => m.id === body.folder_path || m.folder === body.folder_path);
    if (!selected) throw new HttpError(404, 'Maç bulunamadı.'); root.active_match_id = selected.id;
    id = selected.id; view = matchState(root, id); return await commit();
  }
  if (route === '/api/matches/create') {
    method(req, 'POST'); const title = String(body.match_name || '').trim();
    if (!title || matchMetadata(root).some(m => m.title === title)) throw new HttpError(400, 'Benzersiz bir maç adı giriniz.');
    root.matches = [...matchMetadata(root), { id: crypto.randomUUID(), title, date: String(body.match_date || '') }];
    id = root.matches.at(-1).id; root.active_match_id = id; view = matchState(root, id); return await commit();
  }
  if (route === '/api/history/save') {
    method(req, 'POST'); const snapshot = full(); root.history = [{ ...snapshot.match_info, saved_at: new Date().toISOString(), total_tickets: snapshot.total_tickets, assigned_tickets: snapshot.assigned_tickets, diger_tickets: snapshot.diger_tickets, groups: snapshot.groups_summary.map(g => ({ group: g.display_name, total: g.total_count })) }, ...(root.history || [])].slice(0, 30);
    await saveSystemState(root); return res.status(200).json({ ok: true, history: root.history });
  }
  if (route === '/api/tickets/download-single') {
    method(req, 'GET'); const block = url.searchParams.get('block'), seat = url.searchParams.get('seat');
    const ticket = full().blocks[block]?.tickets?.[seat];
    if (!ticket?.has_pdf || !ticket.filename) throw new HttpError(404, 'PDF yerel Windows bilgisayarında hazırlanmalıdır.');
    const file = path.join(process.cwd(), 'tickets', path.basename(ticket.filename));
    if (!fs.existsSync(file)) throw new HttpError(404, 'PDF bulutta bulunmuyor; Windows klasöründen paylaşınız.');
    res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${block}_${seat}.pdf"`);
    return res.status(200).send(fs.readFileSync(file));
  }
  if (['/api/undo', '/api/redo', '/api/matches/upload-tickets', '/api/matches/upload-zip', '/api/browse-folder', '/api/groups'].includes(route))
    throw new HttpError(422, 'Bu işlem yerel Windows panelinden yapılmalıdır.');
  throw new HttpError(404, 'Endpoint bulunamadı.');
}

export async function handleCompanion(req, res, route) {
  const expected = process.env.ZEREN_COMPANION_TOKEN;
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 32 || !provided || tokenHash(provided) !== tokenHash(expected)) throw new HttpError(401, 'Companion doğrulaması gerekli.');
  const url = new URL(req.url, 'http://localhost');
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  if (route === '/api/companion/matches') { method(req, 'GET'); const { loadSystemState } = await import('./store.js'); return res.status(200).json(matchMetadata(await loadSystemState())); }
  const id = String(url.searchParams.get('match_id') || body.match_id || '');
  if (!id) throw new HttpError(400, 'match_id zorunludur.');
  if (route === '/api/companion/admin-action') {
    method(req, 'POST');
    const allowed = new Set(['/api/state', '/api/excel/summary', '/api/excel/reload', '/api/assign', '/api/shift', '/api/groups/unassign', '/api/excel/assign-request', '/api/matches/auto-assign-all', '/api/dispatch/list', '/api/dispatch/mark-sent', '/api/dispatch/save-phone']);
    const target = String(body.path || '');
    if (!allowed.has(target) && !/^\/api\/portal\/request\/[A-Za-z0-9_.-]+\/(delete|update|tracking-link)$/.test(target)) throw new HttpError(403, 'Bu işlem companion köprüsüne açık değil.');
    const helpers = await import('../api/admin.js');
    const { loadSystemState } = await import('./store.js');
    for (let attempt = 0; attempt < 5; attempt++) {
      const root = await loadSystemState();
      if (!matchMetadata(root).some(m => m.id === id)) throw new HttpError(404, 'Maç bulunamadı.');
      try { return await runAdmin({ ...req, url: target, method: body.method || 'GET', body: body.body || {}, headers: { ...req.headers, 'x-match-id': id } }, res, root, helpers); }
      catch (error) { if (!error.retryable || attempt === 4) throw error; }
    }
  }
  if (route === '/api/companion/requests') {
    method(req, 'GET'); const { loadSystemState } = await import('./store.js');
    const root = await loadSystemState();
    if (!matchMetadata(root).some(m => m.id === id)) throw new HttpError(404, 'Maç bulunamadı.');
    const helpers = await import('../api/admin.js');
    const phoneForPerson = phoneResolver(root, helpers.getBaseData(), helpers);
    return res.status(200).json(summaries(await requests(root, id), root, matchState(root, id), phoneForPerson).map(row => ({
      ...row, match_id: id, assigned_seats: row.matched_seats, assigned_block: row.target_block,
    })));
  }
  if (route === '/api/companion/request') {
    method(req, 'POST');
    await mutateSystemState(async root => {
      if (!matchMetadata(root).some(m => m.id === id)) throw new HttpError(404, 'Maç bulunamadı.');
      const rows = await requests(root, id), view = matchState(root, id);
      view.virtual_assignments ||= {}; view.sent_map ||= {};
      const item = body.request || {}, row = rows.find(r => r.id === (body.request_id || item.id));
      if (!row && body.operation !== 'clear') throw new HttpError(404, 'Talep bulunamadı.');
      if (body.operation === 'delete' || body.operation === 'clear') {
        const ids = body.operation === 'clear' ? rows.map(r => r.id) : [row.id];
        root.deleted_requests ||= {};
        for (const requestId of ids) {
          root.deleted_requests[requestId] = Date.now(); delete view.sent_map[requestId];
          for (const [key, value] of Object.entries(view.virtual_assignments)) if (value.request_id === requestId) delete view.virtual_assignments[key];
        }
      } else if (body.operation === 'sent') {
        if (item.whatsapp_sent && assignedKeys(row, root).length < row.requested_count) throw new HttpError(409, 'Talebin tüm koltukları hazır değil.');
        view.sent_map[row.id] = Boolean(item.whatsapp_sent);
      } else if (body.operation === 'assign') {
        const block = blockId(item.assigned_block || row.target_block);
        const proposed = [...new Set(item.assigned_seats || [])].map(seat => `${block}:${seat}`);
        if (proposed.length > row.requested_count) throw new HttpError(400, 'Talep adedi aşılamaz.');
        const { getBaseData } = await import('../api/admin.js');
        const template = root.match_templates?.[id] || getBaseData().match_templates?.[id] || getBaseData().base_state;
        for (const key of proposed) {
          const [b, sid] = key.split(':'), [r, seat] = sid.split('-').map(Number);
          if (!template.blocks?.[b]?.rows.some(row => row.row === r && (row.cells || row.seats || []).includes(seat))) throw new HttpError(400, 'Geçersiz koltuk.');
          if (view.virtual_assignments[key] && view.virtual_assignments[key].request_id !== row.id) throw new HttpError(409, 'Koltuk başka talebe ait.');
          if (!view.virtual_assignments[key] && template.blocks[b].tickets?.[sid]?.external_owner) throw new HttpError(409, 'Bu PDF elle düzenlenen bir kişi klasöründe.');
        }
        for (const [key, value] of Object.entries(view.virtual_assignments)) if (value.request_id === row.id) delete view.virtual_assignments[key];
        for (const key of proposed) view.virtual_assignments[key] = { group: row.person, subgroup: row.department || '', request_id: row.id };
        delete view.sent_map[row.id];
      } else if (body.operation === 'metadata') {
        const count = Number(item.requested_count ?? row.requested_count);
        if (!Number.isInteger(count) || count < 1 || count > 100 || count < assignedKeys(row, root).length) throw new HttpError(400, 'Geçersiz adet.');
        root.request_overrides ||= {};
        root.request_overrides[row.id] = { ...root.request_overrides[row.id], requested_count: count };
        for (const field of ['person', 'phone', 'department', 'description', 'target_block']) if (item[field] !== undefined) root.request_overrides[row.id][field] = String(item[field]).trim();
      } else throw new HttpError(400, 'Geçersiz companion işlemi.');
    });
    return res.status(200).json({ ok: true });
  }
  if (route === '/api/companion/state') {
    method(req, 'GET');
    const { loadSystemState } = await import('./store.js'); const root = await loadSystemState();
    if (!matchMetadata(root).some(m => m.id === id)) throw new HttpError(404, 'Maç bulunamadı.');
    const view = matchState(root, id);
    return res.status(200).json([{ assigned_seats: { match_id: id, virtual_assignments: view.virtual_assignments || {}, explorer_commands: (view.explorer_commands || []).filter(c => c.status === 'pending') } }]);
  }
  if (route !== '/api/companion/report') throw new HttpError(404, 'Endpoint bulunamadı.');
  method(req, 'POST');
  await mutateSystemState(async root => {
    if (!matchMetadata(root).some(m => m.id === id)) throw new HttpError(404, 'Maç bulunamadı.');
    if (body.inventory) {
      if (typeof body.inventory !== 'object' || Array.isArray(body.inventory) || Object.keys(body.inventory).length > 50) throw new HttpError(400, 'Geçersiz envanter.');
      const { getBaseData } = await import('../api/admin.js');
      const template = structuredClone(root.match_templates?.[id] || getBaseData().match_templates?.[id] || getBaseData().base_state);
      for (const block of Object.values(template.blocks)) block.tickets = {};
      let count = 0;
      for (const [blockId, data] of Object.entries(body.inventory)) {
        if (!/^(\d{3}|SAHA)$/.test(blockId) || !data || !Array.isArray(data.layout?.rows)) throw new HttpError(400, 'Geçersiz blok envanteri.');
        if (data.layout.rows.length > 200 || data.layout.rows.some(r => !r || !Number.isInteger(r.row) || r.row < 1 ||
            !Array.isArray(r.cells || r.seats) || (r.cells || r.seats).length > 500 ||
            (r.cells || r.seats).some(s => s !== null && (!Number.isInteger(s) || s < 1)))) throw new HttpError(400, 'Geçersiz blok şeması.');
        const tickets = {};
        for (const [seatId, info] of Object.entries(data.tickets || {})) {
          if (++count > 10000 || !info || typeof info !== 'object' || !/^\d+-\d+$/.test(seatId)) throw new HttpError(400, 'Geçersiz bilet envanteri.');
          const [row, seat] = seatId.split('-').map(Number);
          if (!data.layout.rows.some(r => r.row === row && (r.cells || r.seats || []).includes(seat))) throw new HttpError(400, 'Koltuk blok şemasında bulunamadı.');
          const ticket = { key: `${blockId}:${seatId}`, seat_id: seatId, block: blockId, row, seat,
            filename: path.basename(String(info.filename || '')), has_pdf: true, rel_path: '' };
          if (!matchState(root, id).virtual_assignments?.[ticket.key] && info.external_owner?.group) {
            ticket.external_owner = { group: String(info.external_owner.group).slice(0,150),
              subgroup: String(info.external_owner.subgroup || '').slice(0,150),
              status: info.external_owner.status === 'diger' ? 'diger' : 'assigned' };
          }
          tickets[seatId] = ticket;
        }
        template.blocks[blockId] = { ...template.blocks[blockId], ...data.layout, id: blockId, tickets };
      }
      root.match_templates ||= {}; root.match_templates[id] = template;
    }
    root.companions ||= {}; root.companions[id] = { last_seen: Date.now(), status: body.status === 'error' ? 'error' : 'online', error: String(body.error || '').slice(0, 250) };
    if (body.command_id) {
      const command = (matchState(root, id).explorer_commands || []).find(c => c.id === body.command_id && c.match_id === id);
      if (!command) throw new HttpError(404, 'Komut bulunamadı.');
      if (command.status === 'done') return;
      command.attempts++;
      command.status = body.success ? 'done' : command.attempts >= 3 ? 'error' : 'pending';
      command.error = String(body.error || '').slice(0, 250); command.completed_at = body.success ? Date.now() : null;
    }
  });
  return res.status(200).json({ ok: true });
}
