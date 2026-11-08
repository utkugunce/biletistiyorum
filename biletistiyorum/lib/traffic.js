import { tokenHash, HttpError } from './store.js';

// Best-effort per-process abuse limit. Serverless instances do not share this
// map; distributed flood protection must be configured at the Vercel edge.
const buckets = new Map();
export function checkTraffic(req, res, scope, limit) {
  const now = Date.now();
  for (const [key, entry] of buckets) if (entry.until <= now) buckets.delete(key);
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].trim();
  const key = scope + ':' + tokenHash(ip);
  let entry = buckets.get(key);
  if (!entry) {
    // Bound memory growth from many distinct clients.
    if (buckets.size >= 10000) buckets.delete(buckets.keys().next().value);
    entry = { count: 0, until: now + 60000 };
    buckets.set(key, entry);
  }
  if (entry.count >= limit) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.until - now) / 1000))));
    throw new HttpError(429, 'Çok fazla işlem. Bir dakika sonra tekrar deneyiniz.');
  }
  entry.count++;
}
