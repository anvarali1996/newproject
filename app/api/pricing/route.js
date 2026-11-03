import { currentRates } from '../../../lib/pricing-db.js';
import { SWAP_RATE } from '../../../lib/lovely.js';
import { jsonError } from '../../../lib/auth.js';
export const runtime = 'nodejs';
export async function GET(){try{return Response.json({rates:await currentRates(),swapRate:SWAP_RATE,swapEnabled:!!process.env.LOVELY_API_KEY});}catch(e){return jsonError(e);}}
