# VisionAI — Telegram Mini App (Next.js App Router)

Bu bitta loyiha: Next.js frontend + API, Neon PostgreSQL, Cloudflare R2, Runway AI.
**Image → Video** (`gen4_turbo`, 5 s) va **Video → Video** (`aleph2`) rejimlari mavjud.
**Hozircha referral va Telegram Stars yo'q.** Production billing/abuse controls ham hali qo'shilmagan.

## 1. Hisoblar
1. @BotFather bot yarating va tokenni oling, Telegram'da Mini App uchun /newapp.
2. Neon'da loyiha oching; SQL Editor'da `sql/schema.sql` ni **bir marta** ishga tushiring.
3. Cloudflare R2'da `visionai-media` bucket yarating. R2 API tokens orqali object read/write kalitlarini yarating.
4. Runway Dev dashboard'dan API key va test balans oling. Oddiy Runway veb obunasi har doim API balansi degani emas.
5. Vercel'da GitHub orqali loyihani deploy qiling.

## 2. Environment Variables
`.env.example` -> `.env.local` qiling va 7 ta maxfiy o'zgaruvchini to'ldiring.
Production Vercel → Project → Settings → Environment Variables'ga ham shu kalitlarni kiriting; `SIGNUP_CREDITS=0` qoldiring.
**Token, DB URL va R2 kalitlarini NEXT_PUBLIC_ bilan e'lon qilmang.**

## 3. R2 CORS
R2 → Bucket → Settings → CORS Policy:
```json
[
  {
    "AllowedOrigins": ["https://YOUR_PROJECT.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```
`YOUR_PROJECT` ni haqiqiy domeningizga almashtiring. HTTPS custom domen bo'lsa uni ham qo'shing.

## 4. Ishga tushirish
```bash
npm install
cp .env.example .env.local
# .env.local ni to'ldiring
npm test
npm run dev
```
localhost:3000 demo login ishlaydi (faqat development), lekin Runway haqiqiy pullik API so'rovi yuboradi.
Production'da demo login ishlamaydi. Telegram ichida `/newapp` da Vercel HTTPS URL'ingizni yozing.

## 5. Test uchun kredit
Neon SQL Editor'da Telegram orqali bir marta Mini App'ni ochgandan keyin:
```sql
SELECT id, first_name, credits FROM users;
UPDATE users SET credits=2 WHERE id='TELEGRAM_ID';
```
Faqat o'zingizning haqiqiy Telegram ID bilan o'zgartiring. 1 image generatsiya 1 kredit, 1 video-to-video 3 kredit deb MVP ichida belgilangan. Bu Runway'ning haqiqiy narx birligi EMAS; moliyaviy riskga qarab narxni moslang.

## 6. Vercel deployment
GitHub'ga yuboring (`.env.local` hech qachon commit qilinmasin) → Vercel Import Project → Framework Next.js → Variables → Deploy. `npm run build` bilan tekshiring.
BotFather `/newapp` uchun Web App URL: `https://YOUR_PROJECT.vercel.app`.
`https://t.me/BOT_USERNAME/APP_SHORT_NAME` faqat app yaratilgandan keyin ishlaydi.

## 7. API xulosa
- `GET /api/me`: Telegram `initData` ni tekshirib user ochadi / kreditni qaytaradi.
- `POST /api/upload`: user'ga tegishli fayl uchun R2 signed PUT URL.
- `POST /api/generate`: R2 HEAD va ownership tekshiruvi, Neon kredit debiti, Runway task start.
- `GET /api/status/:id`: task statusini Runway'dan so'raydi; tayyor video chiqsa R2'ga ko'chiradi va signed GET URL beradi.

Frontend `x-telegram-init-data` header'da `window.Telegram.WebApp.initData` yuboradi, server HMAC va `auth_date`ni tekshiradi.

## Muhim cheklovlar va production oldidan
- Bu MVP kod: tashqi xizmatlar uchun real API kalitlar bilan jonli end-to-end sinov bu muhitda qilinmagan.
- **Video-to-video** uchun real MP4 input 2-30 soniya; dastur davomiylikni o'lchamaydi, Runway rad qilishi mumkin.
- Bir vaqtda ikki `/api/generate` so'rovi kelishi, Runway ish boshlab DB yangilanishi uzilishi kabi holatlarda to'lov task reconciliation, idempotency va monitoringni production uchun qo'shing.
- R2 yuklangan media turi sarlavha orqali tekshiriladi; fayl mazmunini tekshirish, malware/moderatsiya, rate limits, GDPR retention/deletion, foydalanish huquqi, referral abuse himoyasi qo'shilishi kerak.
- Tayyor Runway output'ni R2'ga stream qilish `/api/status` ichida bajariladi; katta natijalarda Vercel vaqt limiti bo'lishi mumkin. Katta miqyos uchun queue/worker bilan ajrating.
- Runway AI API kreditlari pullik bo'lishi mumkin; bepul signup kreditini production'da ehtiyotkorlik bilan oching.
- Foydalanuvchi yuborgan media ustida ishlash huquqi mavjud bo'lishi shart.
- Video havolasi importi MVP'da yo'q; foydalanuvchi video faylini upload qiladi. Keyin ruxsatli HTTPS video URL va SSRF himoyasi qo'shilishi mumkin.
