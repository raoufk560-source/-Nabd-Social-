import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';

// Use ephemeral OS temp folder for transient multer staging only; durable storage is handled via Firebase Storage & PostgreSQL
const uploadsDir = process.env.UPLOADS_DIR
  ? path.resolve(process.cwd(), process.env.UPLOADS_DIR)
  : path.join(os.tmpdir(), 'nabd-uploads-staging');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    const uniqueName = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});

export const uploadMiddleware = multer({
  storage,
  limits: {
    fileSize: 40 * 1024 * 1024 // 40MB max for short videos / voice notes / images
  },
  fileFilter: (_req, file, cb) => {
    const allowed = /^(image|video|audio)\//i.test(file.mimetype);
    if (!allowed) {
      return cb(new Error('نوع الملف غير مدعوم. يُسمح فقط بالصور، الفيديو، والمقاطع الصوتية.'));
    }
    cb(null, true);
  }
});

export function getUploadsDirPath(): string {
  return uploadsDir;
}
