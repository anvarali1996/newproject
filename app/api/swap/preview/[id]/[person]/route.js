import {auth,jsonError} from '../../../../../../lib/auth.js';
import {db} from '../../../../../../lib/db.js';
import {getFacePreview,isCastId} from '../../../../../../lib/lovely.js';
export const runtime='nodejs';
export async function GET(req,{params}){
  try{
    const user=auth(req);
    const {id,person}=await params;
    if(!/^[0-9a-f-]{36}$/i.test(id)||!isCastId(person))throw Error('Invalid preview');
    const sql=db();const rows=await sql`SELECT provider_id,detected_cast FROM swap_projects WHERE id=${id} AND user_id=${user.id}`;
    if(!rows.length||!rows[0].detected_cast.some(x=>x.id===person))return new Response('Not found',{status:404});
    return await getFacePreview(rows[0].provider_id,person);
  }catch(e){return jsonError(e);}
}
