import { initializeApp } from 'firebase/app';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  setDoc
} from 'firebase/firestore';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL
} from 'firebase/storage';
import firebaseConfig from './config/firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(
  app,
  firebaseConfig.storageBucket ? `gs://${firebaseConfig.storageBucket}` : undefined
);
export const googleProvider = new GoogleAuthProvider();

// Enforce browserLocalPersistence so user stays logged in across sessions and browser restarts
if (typeof window !== 'undefined') {
  setPersistence(auth, browserLocalPersistence).catch((err) => {
    console.warn('Firebase Auth persistence warning:', err);
  });
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write'
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email
        })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validate connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

if (typeof window !== 'undefined') {
  testConnection();
}

export async function signInWithFirebaseGoogle() {
  await setPersistence(auth, browserLocalPersistence);
  const result = await signInWithPopup(auth, googleProvider);
  return result.user;
}

export type StorageMediaCategory = 'images' | 'reels' | 'avatars' | 'stories' | 'audio' | 'uploads';

function inferStorageCategory(file: File, customCategory?: StorageMediaCategory): StorageMediaCategory {
  if (customCategory) return customCategory;
  const mime = (file.type || '').toLowerCase();
  if (mime.startsWith('video/')) return 'reels';
  if (mime.startsWith('image/')) return 'images';
  if (mime.startsWith('audio/')) return 'audio';
  return 'uploads';
}

/**
 * Uploads any media file (Image, Reel Video, Avatar, Story, Audio) directly to Firebase Storage
 * and returns its permanent static Download URL.
 */
export async function uploadFileToFirebaseStorage(
  file: File,
  category?: StorageMediaCategory,
  onProgress?: (percent: number) => void
): Promise<string | null> {
  try {
    const folder = inferStorageCategory(file, category);
    const rawExt = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const ext = rawExt || (file.type.startsWith('video/') ? 'mp4' : file.type.startsWith('image/') ? 'jpg' : 'bin');
    const safePath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const fileRef = storageRef(storage, safePath);
    const metadata = {
      contentType: file.type || 'application/octet-stream',
      cacheControl: 'public,max-age=31536000,immutable'
    };

    if (onProgress) {
      return await new Promise<string | null>((resolve) => {
        const task = uploadBytesResumable(fileRef, file, metadata);
        task.on(
          'state_changed',
          (snapshot) => {
            if (snapshot.totalBytes > 0) {
              const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              onProgress(pct);
            }
          },
          () => resolve(null),
          async () => {
            try {
              const url = await getDownloadURL(task.snapshot.ref);
              resolve(url);
            } catch {
              resolve(null);
            }
          }
        );
      });
    }

    const snapshot = await uploadBytes(fileRef, file, metadata);
    const downloadUrl = await getDownloadURL(snapshot.ref);
    return downloadUrl;
  } catch {
    return null;
  }
}

/**
 * Dedicated helper for uploading images (avatars, banners, wall images, stories) to Firebase Storage.
 */
export async function uploadImageToFirebaseStorage(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string | null> {
  return uploadFileToFirebaseStorage(file, 'images', onProgress);
}

/**
 * Dedicated helper for uploading short vertical videos (Reels) to Firebase Storage.
 */
export async function uploadReelToFirebaseStorage(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string | null> {
  return uploadFileToFirebaseStorage(file, 'reels', onProgress);
}

export async function mirrorEntityToFirestore(
  collectionName: 'users' | 'reels' | 'follows' | 'private_messages' | 'wall_posts',
  docId: string,
  payload: Record<string, any>
) {
  const path = `${collectionName}/${docId}`;
  try {
    await setDoc(doc(db, collectionName, docId), payload, { merge: true });
  } catch (error) {
    try {
      handleFirestoreError(error, OperationType.WRITE, path);
    } catch {
      // Logged structured FirestoreErrorInfo
    }
  }
}
