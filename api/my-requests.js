import { checkTraffic } from '../lib/traffic.js';
import { database, loadSystemState, tokenHash, assignedKeys, requestMatch, matchState, fail, HttpError } from '../lib/store.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ detail: 'Method not allowed' });
  try {
    checkTraffic(req, res, 'portal-track', 25);
    const token = String(req.headers['x-tracking-token'] || '');
    const split = token.lastIndexOf('.');
    const id = token.slice(0, split), secret = token.slice(split + 1);
    if (split < 1 || !/^[a-f0-9]{64}$/.test(secret))
      throw new HttpError(401, 'Talebinizin güvenli takip bağlantısını kullanınız. Kod veya telefon numarası tek başına erişim sağlamaz.');
    const state = await loadSystemState();
    if (state.deleted_requests?.[id] || !state.tracking_access?.[id] ||
        tokenHash(secret) !== state.tracking_access[id]) throw new HttpError(403, 'Geçersiz takip bağlantısı.');
    const rows = await database(`?id=eq.${encodeURIComponent(id)}&select=id,match_name,person,phone,requested_count,target_block,created_at`);
    return res.status(200).json(rows.map(original => {
      const row = { ...original, ...state.request_overrides?.[original.id] };
      const keys = assignedKeys(row, state);
      const count = keys.length, complete = count >= row.requested_count;
      return {
        id: row.id, match_name: row.match_name, person: row.person,
        masked_phone: row.phone ? '•••• ' + row.phone.replace(/\D/g, '').slice(-4) : '',
        requested_count: row.requested_count, target_block: row.target_block,
        assigned_block: keys[0]?.split(':')[0] || '', assigned_seats: keys.map(k => k.split(':')[1]),
        assigned_count: count, status: complete ? 'assigned' : 'pending',
        fulfillment_status: complete ? 'completed' : count ? 'partial' : 'pending',
        whatsapp_sent: Boolean(matchState(state, requestMatch(row, state)).sent_map?.[id]),
        created_at: row.created_at,
      };
    }));
  } catch (error) { return fail(res, error); }
}
