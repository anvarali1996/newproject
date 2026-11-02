import { db, upsertUser } from './db.js';

import { REFERRAL_CREDITS, DAILY_REFERRAL_CAP, TOTAL_REFERRAL_CAP, referrerFromVerifiedInitData, referralUrl } from './referral-utils.js';
export async function registerAndGetProfile(user, raw) {
  const sql = db();
  const referrerId = referrerFromVerifiedInitData(raw, user.id);
  // SQL runs atomically. Only an INSERT of a genuinely NEW user can reward an
  // existing referrer. The same user cannot collect another person's invitation.
  // Row updates enforce caps even when multiple newcomers arrive together.
  if (referrerId) {
    const free = Math.max(0, Math.min(3, Number(process.env.SIGNUP_CREDITS || 0) || 0));
    await sql`
      WITH newcomer AS (
        INSERT INTO users (id,username,first_name,credits)
        VALUES (${user.id},${user.username},${user.first_name},${free})
        ON CONFLICT (id) DO NOTHING RETURNING id
      ), rewarded AS (
        UPDATE users u SET
          credits = u.credits + ${REFERRAL_CREDITS},
          referral_total_count = u.referral_total_count + 1,
          referral_day = CURRENT_DATE,
          referral_daily_count = CASE WHEN u.referral_day = CURRENT_DATE
               THEN u.referral_daily_count + 1 ELSE 1 END
        FROM newcomer n
        WHERE u.id = ${referrerId} AND u.id <> n.id
          AND u.referral_total_count < ${TOTAL_REFERRAL_CAP}
          AND (u.referral_day <> CURRENT_DATE OR u.referral_daily_count < ${DAILY_REFERRAL_CAP})
        RETURNING u.id
      )
      INSERT INTO referral_awards (referred_id,referrer_id,credits)
      SELECT n.id,r.id,${REFERRAL_CREDITS} FROM newcomer n CROSS JOIN rewarded r
      ON CONFLICT (referred_id) DO NOTHING
    `;
  }
  // Updates username/first_name and returns current credit balance.
  const profile = await upsertUser(user);
  const stats = await sql`SELECT COUNT(*)::integer AS invited,
    COALESCE(SUM(credits),0)::integer AS earned FROM referral_awards WHERE referrer_id=${user.id}`;
  return {user:profile, referral:{url:referralUrl(user.id), invited:Number(stats[0].invited), earned:Number(stats[0].earned), reward:REFERRAL_CREDITS, dailyCap:DAILY_REFERRAL_CAP, totalCap:TOTAL_REFERRAL_CAP}};
}
