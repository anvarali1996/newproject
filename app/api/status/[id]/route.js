import { auth, jsonError } from '../../../../lib/auth.js';
import { db } from '../../../../lib/db.js';
import { runway } from '../../../../lib/runway.js';
import { getViggleVideo } from '../../../../lib/viggle.js';
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

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw badRequest('Invalid job ID');
    }

    const sql = db();

    // 2. Faqat shu foydalanuvchining videosini olish
    const rows = await sql`
      SELECT *
      FROM jobs
      WHERE id = ${id}
        AND user_id = ${user.id}
    `;

    if (!rows.length) {
      return Response.json(
        { error: 'Job not found' },
        { status: 404 }
      );
    }

    const job = rows[0];

    // 3. Video avval R2 ga saqlangan bo'lsa
    if (job.output_key) {
      const url = await signedDownload(
        job.output_key,
        3600
      );

      return Response.json({
        status: 'SUCCEEDED',
        url
      });
    }

    // 4. Generatsiya avval muvaffaqiyatsiz tugagan bo'lsa
    if (job.status === 'FAILED') {
      return Response.json({
        status: 'FAILED',
        message: job.error_message || 'Video generation failed'
      });
    }

    // 5. AI task ID hali olinmagan bo'lsa
    if (!job.runway_id) {
      // The start request died before saving the provider task: give credits back.
      if (await refundStuckJob(sql, id)) {
        return Response.json({
          status: 'FAILED',
          message: 'Generation could not start. Credits refunded.'
        });
      }
      return Response.json({
        status: 'STARTING',
        message: 'Starting video generation...'
      });
    }

    // 6. Qaysi AI ishlatilayotganini aniqlash
    const provider = job.provider || 'runway';

    let task;

    try {
      if (provider === 'viggle') {
        task = await getViggleVideo(job.runway_id);
      } else {
        task = await runway(
          `/tasks/${encodeURIComponent(job.runway_id)}`
        );
      }
    } catch (error) {
      // Provayder vaqtinchalik 429/5xx yoki timeout qaytarsa,
      // ish davom etadi — keyingi so'rovda yana tekshiramiz.
      if (isTransient(error)) {
        console.warn(`[${provider}] Temporary status error:`, error.cause ?? error.message);
        return Response.json({
          status: 'RUNNING',
          message: 'The AI service is busy. Checking your video again...'
        });
      }

      throw error;
    }

    // 7. AI statusini bir xil formatga o'tkazish
    const state = String(
      task?.status || 'PENDING'
    ).toUpperCase();

    // 8. AI haqiqatan FAILED/CANCELLED qaytarsa
    if (
      ['FAILED', 'CANCELED', 'CANCELLED'].includes(state)
    ) {
      // Bir ish uchun refund faqat bir marta (bitta atomik so'rov)
      await failAndRefundJob(sql, id, `${provider} generation failed`);

      return Response.json({
        status: 'FAILED',
        message: 'Generation failed. Credits refunded.'
      });
    }

    // 9. AI video tayyor bo'lganda
    if (state === 'READY' || state === 'SUCCEEDED') {

      // Viggle: video_url
      // Runway: output[0]
      const videoUrl = provider === 'viggle'
        ? task.video_url
        : task.output?.[0];

      // Link hali kelmagan bo'lsa,
      // keyingi tekshiruvni kutamiz.
      if (
        typeof videoUrl !== 'string' ||
        !videoUrl.startsWith('https://')
      ) {
        return Response.json({
          status: 'RUNNING',
          message: 'Video is ready. Waiting for download URL...'
        });
      }

      const resultKey = `results/${user.id}/${id}.mp4`;

      try {
        // 10. Tayyor videoni Cloudflare R2 ga saqlash
        await saveResult(videoUrl, resultKey);

        // 11. Neon bazasida SUCCEEDED qilish
        await sql`
          UPDATE jobs
          SET
            status = 'SUCCEEDED',
            output_key = ${resultKey}
          WHERE id = ${id}
            AND status <> 'FAILED'
        `;

        // 12. Mini App uchun tayyor video havolasi
        const downloadUrl = await signedDownload(
          resultKey,
          3600
        );

        return Response.json({
          status: 'SUCCEEDED',
          url: downloadUrl
        });

      } catch (error) {
        console.error(
          '[VisionAI] Result saving failed:',
          error
        );

        // Video qaytadan generatsiya qilinmaydi.
        // Keyingi status so'rovida saqlash qayta uriniladi.
        return Response.json({
          status: 'SAVING',
          message:
            'Video is ready. Saving to storage...'
        });
      }
    }

    // 13. Video hali generatsiya qilinmoqda
    return Response.json({
      status: state,
      message: 'AI is creating your video...'
    });

  } catch (error) {
    return jsonError(error);
  }
}
