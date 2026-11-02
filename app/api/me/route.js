import { auth, jsonError } from '../../../lib/auth.js';
import { upsertUser } from '../../../lib/db.js';
export const runtime = 'nodejs';
export async function GET(req){
  try { return Response.json({user:await upsertUser(auth(req))}); }
  catch(e){return jsonError(e);}
}
