import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { client, signedDownload } from './r2.js';

async function callBot(method, body) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw Error('Missing Telegram bot token');
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!data.ok) throw Error(`Telegram ${method}: ${data.description || response.status}`);
  return data;
}


export async function sendFinishedVideo(telegramId, resultKey) {
  const url = await signedDownload(resultKey, 86400);

  const head = await client().send(
    new HeadObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: resultKey
    })
  );

  // Telegram Bot API: bevosita video yuborish limiti 50 MB.
  if (Number(head.ContentLength) > 49 * 1024 * 1024) {
    await callBot('sendMessage', {
      chat_id: telegramId,
      text:
        `🎬 VisionAI video tayyor!\n` +
        `Fayl 50 MB dan katta. Yuklab olish havolasi ` +
        `(24 soat):\n${url}`
    });

    return 'link';
  }

  try {
    const media = await fetch(url, {
      signal: AbortSignal.timeout(60000)
    });

    if (!media.ok) {
      throw Error(`Video download failed: ${media.status}`);
    }

    const form = new FormData();

    form.append('chat_id', String(telegramId));
    form.append(
      'video',
      new Blob(
        [await media.arrayBuffer()],
        { type: 'video/mp4' }
      ),
      'visionai.mp4'
    );

    form.append(
      'caption',
      '🎬 VisionAI — AI-generated video'
    );

    form.append('supports_streaming', 'true');

    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendVideo`,
      {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(90000)
      }
    );

    const data = await response.json();

    if (!data.ok) {
      throw Error(
        `Telegram sendVideo: ${data.description || response.status}`
      );
    }

    return 'video';

  } catch (error) {
    console.error(
      'Telegram video upload failed:',
      error.message
    );

    await callBot('sendMessage', {
      chat_id: telegramId,
      text:
        `🎬 VisionAI video tayyor!\n` +
        `Video yuborilmadi. Yuklab olish havolasi ` +
        `(24 soat):\n${url}`
    });

    return 'link';
  }
}

export async function notifySwapOnce(sql, project) {
  const claimed = await sql`UPDATE swap_projects SET notification_state='sending'
    WHERE id=${project.id} AND notification_state='pending' AND status='SUCCEEDED' RETURNING id`;
  if (!claimed.length) return false;
  try {
    await sendFinishedVideo(project.user_id, project.output_key);
    await sql`UPDATE swap_projects SET notification_state='sent' WHERE id=${project.id}`;
    return true;
  } catch (error) {
    // The user may not have started a private chat with the bot yet.
    console.error('Telegram delivery unavailable:', String(error.message).slice(0, 180));
    await sql`UPDATE swap_projects SET notification_state='unavailable' WHERE id=${project.id}`;
    return false;
  }
}
