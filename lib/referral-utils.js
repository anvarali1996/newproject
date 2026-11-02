export const REFERRAL_CREDITS = 2;
export const DAILY_REFERRAL_CAP = 10;
export const TOTAL_REFERRAL_CAP = 100;

export function referrerFromVerifiedInitData(raw, newUserId) {
  // Caller MUST validate Telegram's HMAC on raw first (auth(req)).
  const value = new URLSearchParams(raw || '').get('start_param') || '';
  const m = /^ref_([1-9]\d{0,15})$/.exec(value);
  return m && m[1] !== String(newUserId) ? m[1] : null;
}

export function referralUrl(userId) {
  const bot = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '');
  const app = process.env.TELEGRAM_APP_SHORT_NAME || 'studio';
  if (!/^[a-z0-9_]{5,32}$/i.test(bot) || !/^[a-z0-9_]{3,64}$/i.test(app)) return '';
  return `https://t.me/${bot}/${app}?startapp=ref_${userId}`;
}

