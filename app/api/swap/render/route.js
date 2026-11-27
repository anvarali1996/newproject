import {auth,jsonError} from '../../../../lib/auth.js';
import {db} from '../../../../lib/db.js';
import {verifySource} from '../../../../lib/r2.js';
import {renderReplacement,costForSwap,isCastId} from '../../../../lib/lovely.js';
import {badRequest,conflict,paymentRequired,readJson} from '../../../../lib/errors.js';
import {debitForSwap,releaseSwapCharge} from '../../../../lib/billing.js';
export const runtime='nodejs';
export const maxDuration=45;
export async function POST(req){
  let id=null,user=null,cost=0,charged=false;
  try{
    user=auth(req);
    const body=await readJson(req);
    if(typeof body.id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.id))throw badRequest('Invalid analysis ID');
    id=body.id; // only a validated ID reaches the recovery SQL in catch
    const sql=db();
    // Claim this project once; concurrent clicks cannot charge twice.
    const claimed=await sql`UPDATE swap_projects SET status='SUBMITTING'
      WHERE id=${id} AND user_id=${user.id} AND status='READY' RETURNING *`;
    if(!claimed.length)throw conflict('Analysis not ready or render already started');
    const project=claimed[0];
    const cast=Array.isArray(project.detected_cast)?project.detected_cast:[];
    const keys=body.imageKeys;
    if(!keys||typeof keys!=='object'||Array.isArray(keys)||cast.length<1||cast.length>4 ||
      cast.some(c=>!isCastId(c.id)||typeof keys[c.id]!=='string') ||
      Object.keys(keys).some(k=>!cast.some(c=>c.id===k)))throw badRequest('Upload one reference portrait for each detected person');
    const urls={};
    for(const c of cast)urls[c.id]=await verifySource(keys[c.id],user.id,'image');
    cost=costForSwap(project.seconds);
    // Debit and record the charge on the project in one statement.
    const remaining=await debitForSwap(sql,{projectId:id,userId:user.id,cost});
    if(remaining===null)throw paymentRequired(`Not enough credits (need ${cost})`);
    charged=true;
    const result=await renderReplacement(project.provider_id,urls);
    if(!['rendering','stitching','succeeded'].includes(result?.status)&&!result?.id) throw Error('Unexpected response from video provider');
    await sql`UPDATE swap_projects SET status='RENDERING',image_keys=${JSON.stringify(keys)}::jsonb,progress=0
      WHERE id=${id} AND status='SUBMITTING'`;
    return Response.json({id,status:'RENDERING',cost,remaining});
  }catch(e){
    if(id&&user){
      try{
        const sql=db();
        // If provider did not launch, refund (atomically) and let the user retry with corrected files.
        if(charged)await releaseSwapCharge(sql,{projectId:id,userId:user.id,cost});
        else await sql`UPDATE swap_projects SET status='READY' WHERE id=${id} AND user_id=${user.id} AND status='SUBMITTING'`;
      }catch(x){console.error('Swap refund/recovery needs review:',x);}
    }
    return jsonError(e);
  }
}
