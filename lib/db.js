import { neon } from '@neondatabase/serverless';

export function db() {
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  return neon(process.env.DATABASE_URL);
}

export async function upsertUser(user) {
  const sql = db();
  const free = Math.max(0, Math.min(3, Number(process.env.SIGNUP_CREDITS || 0) || 0));
  const rows = await sql`
    INSERT INTO users (id, username, first_name, credits)
    VALUES (${user.id}, ${user.username}, ${user.first_name}, ${free})
    ON CONFLICT (id) DO UPDATE SET
      username = EXCLUDED.username,
      first_name = EXCLUDED.first_name
    RETURNING id, username, first_name, credits
  `;
  return rows[0];
}
