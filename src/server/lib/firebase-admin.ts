import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const firebaseConfig = require('../../config/firebase-applet-config.json') as {
  projectId: string;
  storageBucket?: string;
};

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
    storageBucket: firebaseConfig.storageBucket
  });
}

export const adminAuth = getAuth();
export const adminStorage = getStorage();

/**
 * Uploads a file buffer from the backend directly to Firebase Cloud Storage
 * and returns a permanent public download URL.
 */
export async function uploadBufferToFirebaseAdminStorage(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string | null> {
  try {
    if (!firebaseConfig.storageBucket) return null;
    const bucket = adminStorage.bucket(firebaseConfig.storageBucket);
    const folder = mimeType.startsWith('video/')
      ? 'reels'
      : mimeType.startsWith('image/')
      ? 'images'
      : mimeType.startsWith('audio/')
      ? 'audio'
      : 'uploads';
    const objectPath = `${folder}/${filename}`;
    const downloadToken = crypto.randomUUID();
    const fileObj = bucket.file(objectPath);

    await fileObj.save(buffer, {
      resumable: false,
      contentType: mimeType,
      metadata: {
        cacheControl: 'public,max-age=31536000,immutable',
        metadata: {
          firebaseStorageDownloadTokens: downloadToken
        }
      }
    });

    const encodedPath = encodeURIComponent(objectPath);
    return `https://firebasestorage.googleapis.com/v0/b/${firebaseConfig.storageBucket}/o/${encodedPath}?alt=media&token=${downloadToken}`;
  } catch {
    return null;
  }
}
