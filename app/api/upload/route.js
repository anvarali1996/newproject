import { randomUUID } from 'node:crypto';
import { auth, jsonError } from '../../../lib/auth.js';
import { signedUpload, rule } from '../../../lib/r2.js';
export const runtime = 'nodejs';
export async function POST(req) {
  try {
    const user=auth(req);
    const {type,size,mode}=await req.json();
    const config=rule(type);
    if(!config||config.mode!==mode || !Number.isSafeInteger(size) || size<=0 || size>config.max)
      throw new Error('Unsupported media type or file size');
    const key=`uploads/${user.id}/${randomUUID()}.${config.ext}`;
    return Response.json({key,uploadUrl:await signedUpload(key,type)});
  } catch(e){return jsonError(e);}
}
