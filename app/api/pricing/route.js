import { currentRates } from '../../../lib/pricing-db.js';
import { jsonError } from '../../../lib/auth.js';
export const runtime = 'nodejs';
export async function GET(){try{return Response.json({rates:await currentRates()});}catch(e){return jsonError(e);}}
