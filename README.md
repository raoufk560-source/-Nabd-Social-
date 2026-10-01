# نبض المجالس | Nabd Social Lounge

منصة اجتماعية عربية: غرف دردشة صوتية وكتابية، بثوث مباشرة، ريلز، قصص، واقتصاد داخلي.

**التقنيات:** React + Vite + Tailwind (واجهة) · Express + Socket.IO (خادم) · PostgreSQL/Neon (قاعدة بيانات) · Firebase (تسجيل الدخول والتخزين).

## هيكل المشروع

```
server.ts                 نقطة تشغيل الخادم
src/                      الواجهة (components, contexts, hooks, services, types)
src/server/               الخادم (routes, realtime, auth, db, drizzle, storage, lib)
src/config/               إعدادات Firebase
public/images/            الصور الثابتة
firebase/                 قواعد Firestore ومخططاتها
render.yaml               إعداد النشر على Render
```

## النشر على Render

1. ارفع محتوى المجلد إلى GitHub.
2. في Render: New → Web Service → اختر المستودع (يقرأ `render.yaml` تلقائياً).
3. أضف متغير البيئة `DATABASE_URL` (رابط Neon).
4. Deploy. الفحص الصحي: `/healthz`.

> الموقع خادم Node دائم التشغيل مع WebSocket، لذلك لا يعمل على Vercel، ويُنشر على Render.

## التشغيل محلياً

```
npm install
cp .env.example .env   # ثم ضع DATABASE_URL
npm run dev
```
