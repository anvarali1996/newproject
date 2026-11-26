import { createHmac, timingSafeEqual } from 'node:crypto';
import { unauthorized } from './errors.js';

export { jsonError } from './errors.js';

// Never trust initDataUnsafe or a user ID supplied in a request body.
export function verifyTelegramInitData(raw, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!raw || !token) throw unauthorized('Telegram authentication required');
  const q = new URLSearchParams(raw);
  const got = q.get('hash');
  const age = Number(q.get('auth_date'));
  if (!got || !/^[0-9a-f]{64}$/i.test(got) || !Number.isSafeInteger(age) ||
      age > nowSeconds + 60 || nowSeconds - age > 86400) {
    throw unauthorized('Telegram authentication expired or invalid');
  }
  // Telegram specifies a plain alphabetical (byte-order) sort, not a locale-aware one.
  const check = [...q.entries()]
    .filter(([k]) => k !== 'hash')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(check).digest();
  if (!timingSafeEqual(Buffer.from(got, 'hex'), expected)) throw unauthorized('Invalid Telegram signature');
  let user;
  try { user = JSON.parse(q.get('user') || '{}'); } catch { throw unauthorized('Bad Telegram user'); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw unauthorized('Bad Telegram user ID');
  return { id: String(user.id), username: String(user.username || ''), first_name: String(user.first_name || '') };
}

export function auth(request) {
  const raw = request.headers.get('x-telegram-init-data');
  // Local-only smoke test. NEVER allow demo auth on a production deploy.
  if (process.env.NODE_ENV !== 'production' && raw === 'dev:local') {
    return { id: 'demo-local', username: 'developer', first_name: 'Developer' };
  }
  return verifyTelegramInitData(raw, process.env.TELEGRAM_BOT_TOKEN);
}
