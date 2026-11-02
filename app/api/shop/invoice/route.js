import { randomUUID } from 'node:crypto';
import { auth,jsonError } from '../../../../lib/auth.js';
import { db,upsertUser } from '../../../../lib/db.js';
import { PACKS } from '../../../../lib/pricing.js';
export const runtime='nodejs';
export async function POST(req){
  try {
    const user=auth(req);
    const {packId}=await req.json();
    if(typeof packId!=='string'||!Object.hasOwn(PACKS,packId))throw Error('Unknown credit pack');
    const pack=PACKS[packId];
    await upsertUser(user);
    const sql=db(),id=randomUUID();
    await sql`INSERT INTO topup_orders(id,user_id,pack_id,stars,credits)
      VALUES (${id},${user.id},${packId},${pack.stars},${pack.credits})`;
    const token=process.env.TELEGRAM_BOT_TOKEN;
    if(!token)throw Error('Missing TELEGRAM_BOT_TOKEN');
    const reply=await fetch(`https://api.telegram.org/bot${token}/createInvoiceLink`,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({title:`VisionAI ${pack.label}`,description:`${pack.credits} video credits`,payload:id,
        currency:'XTR',prices:[{label:`${pack.credits} VisionAI credits`,amount:pack.stars}]}),
      signal:AbortSignal.timeout(15000)
    });
    const answer=await reply.json();
    if(!answer.ok||typeof answer.result!=='string')throw Error('Telegram invoice link could not be created');
    return Response.json({invoiceUrl:answer.result});
  }catch(e){return jsonError(e);}
}
