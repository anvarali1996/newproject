// In-process Postgres (PGlite) with the project's own migrations, behind a
// tagged-template function that mimics @neondatabase/serverless ($n
// placeholders, values sent as text), so lib/ SQL runs exactly as in prod.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const MIGRATIONS = ['schema.sql', 'upgrade_v2.sql', 'upgrade_v2_1.sql', 'upgrade_v2_2.sql',
  'upgrade_viggle.sql', 'upgrade_rate_limits.sql'];

export async function createDb() {
  const pg = new PGlite();
  for (const f of MIGRATIONS) await pg.exec(readFileSync(new URL(`../../sql/${f}`, import.meta.url), 'utf8'));
  return async (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + '$' + i + s);
    const params = values.map(v => (v == null ? null : typeof v === 'object' ? JSON.stringify(v) : String(v)));
    return (await pg.query(text, params)).rows;
  };
}
