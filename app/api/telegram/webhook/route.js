import { timingSafeEqual } from 'node:crypto';
import { db } from '../../../../lib/db.js';
export const runtime='nodejs';

function equalSecret(a,b){
  if(!a||!b)return false;
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length&&timingSafeEqual(x,y);
}
async function telegram(method,data){
  const r=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(8000)
  });
  const result=await r.json();
  if(!result.ok)throw Error(`Telegram ${method} failed`);
}
export async function POST(req){
  if(!equalSecret(req.headers.get('x-telegram-bot-api-secret-token'),process.env.TELEGRAM_WEBHOOK_SECRET))
    return new Response('Unauthorized',{status:401});
  try{
    const update=await req.json(),sql=db();
    if(update.pre_checkout_query){
      const q=update.pre_checkout_query;
      const found=await sql`SELECT id FROM topup_orders WHERE id::text=${q.invoice_payload}
        AND user_id=${String(q.from.id)} AND stars=${q.total_amount}
        AND status='pending' AND ${q.currency}='XTR'`;
      await telegram('answerPreCheckoutQuery',{
        pre_checkout_query_id:q.id,ok:found.length===1,
        ...(found.length?{}:{error_message:'Order not found or already paid. Please try a new purchase.'})
      });
      return Response.json({ok:true});
    }
    if(update.message?.successful_payment){
      const pay=update.message.successful_payment;
      const sender=String(update.message.from?.id||'');
      const charge=pay.telegram_payment_charge_id;
      if(pay.currency!=='XTR'||!sender||!charge||!pay.invoice_payload)return Response.json({ok:true});
      // Single atomic statement, safe against duplicated Telegram webhooks.
      // Invoice amount and sender must match the stored order exactly.
      await sql`
        WITH inserted AS (
          INSERT INTO star_payments(charge_id,order_id,user_id,stars)
          SELECT ${charge},o.id,o.user_id,o.stars FROM topup_orders o
          WHERE o.id::text=${pay.invoice_payload} AND o.user_id=${sender}
            AND o.stars=${pay.total_amount} AND o.status='pending'
          ON CONFLICT DO NOTHING
          RETURNING order_id
        ), paid AS (
          UPDATE topup_orders SET status='paid'
          WHERE id IN (SELECT order_id FROM inserted) AND status='pending'
          RETURNING user_id,credits
        )
        UPDATE users SET credits=users.credits+paid.credits
        FROM paid WHERE users.id=paid.user_id
      `;
      return Response.json({ok:true});
    }
    return Response.json({ok:true});
  }catch(e){
    console.error('[Telegram Stars webhook]',e);
    return new Response('Temporary error',{status:500});
  }
}
