# نبض المجالس | Nabd Social Lounge

منصة اجتماعية عربية: غرف دردشة صوتية وكتابية، بثوث مباشرة، ريلز، قصص، ألعاب، واقتصاد داخلي.

**التقنيات:** React + Vite + Tailwind · Express + Socket.IO · PostgreSQL/Neon · Firebase

## هيكل المشروع

```
server.ts                 نقطة تشغيل الخادم
src/                      الواجهة
src/server/               الخادم (routes, realtime, auth, db, drizzle, storage)
src/components/           المكونات (غرف، بث، رسائل، ألعاب، إيموجي...)
public/images/            الصور الثابتة
firebase/                 قواعد Firestore
render.yaml               إعداد النشر على Render
```

## الميزات المحدّثة

- مقاعد صوتية (Host + مقاعد متعددة) محفوظة ومُحسَّنة
- إيموجي Picker في الغرف والرسائل الخاصة
- ملصقات + GIF في الرسائل الخاصة
- رد على الرسائل + تمييز المنشن للمستخدم المذكور
- حظر ثنائي الاتجاه (Backend)
- كتم موحّد (شخصي / غرفة / إدارة)
- لعبة ارسم وخمّن (شبيهة Gartic) — إنشاء غرف، جولات، تخمين، مشاهدين
- تصميم Dark Premium (#08080F / #12121D / #7C3AED)

## النشر على Render

1. ارفع محتوى المجلد إلى GitHub (الملفات في الجذر مباشرة).
2. New → Web Service أو Blueprint (يقرأ `render.yaml`).
3. أضف `DATABASE_URL` (Neon — منطقة Frankfurt مفضّلة).
4. Build: `npm install --include=dev && npm run build`
5. Start: `npm start`
6. Health: `/healthz`

> لا يعمل على Vercel — يحتاج خادم دائم مع WebSocket.

## تشغيل محلي

```
npm install
cp .env.example .env   # ضع DATABASE_URL
npm run dev
```
