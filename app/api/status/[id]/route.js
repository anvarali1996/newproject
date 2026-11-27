import { auth, jsonError } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { DEFAULT_PROVIDER, cleanupTask, pollTask } from '../../../../lib/providers/index.js';
import { downloadResult, imageKind, saveResult, saveResultBytes, signedDownload } from '../../../../lib/r2.js';
import { badRequest, isTransient } from '../../../../lib/errors.js';
import { failAndRefundJob, refundStuckJob } from '../../../../lib/billing.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MAX_IMAGE_RESULT_BYTES = 20 * 1024 * 1024;

export async function GET(req, context) {
  try {
    // 1. Telegram foydalanuvchisini tekshirish
    const user = auth(req);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw badRequest('Invalid job ID');

    const sql = db();

    // 2. Faqat shu foydalanuvchining videosini olish
    const rows = await sql`SELECT * FROM jobs WHERE id = ${id} AND user_id = ${user.id}`;
    if (!rows.length) return Response.json({ error: 'Job not found' }, { status: 404 });
    const job = rows[0];
    // What the job makes; the page uses it to show an <img> or a <video>.
    const media = job.mode === 'text2img' ? 'image' : 'video';
    const reply = body => Response.json({ ...body, media });

    // 3. Natija avval R2 ga saqlangan bo'lsa
    if (job.output_key) {
      return reply({ status: 'SUCCEEDED', url: await signedDownload(job.output_key, 3600) });
    }

    // 4. Generatsiya avval muvaffaqiyatsiz tugagan bo'lsa
    if (job.status === 'FAILED') {
      return reply({ status: 'FAILED', message: job.error_message || `The ${media} could not be created` });
    }

    // 5. AI task ID hali olinmagan bo'lsa
    if (!job.runway_id) {
      // The start request died before saving the provider task: give credits back.
      if (await refundStuckJob(sql, id)) {
        return reply({ status: 'FAILED', message: 'Generation could not start. Credits refunded.' });
      }
      return reply({ status: 'STARTING', message: `Starting ${media} generation...` });
    }

    // 6. Ishni boshlagan provayderdan so'raymiz (runway_id = provayder task ID)
    const provider = job.provider || DEFAULT_PROVIDER;
    let task;
    try {
      task = await pollTask(provider, job.runway_id);
    } catch (error) {
      // Provayder vaqtinchalik 429/5xx yoki timeout qaytarsa,
      // ish davom etadi — keyingi so'rovda yana tekshiramiz.
      if (isTransient(error)) {
        console.warn(`[${provider}] Temporary status error:`, error.cause ?? error.message);
        return reply({ status: 'RUNNING', message: `The AI service is busy. Checking your ${media} again...` });
      }
      throw error;
    }

    // 7. AI haqiqatan FAILED/CANCELLED qaytarsa: refund faqat bir marta (atomik)
    if (task.state === 'FAILED') {
      await failAndRefundJob(sql, id, `${provider} generation failed`);
      await cleanupTask(provider, job.runway_id);
      return reply({ status: 'FAILED', message: 'Generation failed. Credits refunded.' });
    }

    // 8. Natija hali generatsiya qilinmoqda
    if (task.state !== 'SUCCEEDED') {
      return reply({ status: task.state, message: `AI is creating your ${media}...` });
    }

    // 9. Tayyor, lekin link hali kelmagan bo'lsa, keyingi tekshiruvni kutamiz
    if (!task.outputUrl && !task.outputBytes) {
      return reply({ status: 'RUNNING', message: `Your ${media} is ready. Waiting for download URL...` });
    }

    try {
      // 10. Tayyor natijani Cloudflare R2 ga saqlash va Neon'da SUCCEEDED qilish
      let resultKey;
      if (media === 'image') {
        const bytes = task.outputBytes || await downloadResult(task.outputUrl, MAX_IMAGE_RESULT_BYTES);
        // The file type comes from the bytes, so the stored name and type are always right.
        const kind = imageKind(bytes);
        if (!kind) {
          await failAndRefundJob(sql, id, `${provider} returned an unreadable image`);
          await cleanupTask(provider, job.runway_id);
          return reply({ status: 'FAILED', message: 'Generation failed. Credits refunded.' });
        }
        resultKey = `results/${user.id}/${id}.${kind.ext}`;
        await saveResultBytes(bytes, resultKey, kind.type);
      } else {
        resultKey = `results/${user.id}/${id}.mp4`;
        if (task.outputBytes) await saveResultBytes(task.outputBytes, resultKey);
        else await saveResult(task.outputUrl, resultKey);
      }
      await sql`UPDATE jobs SET status = 'SUCCEEDED', output_key = ${resultKey}
        WHERE id = ${id} AND status <> 'FAILED'`;
      // Saved on our side: the provider's copy (inputs + output) is no longer needed.
      await cleanupTask(provider, job.runway_id);
      return reply({ status: 'SUCCEEDED', url: await signedDownload(resultKey, 3600) });
    } catch (error) {
      // Natija qaytadan generatsiya qilinmaydi.
      // Keyingi status so'rovida saqlash qayta uriniladi.
      console.error('[VisionAI] Result saving failed:', error);
      return reply({ status: 'SAVING', message: `Your ${media} is ready. Saving to storage...` });
    }
  } catch (error) {
    return jsonError(error);
  }
}
