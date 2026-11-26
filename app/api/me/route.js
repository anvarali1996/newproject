import { auth, jsonError } from '../../../lib/auth.js';
import { registerAndGetProfile } from '../../../lib/referral.js';
import { modeAvailable } from '../../../lib/providers/index.js';
export const runtime = 'nodejs';
export async function GET(req){
  try {
    const user=auth(req); // Verifies signed initData before reading start_param.
    const profile=await registerAndGetProfile(user,req.headers.get('x-telegram-init-data'));
    // Modes behind a staged rollout; the client shows their cards only when true.
    return Response.json({...profile,features:{hd:modeAvailable('hd',user.id)}});
  } catch(e){return jsonError(e);}
}
