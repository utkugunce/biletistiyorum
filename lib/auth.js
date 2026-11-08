import crypto from 'node:crypto';
import { loadSystemState, mutateSystemState, authenticated, getToken, tokenHash, passwordMatches, hashPassword, HttpError } from './store.js';

function cookie(req, res, token, clear = false) {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL;
  res.setHeader('Set-Cookie', `zeren_admin_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : 604800}${secure ? '; Secure' : ''}`);
}

export async function handleAuth(req, res, pathname) {
  if (pathname === '/api/auth/check' && req.method === 'GET') {
    const ok = authenticated(req, await loadSystemState());
    return res.status(200).json({ success: ok, authenticated: ok });
  }
  if (req.method !== 'POST') throw new HttpError(405, 'Bu işlem POST gerektirir.');
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  if (pathname === '/api/auth/logout') {
    const hash = tokenHash(getToken(req));
    const current = await loadSystemState();
    if (authenticated(req, current)) await mutateSystemState(state => { if (state.sessions) delete state.sessions[hash]; });
    cookie(req, res, '', true);
    return res.status(200).json({ success: true, authenticated: false });
  }
  if (pathname !== '/api/auth/login' && pathname !== '/api/auth/change-password') throw new HttpError(404, 'Endpoint bulunamadı.');
  const token = crypto.randomBytes(32).toString('hex');
  const result = await mutateSystemState(state => {
    const changing = pathname.endsWith('change-password');
    const ip = tokenHash(String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0]);
    state.login_attempts = Object.fromEntries(Object.entries(state.login_attempts || {}).filter(([, v]) => v.until > Date.now()));
    const previous = state.login_attempts[ip];
    if (previous?.until > Date.now() && previous.count >= 5) throw new HttpError(429, 'Çok fazla deneme. Bir dakika sonra tekrar deneyin.');
    if (changing && !authenticated(req, state)) throw new HttpError(401, 'Oturumunuz sona erdi.');
    if (!passwordMatches(String(changing ? body.current_password || '' : body.password || ''), state)) {
      const count = previous?.until > Date.now() ? previous.count + 1 : 1;
      state.login_attempts[ip] = { count, until: Date.now() + 60000 };
      return false;
    }
    const password = String(changing ? body.new_password || '' : body.password || '');
    if (changing && password.length < 12) throw new HttpError(400, 'Yeni şifre en az 12 karakter olmalıdır.');
    if (changing || !state.admin_password_hash) state.admin_password_hash = hashPassword(password);
    delete state.admin_password;
    // A password change invalidates every previous session, including copied tokens.
    state.sessions = changing ? {} : Object.fromEntries(Object.entries(state.sessions || {}).filter(([, v]) => v.expires_at > Date.now()));
    state.sessions[tokenHash(token)] = { expires_at: Date.now() + 7 * 86400000 };
    state.login_attempts = Object.fromEntries(Object.entries(state.login_attempts).filter(([key, v]) => key !== ip && v.until > Date.now()));
    return true;
  });
  if (!result.value) throw new HttpError(401, 'Şifre hatalı.');
  cookie(req, res, token);
  return res.status(200).json({ success: true, authenticated: true });
}
