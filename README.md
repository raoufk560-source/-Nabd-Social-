# نبض v3 — Social Lounge

منصة دردشة صوتية اجتماعية مع بث مباشر، رسائل خاصة، ألعاب، ومتجر.

## الميزات

- مقاعد صوتية (Host + مقاعد) مع WebRTC
- إيموجي / ملصقات / GIF في الخاص والعام
- رد على الرسائل + منشن
- **قسم الألعاب**: ارسم وخمّن + بلياردو متعدد اللاعبين
- غرف ألعاب عامة/خاصة بكلمة مرور + إعلان في الدردشة العامة
- حذف غرف الألعاب من المضيف
- رنين مكالمات + رسالة مكالمة فائتة في الخاص
- تكبير الصور بالضغط (عام / خاص)
- لوحة إدارة: حظر، كتم، حذف حسابات، تنظيف بيانات
- تنظيف تلقائي للبيانات القديمة كل ساعة

## التشغيل المحلي

```bash
npm install
cp .env.example .env   # DATABASE_URL (Neon Postgres)
npm run dev
```

## النشر على Render / GitHub

1. ارفع الملفات إلى GitHub (الجذر مباشرة).
2. New Web Service — يقرأ `render.yaml`.
3. أضف `DATABASE_URL`.
4. Build: `npm install --include=dev && npm run build`
5. Start: `npm start`
6. Health: `/healthz`

> يحتاج خادم دائم مع WebSocket (لا يعمل على Vercel serverless).

## هيكل مختصر

```
src/components/   الواجهة (غرف، بث، ألعاب، إدارة...)
src/server/       Express + Socket.IO + Postgres
public/images/    صور ثابتة
firebase/         قواعد Firestore
```

تصميم Dark Premium (`#08080F` / `#7C3AED`).
