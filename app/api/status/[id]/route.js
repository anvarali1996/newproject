import { auth, jsonError } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { runway } from '../../../../lib/runway.js';
import { saveResult, signedDownload } from '../../../../lib/r2.js';
export const runtime='nodejs';
export const maxDuration=120;

export async function GET(req,context){
  try{
    const user=auth(req);
    const {id}=await context.params;
    if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('Invalid job ID');
    const sql=db();
    const rows=await sql`SELECT * FROM jobs WHERE id=${id} AND user_id=${user.id}`;
    if(!rows.length)return Response.json({error:'Job not found'},{status:404});
    const job=rows[0];
    if(job.output_key) return Response.json({status:'SUCCEEDED',url:await signedDownload(job.output_key,3600)});
    if(job.status==='FAILED')return Response.json({status:'FAILED',message:job.error_message||'Video failed'});
    if(!job.runway_id)return Response.json({status:'STARTING'});
    const task=await runway(`/tasks/${encodeURIComponent(job.runway_id)}`);
    if(['FAILED','CANCELED'].includes(task.status)){
      const changed=await sql`UPDATE jobs SET status='FAILED',error_message='Runway generation failed'
        WHERE id=${id} AND status NOT IN ('FAILED','SUCCEEDED') RETURNING cost`;
      if(changed.length)await sql`UPDATE users SET credits=credits+${changed[0].cost} WHERE id=${user.id}`;
      return Response.json({status:'FAILED',message:'Generation failed; credit refunded'});
    }
    if(task.status==='SUCCEEDED'){
      const source=task.output?.[0];
      if(!source)return Response.json({status:'RUNNING',message:'Waiting for output'});
      const key=`results/${user.id}/${id}.mp4`;
      try{
        await saveResult(source,key);
        await sql`UPDATE jobs SET status='SUCCEEDED',output_key=${key} WHERE id=${id}`;
        return Response.json({status:'SUCCEEDED',url:await signedDownload(key,3600)});
      }catch(error){
        console.error('R2 result persistence failed, will retry:',error);
        return Response.json({status:'SAVING',message:'Video ready; saving result to storage'});
      }
    }
    return Response.json({status:task.status||'PENDING'});
  }catch(e){return jsonError(e);}
}
