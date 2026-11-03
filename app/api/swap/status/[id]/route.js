import {auth,jsonError} from '../../../../../lib/auth.js';
import {db} from '../../../../../lib/db.js';
import {getReplacement,cleanCast,SWAP_RATE} from '../../../../../lib/lovely.js';
import {signedDownload,saveResult} from '../../../../../lib/r2.js';
import {notifySwapOnce} from '../../../../../lib/telegram-delivery.js';
export const runtime='nodejs';
export const maxDuration=120;

async function publicStatus(sql,project){
  if(project.status==='SUCCEEDED'&&project.output_key){
    const sent=project.notification_state==='sent'||await notifySwapOnce(sql,project);
    return Response.json({status:'SUCCEEDED',id:project.id,url:await signedDownload(project.output_key,3600),
      telegram:sent?'sent':'unavailable',progress:100});
  }
  if(project.status==='FAILED')return Response.json({status:'FAILED',message:project.error_message||'Video processing failed'});
  if(project.status==='READY')return Response.json({status:'READY',id:project.id,seconds:project.seconds,
    rate:SWAP_RATE,cost:project.seconds*SWAP_RATE,
    people:(project.detected_cast||[]).map(x=>({id:x.id,preview:`/api/swap/preview/${project.id}/${x.id}`}))});
  return null;
}
export async function GET(req,{params}){
  try{
    const user=auth(req);const {id}=await params;
    if(!/^[0-9a-f-]{36}$/i.test(id))throw Error('Invalid analysis ID');
    const sql=db();
    const rows=await sql`SELECT * FROM swap_projects WHERE id=${id} AND user_id=${user.id}`;
    if(!rows.length)return Response.json({error:'Not found'},{status:404});
    let project=rows[0];
    const cached=await publicStatus(sql,project);if(cached)return cached;
    if(!project.provider_id)return Response.json({status:'ANALYZING',progress:0});
    const result=await getReplacement(project.provider_id);
    const status=String(result.status||'').toLowerCase();
    if(status==='ready'&&project.status==='ANALYZING'){
      const cast=cleanCast(result.cast);
      if(!cast.length){
        await sql`UPDATE swap_projects SET status='FAILED',error_message='No recognizable people detected' WHERE id=${id}`;
        return Response.json({status:'FAILED',message:'No recognizable people found. Try a better-lit video.'});
      }
      await sql`UPDATE swap_projects SET status='READY',detected_cast=${JSON.stringify(cast)}::jsonb WHERE id=${id}`;
      return Response.json({status:'READY',id,seconds:project.seconds,rate:SWAP_RATE,cost:project.seconds*SWAP_RATE,
        people:cast.map(x=>({id:x.id,preview:`/api/swap/preview/${id}/${x.id}`}))});
    }
    if(status==='ready'&&project.status!=='ANALYZING')return Response.json({status:'RENDERING',progress:null,message:'Preparing your render…'});
    if(['failed','cancelled'].includes(status)){
      const changed=await sql`UPDATE swap_projects SET status='FAILED',error_message='Video replacement failed'
        WHERE id=${id} AND status NOT IN ('FAILED','SUCCEEDED') RETURNING credits_charged`;
      if(changed.length && changed[0].credits_charged>0)await sql`UPDATE users SET credits=credits+${changed[0].credits_charged} WHERE id=${user.id}`;
      return Response.json({status:'FAILED',message:'Video replacement failed; charged credits were refunded'});
    }
    if(status==='succeeded'&&result.url){
      const key=`results/${user.id}/swap-${id}.mp4`;
      try{
        await saveResult(result.url,key);
        const changed=await sql`UPDATE swap_projects SET status='SUCCEEDED',output_key=${key},progress=100 WHERE id=${id} AND status NOT IN ('SUCCEEDED','FAILED') RETURNING *`;
        const finished=changed[0]||{...project,output_key:key,status:'SUCCEEDED'};
        const sent=await notifySwapOnce(sql,finished);
        return Response.json({status:'SUCCEEDED',url:await signedDownload(key,3600),telegram:sent?'sent':'unavailable',progress:100});
      }catch(error){
        console.error('Swap result storage:',error);
        await sql`UPDATE swap_projects SET status='SAVING' WHERE id=${id} AND status<>'SUCCEEDED'`;
        return Response.json({status:'SAVING',message:'Video ready — saving to secure storage'});
      }
    }
    const progress=Number.isFinite(result.progress)?Math.max(0,Math.min(99,Math.round(result.progress))):null;
    if(['rendering','stitching'].includes(status)){
      await sql`UPDATE swap_projects SET status=${status.toUpperCase()},progress=${progress||0} WHERE id=${id} AND status<>'SUCCEEDED'`;
    }
    return Response.json({status:status.toUpperCase()||'ANALYZING',progress,
      message:status==='analyzing'?'Finding people in your video…':status==='stitching'?'Combining scenes…':'AI is preparing your video…'});
  }catch(e){return jsonError(e);}
}
