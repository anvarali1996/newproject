import { randomUUID } from 'node:crypto';
import { auth, jsonError } from '../../../lib/auth.js';
import { db, upsertUser } from '../../../lib/db.js';
import { verifySource, verifiedVideoSeconds } from '../../../lib/r2.js';
import { createVideo } from '../../../lib/runway.js';
import { billedPrice } from '../../../lib/pricing-db.js';
import { buildPrompt } from '../../../lib/prompt-presets.js';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let jobId=null, charged=false, user=null, cost=0;
  try {
    user=auth(req);
    const {mode,key,videoKey,presetId,extraPrompt,seconds:requestedSeconds}=await req.json();
    const prompt=mode==='act'?'':buildPrompt(mode,presetId,extraPrompt||'');
    if(!['image','video','act'].includes(mode))throw Error('Unsupported mode');
    if(mode!=='act' && (typeof prompt!=='string'||prompt.trim().length<4||prompt.length>1000))throw Error('Invalid prompt');
    if(mode==='act' && !videoKey)throw Error('Portrait and motion video are required');
    let sourceUrl, performanceUri=null,seconds;
    if(mode==='image') {
      seconds=Number(requestedSeconds);
      sourceUrl=await verifySource(key,user.id,'image');
    } else if (mode==='video') {
      seconds=await verifiedVideoSeconds(key,user.id);
      sourceUrl=await verifySource(key,user.id,'video');
    } else {
      sourceUrl=await verifySource(key,user.id,'image');
      seconds=await verifiedVideoSeconds(videoKey,user.id);
      performanceUri=await verifySource(videoKey,user.id,'video');
    }
    cost=await billedPrice(mode,seconds);
    const sql=db();
    await upsertUser(user);
    const debit=await sql`UPDATE users SET credits=credits-${cost}
      WHERE id=${user.id} AND credits>=${cost} RETURNING credits`;
    if(!debit.length)throw Error(`Not enough credits (need ${cost})`);
    charged=true;
    jobId=randomUUID();
    await sql`INSERT INTO jobs(id,user_id,source_key,secondary_source_key,mode,prompt,duration_seconds,cost,status)
      VALUES(${jobId},${user.id},${key},${videoKey||null},${mode},${mode==='act'?'Performance transfer':prompt.trim()},${seconds},${cost},'STARTING')`;
    const task=await createVideo(mode,sourceUrl,mode==='act'?'':prompt.trim(),{seconds,performanceUri});
    if(!task?.id)throw Error('Runway did not return a task ID');
    await sql`UPDATE jobs SET runway_id=${task.id},status='PENDING' WHERE id=${jobId}`;
    return Response.json({id:jobId,status:'PENDING',remaining:debit[0].credits,cost,seconds});
  }catch(e){
    if(charged&&user){
      try{
        const sql=db();
        if(jobId){
          const rows=await sql`UPDATE jobs SET status='FAILED',error_message='Task could not start'
            WHERE id=${jobId} AND status='STARTING' RETURNING id`;
          if(rows.length)await sql`UPDATE users SET credits=credits+${cost} WHERE id=${user.id}`;
        }else await sql`UPDATE users SET credits=credits+${cost} WHERE id=${user.id}`;
      }catch(x){console.error('Refund needs investigation:',x);}
    }
    return jsonError(e);
  }
}
