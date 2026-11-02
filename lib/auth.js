import { createHmac, timingSafeEqual } from 'node:crypto';

// Never trust initDataUnsafe or a user ID supplied in a request body.
export function verifyTelegramInitData(raw, token, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!raw || !token) throw new Error('Telegram authentication required');
  const q = new URLSearchParams(raw);
  const got = q.get('hash');
  const age = Number(q.get('auth_date'));
  if (!got || !/^[0-9a-f]{64}$/i.test(got) || !Number.isSafeInteger(age) ||
    age > nowSeconds + 60 || nowSeconds - age > 86400) {
    throw new Error('Telegram authentication expired or invalid');
  }

  const check = [...q.entries()]
    .filter(([key]) => key !== 'hash')
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secret = createHmac('sha256', 'WebAppData')
    .update(token)
    .digest();

  const expected = createHmac('sha256', secret)
    .update(check)
    .digest();

  if (!timingSafeEqual(Buffer.from(got, 'hex'), expected)) throw new Error('Invalid Telegram signature');
  let user;
  try { user = JSON.parse(q.get('user') || '{}'); } catch { throw new Error('Bad Telegram user'); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0) throw new Error('Bad Telegram user ID');
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

export function jsonError(error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  const authError = /Telegram|signature|auth|user ID/i.test(message);
  const invalid = /Invalid|Missing|Unsupported|size|prompt|file|credits|media|source/i.test(message);
  console.error('[API]', message);
  return Response.json({ error: message }, { status: authError ? 401 : invalid ? 400 : 500 });
}
