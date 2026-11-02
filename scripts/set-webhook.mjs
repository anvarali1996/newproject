// Run: node --env-file=.env.local scripts/set-webhook.mjs https://your-production-domain.vercel.app
const domain=process.argv[2];
if(!domain||!/^https:\/\/[^/]+$/.test(domain))throw Error('Pass HTTPS origin without trailing slash');
const token=process.env.TELEGRAM_BOT_TOKEN,secret=process.env.TELEGRAM_WEBHOOK_SECRET;
if(!token||!secret||!/^[A-Za-z0-9_-]{20,256}$/.test(secret))throw Error('Configure TELEGRAM_BOT_TOKEN and a 20+ char TELEGRAM_WEBHOOK_SECRET in .env.local');
const r=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({url:`${domain}/api/telegram/webhook`,secret_token:secret,allowed_updates:['pre_checkout_query','message']})
});
const result=await r.json();
if(!result.ok)throw Error(`Telegram webhook registration failed: ${result.description}`);
console.log('Webhook registered on',domain,'(secret withheld)');
