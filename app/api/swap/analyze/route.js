import {randomUUID} from 'node:crypto';
import {auth,jsonError} from '../../../../lib/auth.js';
import {db,upsertUser} from '../../../../lib/db.js';
import {verifiedVideoSeconds,verifySource} from '../../../../lib/r2.js';
import {analyzeVideo,SWAP_RATE} from '../../../../lib/lovely.js';
export const runtime='nodejs';
export const maxDuration=45;
export async function POST(req){
  let id=null;
  try{
    const user=auth(req);
    const {videoKey,consent}=await req.json();
    if(consent!==true)throw Error('Permission from everyone depicted is required');
    const seconds=await verifiedVideoSeconds(videoKey,user.id); // server inspects actual MP4 metadata
    const videoUrl=await verifySource(videoKey,user.id,'video');
    await upsertUser(user);
    const sql=db();id=randomUUID();
    await sql`INSERT INTO swap_projects(id,user_id,video_key,seconds,status)
      VALUES(${id},${user.id},${videoKey},${seconds},'ANALYZING')`;
    const result=await analyzeVideo(videoUrl);
    if(!result?.id)throw Error('Video provider did not return an analysis ID');
    await sql`UPDATE swap_projects SET provider_id=${result.id} WHERE id=${id}`;
    return Response.json({id,status:'ANALYZING',rate:SWAP_RATE,seconds});
  }catch(e){
    if(id){try{const sql=db();await sql`UPDATE swap_projects SET status='FAILED',error_message=${String(e.message).slice(0,250)} WHERE id=${id}`;}catch{}}
    return jsonError(e);
  }
}
