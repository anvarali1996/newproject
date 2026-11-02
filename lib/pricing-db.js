import { db } from './db.js';
import { priceFor } from './pricing.js';

export async function currentRates(sql = db()) {
  const rows = await sql`SELECT mode,credits_per_second FROM credit_rates`;
  const rates = {};
  for (const row of rows) rates[row.mode] = Number(row.credits_per_second);
  for (const key of ['image','act','video']) {
    if (!Number.isSafeInteger(rates[key]) || rates[key] < 1 || rates[key] > 100) {
      throw Error('Credit pricing not configured');
    }
  }
  return rates;
}
export async function billedPrice(mode, seconds, sql = db()) {
  const rates=await currentRates(sql);
  return priceFor(mode,seconds,rates);
}
