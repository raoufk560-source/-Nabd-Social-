import {
  uploadFileToFirebaseStorage,
  uploadImageToFirebaseStorage,
  uploadReelToFirebaseStorage,
  StorageMediaCategory
} from '../firebase';

const TOKEN_KEY = 'nabd_auth_token';
const TAB_TOKEN_KEY = 'nabd_tab_auth_token';

let currentToken: string | null = null;

if (typeof window !== 'undefined') {
  try {
    const savedLocal = localStorage.getItem(TOKEN_KEY);
    const savedTab = sessionStorage.getItem(TAB_TOKEN_KEY);
    currentToken = savedLocal || savedTab || null;
    if (currentToken) {
      localStorage.setItem(TOKEN_KEY, currentToken);
      sessionStorage.setItem(TAB_TOKEN_KEY, currentToken);
    }
  } catch {
    // ignore storage access issues
  }
}

export function doesTabNeedSessionClone(): boolean {
  return false;
}

export function setTabOnlyToken(token: string) {
  setStoredToken(token);
}

export function getStoredToken(): string | null {
  if (currentToken) return currentToken;
  if (typeof window !== 'undefined') {
    try {
      const localTok = localStorage.getItem(TOKEN_KEY);
      if (localTok) {
        currentToken = localTok;
        sessionStorage.setItem(TAB_TOKEN_KEY, localTok);
        return localTok;
      }
      const tabTok = sessionStorage.getItem(TAB_TOKEN_KEY);
      if (tabTok) {
        currentToken = tabTok;
        localStorage.setItem(TOKEN_KEY, tabTok);
        return tabTok;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export function setStoredToken(token: string | null) {
  currentToken = token;
  if (typeof window !== 'undefined') {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(TAB_TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem(TAB_TOKEN_KEY);
      }
    } catch {
      // ignore
    }
  }
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    ...((options.headers as Record<string, string>) || {})
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: 'include'
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'حدث خطأ في الاتصال بالخادم');
  }
  return data as T;
}

/**
 * Fast client-side image compression for mobile camera photos so Stories, Wall posts, and Avatars
 * upload in a fraction of a second without blocking the UI.
 */
async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size <= 450 * 1024) {
    return file;
  }
  return new Promise<File>((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    const timeout = setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    }, 2500);

    img.onload = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      try {
        const MAX_DIM = 1280;
        let { width, height } = img;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            const cleanName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
            resolve(new File([blob], cleanName, { type: 'image/jpeg' }));
          },
          'image/jpeg',
          0.82
        );
      } catch {
        resolve(file);
      }
    };

    img.onerror = () => {
      clearTimeout(timeout);
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };

    img.src = objectUrl;
  });
}

function uploadViaBackendWithProgress(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload', true);
    xhr.withCredentials = true;

    const token = getStoredToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    if (onProgress) {
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable && ev.total > 0) {
          const pct = Math.min(99, Math.round((ev.loaded / ev.total) * 100));
          onProgress(pct);
        }
      };
    }

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && data.url) {
          onProgress?.(100);
          resolve({ url: data.url, mimeType: data.mimeType || file.type || 'application/octet-stream' });
        } else {
          reject(new Error(data.error || 'فشل رفع الملف'));
        }
      } catch {
        reject(new Error('حدث خطأ أثناء معالجة استجابة الرفع'));
      }
    };

    xhr.onerror = () => {
      reject(new Error('تعذر الاتصال بالخادم لرفع الملف'));
    };

    const formData = new FormData();
    formData.append('file', file);
    xhr.send(formData);
  });
}

export async function uploadMediaFile(
  file: File,
  options?: { category?: StorageMediaCategory; onProgress?: (percent: number) => void }
): Promise<{ url: string; mimeType: string }> {
  const preparedFile = file.type.startsWith('image/') ? await compressImageIfNeeded(file) : file;
  // Upload immediately via fast backend stream (which also syncs to Firebase Storage & Cloud SQL in background)
  const result = await uploadViaBackendWithProgress(preparedFile, options?.onProgress);
  // Mirror to client Firebase Storage in background without blocking user
  uploadFileToFirebaseStorage(preparedFile, options?.category).catch(() => {});
  return result;
}

export async function uploadImageFile(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; mimeType: string }> {
  const preparedFile = await compressImageIfNeeded(file);
  const result = await uploadViaBackendWithProgress(preparedFile, onProgress);
  uploadImageToFirebaseStorage(preparedFile).catch(() => {});
  return result;
}

export async function uploadReelVideo(
  file: File,
  onProgress?: (percent: number) => void
): Promise<{ url: string; mimeType: string }> {
  const result = await uploadViaBackendWithProgress(file, onProgress);
  uploadReelToFirebaseStorage(file).catch(() => {});
  return result;
}
