import { auth, jsonError } from '../../../lib/auth.js';
import { registerAndGetProfile } from '../../../lib/referral.js';
export const runtime = 'nodejs';
export async function GET(req){
  try {
    const user=auth(req); // Verifies signed initData before reading start_param.
    return Response.json(await registerAndGetProfile(user,req.headers.get('x-telegram-init-data')));
  } catch(e){return jsonError(e);}
}
