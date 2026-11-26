import { auth, jsonError } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { DEFAULT_PROVIDER, pollTask } from '../../../../lib/providers/index.js';
import { saveResult, signedDownload } from '../../../../lib/r2.js';
import { badRequest, isTransient } from '../../../../lib/errors.js';
import { failAndRefundJob, refundStuckJob } from '../../../../lib/billing.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

    // 3. Video avval R2 ga saqlangan bo'lsa
    if (job.output_key) {
      return Response.json({ status: 'SUCCEEDED', url: await signedDownload(job.output_key, 3600) });
    }

    // 4. Generatsiya avval muvaffaqiyatsiz tugagan bo'lsa
    if (job.status === 'FAILED') {
      return Response.json({ status: 'FAILED', message: job.error_message || 'Video generation failed' });
    }

    // 5. AI task ID hali olinmagan bo'lsa
    if (!job.runway_id) {
      // The start request died before saving the provider task: give credits back.
      if (await refundStuckJob(sql, id)) {
        return Response.json({ status: 'FAILED', message: 'Generation could not start. Credits refunded.' });
      }
      return Response.json({ status: 'STARTING', message: 'Starting video generation...' });
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
        return Response.json({ status: 'RUNNING', message: 'The AI service is busy. Checking your video again...' });
      }
      throw error;
    }

    // 7. AI haqiqatan FAILED/CANCELLED qaytarsa: refund faqat bir marta (atomik)
    if (task.state === 'FAILED') {
      await failAndRefundJob(sql, id, `${provider} generation failed`);
      return Response.json({ status: 'FAILED', message: 'Generation failed. Credits refunded.' });
    }

    // 8. Video hali generatsiya qilinmoqda
    if (task.state !== 'SUCCEEDED') {
      return Response.json({ status: task.state, message: 'AI is creating your video...' });
    }

    // 9. Tayyor, lekin link hali kelmagan bo'lsa, keyingi tekshiruvni kutamiz
    if (!task.videoUrl) {
      return Response.json({ status: 'RUNNING', message: 'Video is ready. Waiting for download URL...' });
    }

    const resultKey = `results/${user.id}/${id}.mp4`;
    try {
      // 10. Tayyor videoni Cloudflare R2 ga saqlash va Neon'da SUCCEEDED qilish
      await saveResult(task.videoUrl, resultKey);
      await sql`UPDATE jobs SET status = 'SUCCEEDED', output_key = ${resultKey}
        WHERE id = ${id} AND status <> 'FAILED'`;
      return Response.json({ status: 'SUCCEEDED', url: await signedDownload(resultKey, 3600) });
    } catch (error) {
      // Video qaytadan generatsiya qilinmaydi.
      // Keyingi status so'rovida saqlash qayta uriniladi.
      console.error('[VisionAI] Result saving failed:', error);
      return Response.json({ status: 'SAVING', message: 'Video is ready. Saving to storage...' });
    }
  } catch (error) {
    return jsonError(error);
  }
}
