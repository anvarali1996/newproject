import { randomUUID } from 'node:crypto';
import { auth, jsonError } from '../../../lib/auth.js';
import { db, upsertUser } from '../../../lib/db.js';
import { verifySource } from '../../../lib/r2.js';
import { createVideo } from '../../../lib/runway.js';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req) {
  let jobId=null, charged=false, user=null, cost=0;
  try {
    user=auth(req);
    const {mode,key,prompt}=await req.json();
    if(!['image','video'].includes(mode))throw new Error('Unsupported mode');
    if(typeof prompt!=='string'||prompt.trim().length<4||prompt.length>1000)throw new Error('Invalid prompt (4-1000 chars)');
    // Verify that this EXACT authenticated user owns the R2 object.
    const sourceUrl=await verifySource(key,user.id,mode);
    const sql=db();
    await upsertUser(user);
    cost=mode==='image'?1:3;
    const debit=await sql`UPDATE users SET credits=credits-${cost}
      WHERE id=${user.id} AND credits>=${cost} RETURNING credits`;
    if(!debit.length)throw new Error(`Not enough credits (need ${cost})`);
    charged=true;
    jobId=randomUUID();
    await sql`INSERT INTO jobs(id,user_id,source_key,mode,prompt,cost,status)
      VALUES(${jobId},${user.id},${key},${mode},${prompt.trim()},${cost},'STARTING')`;
    const task=await createVideo(mode,sourceUrl,prompt.trim());
    if(!task?.id)throw new Error('Runway did not return a task ID');
    await sql`UPDATE jobs SET runway_id=${task.id},status='PENDING' WHERE id=${jobId}`;
    return Response.json({id:jobId,status:'PENDING',remaining:debit[0].credits});
  }catch(e){
    if(charged && user){
      try{
        const sql=db();
        if(jobId){
          const rows=await sql`UPDATE jobs SET status='FAILED',error_message='Task could not start'
            WHERE id=${jobId} AND status='STARTING' RETURNING id`;
          if(rows.length) await sql`UPDATE users SET credits=credits+${cost} WHERE id=${user.id}`;
        } else await sql`UPDATE users SET credits=credits+${cost} WHERE id=${user.id}`;
      }catch(refundError){console.error('Refund requires investigation:',refundError);}
    }
    return jsonError(e);
  }
}
