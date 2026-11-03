import {signedDownload} from './r2.js';

async function callBot(method,body){
  if(!process.env.TELEGRAM_BOT_TOKEN)throw Error('Missing Telegram bot token');
  const response=await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)
  });
  const data=await response.json();
  if(!data.ok)throw Error(`Telegram ${method}: ${data.description||response.status}`);
  return data;
}

export async function sendFinishedVideo(telegramId,resultKey){
  const url=await signedDownload(resultKey,86400);
  try{
    // Telegram downloading by URL can be limited to 20 MB. Fall back to a private download link.
    await callBot('sendVideo',{chat_id:telegramId,video:url,caption:'🎬 VisionAI: Your video is ready!',supports_streaming:true});
    return 'video';
  }catch(error){
    await callBot('sendMessage',{chat_id:telegramId,text:`🎬 Your VisionAI video is ready! Download it here (link valid for 24h):\n${url}`});
    return 'link';
  }
}
export async function notifySwapOnce(sql,project){
  const claimed=await sql`UPDATE swap_projects SET notification_state='sending'
    WHERE id=${project.id} AND notification_state='pending' AND status='SUCCEEDED' RETURNING id`;
  if(!claimed.length)return false;
  try{
    await sendFinishedVideo(project.user_id,project.output_key);
    await sql`UPDATE swap_projects SET notification_state='sent' WHERE id=${project.id}`;
    return true;
  }catch(error){
    // The user may not have started a private chat with the bot yet.
    console.error('Telegram delivery unavailable:',String(error.message).slice(0,180));
    await sql`UPDATE swap_projects SET notification_state='unavailable' WHERE id=${project.id}`;
    return false;
  }
}
