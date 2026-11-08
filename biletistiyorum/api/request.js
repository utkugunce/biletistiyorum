import crypto from 'node:crypto';
import { getBaseData } from './admin.js';
import { database, loadSystemState, mutateSystemState, authenticated, tokenHash, originGuard, fail, HttpError, matchMetadata, assignedKeys, matchState, requestMatch } from '../lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    originGuard(req);
    if (req.method === 'GET') {
      const state = await loadSystemState();
      if (!authenticated(req, state)) throw new HttpError(401, 'Yönetici doğrulaması gerekli.');
      const rows = await database('?id=neq.__SYSTEM_STATE__&select=*&order=created_at.desc');
      return res.status(200).json(rows.filter(row => !state.deleted_requests?.[row.id]).map(original => {
        const row = { ...original, ...state.request_overrides?.[original.id] };
        const keys = assignedKeys(row, state);
        return { ...row, assigned_seats: keys.map(key => key.split(':')[1]),
          assigned_block: keys[0]?.split(':')[0] || '',
          status: keys.length >= row.requested_count ? 'assigned' : 'pending',
          whatsapp_sent: Boolean(matchState(state, requestMatch(row, state)).sent_map?.[row.id]) };
      }));
    }
    if (req.method !== 'POST') return res.status(405).json({ detail: 'Method not allowed' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const count = Number(body.requested_count);
    const person = String(body.person || '').trim();
    const phone = String(body.phone || '').replace(/[^+\d]/g, '');
    if (!person || person.length > 150) throw new HttpError(400, 'Geçerli ad soyad giriniz.');
    if (!Number.isInteger(count) || count < 1 || count > 100) throw new HttpError(400, 'Bilet adedi 1–100 arasında tam sayı olmalıdır.');
    if (!/^\+?\d{10,15}$/.test(phone)) throw new HttpError(400, 'Geçerli WhatsApp telefon numarası giriniz.');
    const idempotency = String(req.headers['idempotency-key'] || crypto.randomBytes(32).toString('hex'));
    if (!/^[\w-]{32,128}$/.test(idempotency)) throw new HttpError(400, 'Geçersiz işlem anahtarı.');
    const access = tokenHash('tracking:' + idempotency);
    const input = {
      person, phone, requested_count: count, department: String(body.department || '').slice(0, 150),
      target_block: /saha/i.test(String(body.target_block || '')) ? 'SAHA' : String(body.target_block || '').trim().slice(0, 30),
      description: String(body.description || '').slice(0, 2000),
      ticket_type: String(body.ticket_type || 'Davetiye / Protokol').slice(0, 100),
      match_name: String(body.match_name || ''),
    };
    const payloadHash = tokenHash(JSON.stringify({ ...input, match_id: body.match_id || '' }));
    const result = await mutateSystemState(state => {
      const match = matchMetadata(state).find(m => m.id === body.match_id || m.title === input.match_name ||
        m.title.replace('Kulübü ', '') === input.match_name.replace('Kulübü ', ''));
      if (!match) throw new HttpError(400, 'Aktif bir maç seçiniz.');
      const template = state.match_templates?.[match.id] || getBaseData().base_state;
      if (input.target_block && !Object.hasOwn(template.blocks || {}, input.target_block)) throw new HttpError(400, 'Bu maç için geçerli bir blok seçiniz.');
      const existing = state.request_operations?.[tokenHash(idempotency)];
      if (existing && existing.payload_hash !== payloadHash) throw new HttpError(409, 'Bu işlem anahtarı farklı bir talep için kullanılmış.');
      const id = existing?.id || `ZS-${crypto.randomUUID()}`;
      state.request_operations ||= {};
      state.request_operations[tokenHash(idempotency)] = { id, payload_hash: payloadHash };
      state.tracking_access ||= {};
      state.tracking_access[id] = tokenHash(access);
      state.request_matches ||= {};
      state.request_matches[id] = match.id;
      return { id, match };
    });
    const { id, match } = result.value;
    const row = { ...input, id, match_name: match.title, status: 'pending',
      assigned_seats: [], assigned_block: '', whatsapp_sent: false, created_at: new Date().toISOString() };
    // Unique primary key + ignore duplicates makes a retried POST idempotent.
    await database('?on_conflict=id', { method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(row) });
    const stored = await database(`?id=eq.${encodeURIComponent(id)}&select=*`);
    if (!stored?.[0]) throw new HttpError(503, 'Talep kaydı doğrulanamadı; aynı formu yeniden deneyebilirsiniz.');
    return res.status(200).json({ ...stored[0], tracking_token: `${id}.${access}` });
  } catch (error) { return fail(res, error); }
}
