import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import { initDatabase } from './src/server/db/index.js';
import { getPool } from './src/server/drizzle/index.js';
import { apiRouter } from './src/server/routes/api.js';
import { setupSocketServer } from './src/server/realtime/socket.js';
import { getUploadsDirPath } from './src/server/storage/upload.js';
import { getCloudMediaFromPostgres } from './src/server/drizzle/repository.js';

// على Render يتم ضبط RENDER=true تلقائياً، فنعتبره وضع إنتاج حتى لو لم يُضبط NODE_ENV
const isProd = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
if (isProd) process.env.NODE_ENV = 'production';

async function startServer() {
  if (!process.env.DATABASE_URL?.trim() && !process.env.SQL_HOST) {
    console.error('[Fatal] المتغير DATABASE_URL غير مضبوط. أضفه في Environment على Render (رابط Neon PostgreSQL).');
    process.exit(1);
  }

  try {
    await initDatabase();
  } catch (err: any) {
    console.error('[Fatal] تعذر الاتصال بقاعدة البيانات PostgreSQL:', err?.message || err);
    process.exit(1);
  }

  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT) || 3000;

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));
  app.use(cookieParser());

  // فحص صحة الخادم (يستخدمه Render)
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // الملفات المرفوعة: من القرص المؤقت أولاً، ثم من Firebase / PostgreSQL
  app.use('/uploads', express.static(getUploadsDirPath()));
  app.get('/uploads/:filename', async (req, res) => {
    try {
      const filename = path.basename(req.params.filename);

      const pgFile = await getCloudMediaFromPostgres(filename);
      if (pgFile) {
        if (pgFile.firebaseUrl && pgFile.firebaseUrl.startsWith('http')) {
          return res.redirect(302, pgFile.firebaseUrl);
        }
        if (pgFile.dataBase64) {
          const buf = Buffer.from(pgFile.dataBase64, 'base64');
          res.setHeader('Content-Type', pgFile.mimeType || 'application/octet-stream');
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(buf);
        }
      }

      const fallbackRow = await getPool().query(
        'SELECT mime_type, data_base64 FROM uploaded_files WHERE filename = $1 LIMIT 1',
        [filename]
      );
      if (fallbackRow.rows[0]?.data_base64) {
        const buf = Buffer.from(fallbackRow.rows[0].data_base64, 'base64');
        res.setHeader('Content-Type', fallbackRow.rows[0].mime_type || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return res.send(buf);
      }
    } catch (err) {
      console.error('[Media Serve] Error serving media file:', err);
    }
    res.status(404).end();
  });

  // REST API
  app.use('/api', apiRouter);
  app.use('/api', (req, res) => {
    console.warn(`[API 404] ${req.method} ${req.originalUrl}`);
    res.status(404).json({
      error: `المسار غير موجود: ${req.method} ${req.originalUrl}`,
      method: req.method,
      path: req.originalUrl
    });
  });

  // Socket.IO
  setupSocketServer(httpServer);

  // الواجهة: Vite أثناء التطوير، وملفات dist الجاهزة في الإنتاج
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    const indexFile = path.join(distPath, 'index.html');
    if (!fs.existsSync(indexFile)) {
      console.error('[Fatal] مجلد dist غير موجود. شغّل "npm run build" قبل التشغيل (Build Command على Render).');
      process.exit(1);
    }
    app.use(
      express.static(distPath, {
        index: false,
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        }
      })
    );
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  // معالج أخطاء عام (مثل أخطاء رفع الملفات)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]', err?.message || err);
    if (res.headersSent) return;
    const status = err?.code === 'LIMIT_FILE_SIZE' ? 413 : err?.status || 500;
    res.status(status).json({ error: err?.message || 'حدث خطأ في الخادم' });
  });

  // Graceful shutdown
  const handleShutdown = async (signal: string) => {
    console.log(`[Server] Received ${signal}. Closing PostgreSQL pool...`);
    try {
      await getPool().end();
    } catch {
      // ignore
    }
    process.exit(0);
  };
  process.on('SIGINT', () => void handleShutdown('SIGINT'));
  process.on('SIGTERM', () => void handleShutdown('SIGTERM'));

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[Nabd Al-Majalis] Server listening on port ${PORT} (${isProd ? 'production' : 'development'})`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
