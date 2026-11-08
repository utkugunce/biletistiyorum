import crypto from 'node:crypto';

const REVISION = Symbol('database revision');
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  if (!key) throw new HttpError(503, 'Sunucu veritabanı anahtarı yapılandırılmamış.');
  if (key.startsWith('eyJ')) {
    let role;
    try { role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; } catch { /* invalid legacy key */ }
    if (role !== 'service_role') throw new HttpError(503, 'Sunucu için Supabase service_role anahtarı kullanılmalıdır.');
  }
  return { apikey: key, ...(key.startsWith('eyJ') ? { Authorization: `Bearer ${key}` } : {}),
    'Content-Type': 'application/json', ...extra };
}

export async function database(query, options = {}) {
  const url = process.env.SUPABASE_URL || 'https://kgchdufcqgyhycgyydhf.supabase.co';
  let response;
  try {
    response = await fetch(`${url}/rest/v1/portal_requests${query}`, {
      ...options, headers: headers(options.headers), signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, 'Veritabanına bağlanılamadı. Lütfen yeniden deneyin.');
  }
  if (!response.ok) throw new HttpError(response.status === 409 ? 409 : 503,
    'Veritabanı işlemi tamamlanamadı. Lütfen yeniden deneyin.');
  if (response.status === 204) return null;
  const text = await response.text();
  try { return text ? JSON.parse(text) : null; }
  catch { throw new HttpError(503, 'Veritabanından geçersiz yanıt alındı.'); }
}

export async function loadSystemState() {
  const rows = await database('?id=eq.__SYSTEM_STATE__&select=assigned_seats');
  const state = rows?.[0]?.assigned_seats;
  if (!state || typeof state !== 'object' || Array.isArray(state))
    throw new HttpError(503, 'Sistem durumu okunamadı; hiçbir değişiklik kaydedilmedi.');
  Object.defineProperty(state, REVISION, { value: state.version ?? null, writable: true });
  return state;
}

export async function saveSystemState(state) {
  const previous = state[REVISION];
  if (previous === undefined) throw new HttpError(409, 'Güncel sistem durumu yeniden yüklenmeli.');
  const version = Number(previous || 0) + 1;
  const condition = previous === null ? 'is.null' : `eq.${encodeURIComponent(previous)}`;
  // The predicate and update execute as one PostgreSQL statement. No RPC or
  // process-local mutex can substitute for this database compare-and-swap.
  const rows = await database(`?id=eq.__SYSTEM_STATE__&assigned_seats->>version=${condition}&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ assigned_seats: { ...state, version } }),
  });
  if (!Array.isArray(rows) || rows.length !== 1) {
    const error = new HttpError(409, 'Başka bir işlem verileri güncelledi. Yenileyip yeniden deneyin.');
    error.retryable = true;
    throw error;
  }
  state.version = version;
  state[REVISION] = version;
}

export async function mutateSystemState(change, attempts = 5) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const state = await loadSystemState();
    const value = await change(state);
    try { await saveSystemState(state); return { state, value }; }
    catch (error) { if (error.status !== 409 || attempt === attempts - 1) throw error; }
  }
}

export function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function getToken(req) {
  const cookie = String(req.headers.cookie || '').split(';').find(v => v.trim().startsWith('zeren_admin_token='));
  if (cookie) return cookie.trim().slice('zeren_admin_token='.length);
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.headers['x-admin-token'] || '');
}

export function authenticated(req, state) {
  const session = state.sessions?.[tokenHash(getToken(req))];
  return Boolean(session && session.expires_at > Date.now());
}

export function passwordMatches(password, state) {
  if (state.admin_password_hash) {
    const [salt, digest] = state.admin_password_hash.split(':');
    if (!salt || !digest || digest.length !== 128) return false;
    return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(digest, 'hex'));
  }
  if (process.env.VERCEL && (!process.env.ZEREN_ADMIN_PASSWORD || process.env.ZEREN_ADMIN_PASSWORD.length < 12))
    throw new HttpError(503, 'Güçlü başlangıç yönetici şifresi sunucu ayarlarında tanımlanmalıdır.');
  const legacy = process.env.ZEREN_ADMIN_PASSWORD || state.admin_password;
  return Boolean(legacy) && tokenHash(password) === tokenHash(legacy);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

export function originGuard(req) {
  const origin = req.headers.origin;
  if (!origin || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  let host;
  try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Geçersiz istek kaynağı.'); }
  if (host !== req.headers.host) throw new HttpError(403, 'Bu kaynaktan işlem yapılamaz.');
}

export function fail(res, error) {
  if (error instanceof SyntaxError) error = new HttpError(400, 'Geçersiz JSON isteği.');
  return res.status(error.status || 500).json({ detail: error.status ? error.message : 'İşlem tamamlanamadı.', error: error.status ? error.message : 'İşlem tamamlanamadı.' });
}

export const DEFAULT_MATCH_ID = '20261108_kuzeyboru';
export function matchMetadata(state) {
  return state.matches?.length ? state.matches : [{ id: DEFAULT_MATCH_ID, title: 'Zeren Spor - Kuzeyboru', date: '08.11.2026 16:00' }];
}

export function requestMatch(row, state) {
  if (state.request_matches?.[row.id]) return state.request_matches[row.id];
  const normalize = text => String(text || '').toLocaleLowerCase('tr').replace('kulübü ', '').trim();
  const match = matchMetadata(state).find(m => normalize(m.title) === normalize(row.match_name));
  if (match) return match.id;
  // An unknown historical match must never be silently treated as the active
  // match. It becomes visible when its own metadata is registered.
  return row.match_name ? 'legacy-' + tokenHash(row.match_name).slice(0, 16) : DEFAULT_MATCH_ID;
}

export function matchState(state, id = state.active_match_id || DEFAULT_MATCH_ID) {
  // Retain legacy root assignments for the original match. New matches never
  // inherit those assignments or sending records.
  if (id === DEFAULT_MATCH_ID) return state;
  state.match_states ||= {};
  return state.match_states[id] ||= { virtual_assignments: {}, sent_map: {} };
}

export function assignedKeys(row, state) {
  const map = matchState(state, requestMatch(row, state)).virtual_assignments || {};
  return Object.keys(map).filter(key => map[key]?.request_id === row.id);
}
