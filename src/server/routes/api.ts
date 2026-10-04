import { Router, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { dbAll, dbGet, dbRun } from "../db/index.js";
import { adminAuth, uploadBufferToFirebaseAdminStorage } from '../lib/firebase-admin.ts';
import { saveCloudMediaToPostgres } from '../drizzle/repository.ts';
import {
  AuthenticatedRequest,
  AuthUser,
  createSession,
  extractTokenFromReq,
  getRolePermission,
  getUserBySessionToken,
  hashPassword,
  requireAuth,
  requirePermission,
  verifyPassword
} from '../auth/security.js';
import {
  awardUserXp,
  calculateLevelFromXp,
  convertXpToGold,
  processMinuteHeartbeat,
  rewardCreatorEngagementGem
} from '../services/economy.js';
import { uploadMiddleware } from '../storage/upload.js';
import { canAccessRoom, grantRoomAccess } from '../services/roomAccess.js';
import {
  bridgePkWebRTCSessions,
  broadcastLiveState,
  broadcastRoomState,
  cleanupLiveSession,
  emitToUser,
  getActiveLiveStreamForHost,
  getEligibleBattleOpponents,
  getGlobalOnlineCount,
  getIo,
  getLiveViewerCount,
  getOrInitLiveSeats,
  getRoomOnlineCount,
  isUserOnline,
  LiveChatItem
} from '../realtime/socket.js';

export const apiRouter = Router();

async function formatUserResponse(user: AuthUser) {
  const perms = await getRolePermission(user.role);
  const levelProgress = calculateLevelFromXp(user.xp);
  const unreadPm = (await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM private_messages WHERE receiver_id = ? AND is_read = 0',
    [user.id]
  ))?.c || 0;
  const unreadNotifs = (await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND is_read = 0',
    [user.id]
  ))?.c || 0;
  const pendingFriendReqs = (await dbGet<{ c: number }>(
    `SELECT COUNT(*) as c FROM friends WHERE addressee_id = ? AND status = 'pending'`,
    [user.id]
  ))?.c || 0;
  const followersCount = (await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM follows WHERE following_id = ?',
    [user.id]
  ))?.c || 0;
  const followingCount = (await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM follows WHERE follower_id = ?',
    [user.id]
  ))?.c || 0;

  return {
    ...user,
    allow_follow_requests: user.allow_follow_requests ?? 1,
    pm_privacy: user.pm_privacy || 'everyone',
    call_privacy: user.call_privacy || 'everyone',
    hide_online_status: user.hide_online_status ?? 0,
    levelProgress,
    permissions: perms,
    unreadPm,
    unreadNotifs,
    pendingFriendReqs,
    followersCount,
    followingCount
  };
}

// ==================================================
// 1. AUTHENTICATION & ACCOUNT CREATION
// ==================================================

apiRouter.post('/auth/register', async (req, res) => {
  try {
    const { displayName, username, password } = req.body;
    const cleanName = (displayName || '').trim();
    const cleanUsername = (username || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    if (!cleanName || cleanName.length < 2 || cleanName.length > 40) {
      return res.status(400).json({ error: 'يرجى إدخال اسم عرض صحيح (من حرفين إلى 40 حرفاً).' });
    }
    if (!/^[a-z0-9_.\u0600-\u06FF]{3,24}$/i.test(cleanUsername)) {
      return res.status(400).json({ error: 'اسم المستخدم يجب أن يتكون من 3 إلى 24 حرفاً أو رقماً بدون مسافات.' });
    }
    if (rawPassword.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب ألا تقل عن 6 أحرف.' });
    }

    const existing = await dbGet('SELECT id FROM users WHERE LOWER(username) = ?', [cleanUsername]);
    if (existing) {
      return res.status(409).json({ error: 'اسم المستخدم هذا مسجل مسبقاً، اختر اسماً آخر.' });
    }

    // First registered non-guest user automatically becomes Platform Owner!
    const nonGuestCount = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_guest = 0'))?.c || 0;
    const assignedRole = nonGuestCount === 0 ? 'Owner' : 'Member';
    const initialGold = nonGuestCount === 0 ? 5000 : 100;
    const initialGems = nonGuestCount === 0 ? 500 : 10;

    const userId = crypto.randomUUID();
    const now = Date.now();
    const pwdHash = hashPassword(rawPassword);

    await dbRun(
      `INSERT INTO users (
        id, username, display_name, password_hash, is_guest, profile_completed,
        role, xp, level, gold, gems, last_xp_tick, created_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, 0, 1, ?, ?, ?, ?)`,
      [userId, cleanUsername, cleanName, pwdHash, assignedRole, initialGold, initialGems, now, now]
    );

    const token = await createSession(userId);
    res.cookie('nabd_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    const user = (await getUserBySessionToken(token))!;
    return res.json({ token, user: await formatUserResponse(user) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'حدث خطأ أثناء إنشاء الحساب' });
  }
});

apiRouter.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const cleanUsername = (username || '').trim().toLowerCase();
    const rawPassword = String(password || '');

    const row = await dbGet<AuthUser & { password_hash: string }>(
      'SELECT * FROM users WHERE LOWER(username) = ?',
      [cleanUsername]
    );
    if (!row || !verifyPassword(rawPassword, row.password_hash)) {
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة.' });
    }

    if (row.is_banned && (row.banned_until === 0 || row.banned_until > Date.now())) {
      return res.status(403).json({
        error: `هذا الحساب محظور. السبب: ${row.ban_reason || 'مخالفة شروط الاستخدام'}`
      });
    }

    const token = await createSession(row.id);
    res.cookie('nabd_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    const user = (await getUserBySessionToken(token))!;
    return res.json({ token, user: await formatUserResponse(user) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'خطأ في تسجيل الدخول' });
  }
});

apiRouter.post('/auth/guest', async (req, res) => {
  try {
    const allowGuest = await dbGet<{ value: string }>(`SELECT value FROM platform_settings WHERE key = 'allow_guest_login'`);
    if (allowGuest && allowGuest.value === 'false') {
      return res.status(403).json({ error: 'الدخول كضيف متوقف حالياً من إدارة المنصة.' });
    }

    const { nickname, gender = 'male' } = req.body || {};
    const randSuffix = Math.floor(1000 + Math.random() * 9000);
    const guestUsername = `guest_${randSuffix}_${Date.now().toString().slice(-3)}`;
    const displayName = (nickname || '').trim() || `زائر_${randSuffix}`;
    const userId = crypto.randomUUID();
    const now = Date.now();
    const pwdHash = hashPassword(crypto.randomBytes(16).toString('hex'));

    await dbRun(
      `INSERT INTO users (
        id, username, display_name, password_hash, is_guest, profile_completed,
        gender, role, xp, level, gold, gems, last_xp_tick, created_at
      ) VALUES (?, ?, ?, ?, 1, 1, ?, 'Guest', 0, 1, 25, 0, ?, ?)`,
      [userId, guestUsername, displayName, pwdHash, gender === 'female' ? 'female' : 'male', now, now]
    );

    const token = await createSession(userId);
    res.cookie('nabd_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    const user = (await getUserBySessionToken(token))!;
    return res.json({ token, user: await formatUserResponse(user) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'تعذر الدخول كضيف' });
  }
});

apiRouter.post('/auth/firebase', async (req, res) => {
  try {
    const { idToken, displayName: clientDisplayName, photoURL: clientPhotoURL } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return res.status(400).json({ error: 'رمز تسجيل الدخول (idToken) مفقود.' });
    }

    // التحقق من الهوية فعلياً عبر Firebase بدل الوثوق ببيانات المتصفح
    let decoded: Awaited<ReturnType<typeof adminAuth.verifyIdToken>>;
    try {
      decoded = await adminAuth.verifyIdToken(idToken);
    } catch {
      return res.status(401).json({ error: 'رمز تسجيل الدخول غير صالح أو منتهي. أعد المحاولة.' });
    }

    const uid = decoded.uid;
    const email = decoded.email_verified ? decoded.email : undefined;
    const displayName = decoded.name || clientDisplayName;
    const photoURL = decoded.picture || clientPhotoURL;

    const emailPrefix = email ? String(email).split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() : '';
    const baseUsername = (emailPrefix || `user_${String(uid).slice(0, 8)}`).slice(0, 20);
    let userRow = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [uid]);

    const now = Date.now();
    if (!userRow) {
      const nonGuestCount = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM users WHERE is_guest = 0'))?.c || 0;
      const isOwnerEmail = String(email || '').toLowerCase() === 'kg9547547@gmail.com';
      const assignedRole = nonGuestCount === 0 || isOwnerEmail ? 'Owner' : 'Member';
      const initialGold = assignedRole === 'Owner' ? 5000 : 150;
      const initialGems = assignedRole === 'Owner' ? 500 : 15;
      const finalUsername = await dbGet('SELECT id FROM users WHERE LOWER(username) = ?', [baseUsername])
        ? `${baseUsername}_${Math.floor(100 + Math.random() * 899)}`
        : baseUsername;
      const cleanDisplay = (displayName || emailPrefix || 'مستخدم نبض').trim().slice(0, 40);
      const pwdHash = hashPassword(crypto.randomBytes(16).toString('hex'));

      await dbRun(
        `INSERT INTO users (
          id, username, display_name, password_hash, is_guest, profile_completed,
          avatar_url, role, xp, level, gold, gems, last_xp_tick, created_at
        ) VALUES (?, ?, ?, ?, 0, 1, ?, ?, 0, 1, ?, ?, ?, ?)`,
        [uid, finalUsername, cleanDisplay, pwdHash, photoURL || '', assignedRole, initialGold, initialGems, now, now]
      );
      userRow = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [uid]);
    } else if (photoURL && !userRow.avatar_url) {
      await dbRun('UPDATE users SET avatar_url = ? WHERE id = ?', [photoURL, userRow.id]);
    }

    if (!userRow) {
      return res.status(500).json({ error: 'تعذر مزامنة حساب Firebase.' });
    }

    const token = await createSession(userRow.id);
    res.cookie('nabd_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
    const freshUser = (await getUserBySessionToken(token))!;

    return res.json({ token, user: await formatUserResponse(freshUser) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'خطأ في المصادقة السحابية' });
  }
});

apiRouter.get('/auth/google/status', async (_req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  return res.json({
    configured: Boolean(clientId),
    clientId
  });
});

apiRouter.get('/auth/me', async (req: AuthenticatedRequest, res: Response) => {
  const token = extractTokenFromReq(req);
  const user = await getUserBySessionToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }
  if (token) {
    res.cookie('nabd_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000
    });
  }
  let clonedToken: string | undefined;
  if (req.headers['x-clone-session'] === '1') {
    clonedToken = await createSession(user.id);
  }
  return res.json({ user: await formatUserResponse(user), clonedToken });
});

apiRouter.post('/auth/logout', async (req: AuthenticatedRequest, res: Response) => {
  const token = extractTokenFromReq(req);
  if (token) {
    const u = await getUserBySessionToken(token);
    if (u) {
      await dbRun('DELETE FROM room_messages WHERE user_id = ?', [u.id]);
      getIo()?.emit('room:user_messages_cleared', { userId: u.id });
    }
    await dbRun('DELETE FROM sessions WHERE token = ?', [token]);
  }
  res.clearCookie('nabd_session');
  return res.json({ success: true });
});

// ==================================================
// 2. FILE UPLOAD (FIREBASE STORAGE + CLOUD SQL MEDIA PERSISTENCE)
// ==================================================

apiRouter.post('/upload', requireAuth, uploadMiddleware.single('file'), async (req: AuthenticatedRequest, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم إرفاق أي ملف صالح.' });
  }

  const uploadedFile = req.file;
  const localUrl = `/uploads/${uploadedFile.filename}`;

  try {
    const fileBuffer = await fs.promises.readFile(uploadedFile.path);
    // Persist immediately in PostgreSQL so /uploads/:filename is durably backed by Neon/PostgreSQL even on ephemeral disk (Render)
    await saveCloudMediaToPostgres({
      filename: uploadedFile.filename,
      mimeType: uploadedFile.mimetype,
      size: uploadedFile.size,
      firebaseUrl: '',
      dataBase64: uploadedFile.size <= 15 * 1024 * 1024 ? fileBuffer.toString('base64') : '',
      createdAt: Date.now()
    });

    // Also attempt Firebase Storage upload in background and update PostgreSQL record + media references when available
    setImmediate(async () => {
      try {
        const firebaseUrl = await uploadBufferToFirebaseAdminStorage(
          fileBuffer,
          uploadedFile.filename,
          uploadedFile.mimetype
        );

        if (firebaseUrl) {
          await saveCloudMediaToPostgres({
            filename: uploadedFile.filename,
            mimeType: uploadedFile.mimetype,
            size: uploadedFile.size,
            firebaseUrl,
            dataBase64: uploadedFile.size <= 15 * 1024 * 1024 ? fileBuffer.toString('base64') : '',
            createdAt: Date.now()
          }).catch(() => {});

          await dbRun('UPDATE reels SET video_url = ? WHERE video_url = ?', [firebaseUrl, localUrl]).catch(() => {});
          await dbRun('UPDATE stories SET media_url = ? WHERE media_url = ?', [firebaseUrl, localUrl]).catch(() => {});
          await dbRun('UPDATE wall_posts SET media_url = ? WHERE media_url = ?', [firebaseUrl, localUrl]).catch(() => {});
        }
      } catch {
        // PostgreSQL media record remains available via /uploads/:filename
      } finally {
        fs.promises.unlink(uploadedFile.path).catch(() => {});
      }
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'تعذر حفظ الملف المرفوع في قاعدة البيانات.' });
  }

  return res.json({
    url: localUrl,
    filename: uploadedFile.filename,
    mimeType: uploadedFile.mimetype,
    size: uploadedFile.size
  });
});

// ==================================================
// 3. PROFILE SETUP & CUSTOMIZATION
// ==================================================

apiRouter.post('/profile/setup', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const {
    displayName,
    username,
    bio = '',
    country = 'السعودية',
    age = 22,
    gender = 'male',
    avatarUrl = '',
    bannerUrl = ''
  } = req.body;

  const cleanName = (displayName || user.display_name).trim().slice(0, 40);
  const cleanUser = (username || user.username).trim().toLowerCase();

  if (cleanUser !== user.username) {
    const exists = await dbGet('SELECT id FROM users WHERE LOWER(username) = ? AND id != ?', [cleanUser, user.id]);
    if (exists) {
      return res.status(409).json({ error: 'اسم المستخدم هذا مستخدم بالفعل.' });
    }
  }

  const safeAge = Math.max(13, Math.min(99, parseInt(String(age), 10) || 22));
  const safeGender = gender === 'female' ? 'female' : 'male';

  await dbRun(
    `UPDATE users
     SET display_name = ?, username = ?, bio = ?, country = ?, age = ?, gender = ?,
         avatar_url = ?, banner_url = ?, profile_completed = 1
     WHERE id = ?`,
    [cleanName, cleanUser, String(bio).slice(0, 300), String(country).slice(0, 40), safeAge, safeGender, avatarUrl, bannerUrl, user.id]
  );

  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({ user: await formatUserResponse(updated) });
});

const handleProfileCustomize = async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const {
    displayName,
    username,
    bio,
    country,
    age,
    gender,
    avatarUrl,
    bannerUrl,
    statusText,
    nameColor,
    fontColor,
    newPassword,
    password: bodyPassword,
    allowFollowRequests,
    pmPrivacy,
    callPrivacy,
    hideOnlineStatus,
    profileSongUrl
  } = req.body;

  if (displayName !== undefined && String(displayName).trim().length >= 2) {
    await dbRun('UPDATE users SET display_name = ? WHERE id = ?', [String(displayName).trim().slice(0, 40), user.id]);
  }
  if (username !== undefined) {
    const cleanUser = String(username).trim().toLowerCase();
    if (cleanUser.length >= 3 && cleanUser !== user.username) {
      const exists = await dbGet('SELECT id FROM users WHERE LOWER(username) = ? AND id != ?', [cleanUser, user.id]);
      if (exists) {
        return res.status(409).json({ error: 'اسم المستخدم هذا مستخدم بالفعل.' });
      }
      await dbRun('UPDATE users SET username = ? WHERE id = ?', [cleanUser, user.id]);
    }
  }
  if (bio !== undefined) {
    await dbRun('UPDATE users SET bio = ? WHERE id = ?', [String(bio).slice(0, 300), user.id]);
  }
  if (country !== undefined) {
    await dbRun('UPDATE users SET country = ? WHERE id = ?', [String(country).slice(0, 40), user.id]);
  }
  if (age !== undefined) {
    const safeAge = Math.max(13, Math.min(99, parseInt(String(age), 10) || user.age));
    await dbRun('UPDATE users SET age = ? WHERE id = ?', [safeAge, user.id]);
  }
  if (gender === 'male' || gender === 'female') {
    await dbRun('UPDATE users SET gender = ? WHERE id = ?', [gender, user.id]);
  }
  if (avatarUrl !== undefined) {
    await dbRun('UPDATE users SET avatar_url = ? WHERE id = ?', [String(avatarUrl), user.id]);
  }
  if (bannerUrl !== undefined) {
    await dbRun('UPDATE users SET banner_url = ? WHERE id = ?', [String(bannerUrl), user.id]);
  }
  if (statusText !== undefined) {
    await dbRun('UPDATE users SET status_text = ? WHERE id = ?', [String(statusText).slice(0, 60), user.id]);
  }
  if (nameColor !== undefined) {
    await dbRun('UPDATE users SET name_color = ? WHERE id = ?', [String(nameColor).slice(0, 30), user.id]);
  }
  if (fontColor !== undefined) {
    await dbRun('UPDATE users SET font_color = ? WHERE id = ?', [String(fontColor).slice(0, 30), user.id]);
  }
  if (allowFollowRequests !== undefined) {
    await dbRun('UPDATE users SET allow_follow_requests = ? WHERE id = ?', [allowFollowRequests ? 1 : 0, user.id]);
  }
  if (pmPrivacy !== undefined && ['everyone', 'followers', 'friends', 'none'].includes(pmPrivacy)) {
    await dbRun('UPDATE users SET pm_privacy = ? WHERE id = ?', [pmPrivacy, user.id]);
  }
  if (callPrivacy !== undefined && ['everyone', 'followers', 'friends', 'none'].includes(callPrivacy)) {
    await dbRun('UPDATE users SET call_privacy = ? WHERE id = ?', [callPrivacy, user.id]);
  }
  if (hideOnlineStatus !== undefined) {
    await dbRun('UPDATE users SET hide_online_status = ? WHERE id = ?', [hideOnlineStatus ? 1 : 0, user.id]);
  }
  if (profileSongUrl !== undefined) {
    await dbRun('UPDATE users SET profile_song_url = ? WHERE id = ?', [String(profileSongUrl).slice(0, 500), user.id]);
  }
  const pwd = newPassword || bodyPassword;
  if (pwd && String(pwd).length >= 6) {
    const newHash = hashPassword(String(pwd));
    await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
  }
  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({ user: await formatUserResponse(updated) });
};

// POST و PUT معًا — الواجهة كانت تستخدم الاثنين
apiRouter.put('/profile/customize', requireAuth, handleProfileCustomize);
apiRouter.post('/profile/customize', requireAuth, handleProfileCustomize);

apiRouter.get('/users/:id/profile', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const targetId = req.params.id;
  const target = await dbGet<AuthUser>(
    `SELECT id, username, display_name, is_guest, avatar_url, banner_url, bio, country,
            age, gender, role, xp, level, gold, gems, total_support_power, name_color,
            font_color, active_frame, active_badge, active_effect, status_text, created_at,
            COALESCE(last_seen_at, 0) as last_seen_at, COALESCE(profile_song_url, '') as profile_song_url,
            COALESCE(hide_online_status, 0) as hide_online_status
     FROM users WHERE id = ?`,
    [targetId]
  );
  if (!target) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }

  const perms = await getRolePermission(target.role);
  const levelProgress = calculateLevelFromXp(target.xp);

  const receivedGifts = await dbAll<any>(
    `SELECT gt.id, gt.created_at, gc.name_ar, gc.icon_emoji, gc.cost, gc.currency, gc.bar_power,
            u.display_name as sender_name, u.avatar_url as sender_avatar
     FROM gift_transactions gt
     JOIN gifts_catalog gc ON gc.id = gt.gift_id
     JOIN users u ON u.id = gt.sender_id
     WHERE gt.receiver_id = ?
     ORDER BY gt.created_at DESC
     LIMIT 24`,
    [targetId]
  );

  const userReels = await dbAll<any>(
    'SELECT * FROM reels WHERE user_id = ? ORDER BY created_at DESC LIMIT 12',
    [targetId]
  );

  const userStories = await dbAll<any>(
    'SELECT * FROM stories WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC',
    [targetId, Date.now()]
  );

  const friendsCount = (await dbGet<{ c: number }>(
    `SELECT COUNT(*) as c FROM friends WHERE (requester_id = ? OR addressee_id = ?) AND status = 'accepted'`,
    [targetId, targetId]
  ))?.c || 0;

  const followersCount = (await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM follows WHERE following_id = ?',
    [targetId]
  ))?.c || 0;

  const followingCount = (await dbGet<{ c: number }>(
    'SELECT COUNT(*) as c FROM follows WHERE follower_id = ?',
    [targetId]
  ))?.c || 0;

  const isFollowing = Boolean(
    await dbGet('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [req.user!.id, targetId])
  );
  const followsMe = Boolean(
    await dbGet('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [targetId, req.user!.id])
  );

  const friendship = await dbGet<any>(
    `SELECT * FROM friends
     WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [req.user!.id, targetId, targetId, req.user!.id]
  );

  return res.json({
    profile: {
      ...target,
      roleLabel: perms?.badge_label || 'عضو',
      roleColor: perms?.badge_color || '',
      levelProgress,
      friendsCount: Math.max(friendsCount, followersCount),
      followersCount,
      followingCount,
      isFollowing,
      followsMe,
      isMutual: isFollowing && followsMe,
      isOnline: Number((target as any).hide_online_status) ? false : isUserOnline(targetId),
      lastSeenAt: Number((target as any).last_seen_at) || 0,
      profile_song_url: (target as any).profile_song_url || '',
      friendshipStatus: isFollowing && followsMe ? 'accepted' : isFollowing ? 'following' : followsMe ? 'follows_me' : (friendship ? friendship.status : 'none'),
      receivedGifts,
      reels: userReels,
      stories: userStories
    }
  });
});

// ==================================================
// 4. CHAT ROOMS & PRIVATE ROOMS
// ==================================================

apiRouter.get('/rooms', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const viewer = req.user!;
  const rooms = await dbAll<any>(
    `SELECT id, name, description, category, is_private, room_code, banner_url, avatar_url,
            owner_id, is_locked, slow_mode_seconds, max_seats, welcome_message, created_at
     FROM rooms ORDER BY is_private ASC, created_at ASC`
  );

  const grants = await dbAll<{ room_id: string }>('SELECT room_id FROM room_access WHERE user_id = ?', [viewer.id]);
  const grantedIds = new Set(grants.map((g) => g.room_id));

  const enriched = rooms.map((r) => {
    const hasAccess =
      !r.is_private || r.owner_id === viewer.id || viewer.role === 'Owner' || grantedIds.has(r.id);
    return {
      ...r,
      // لا نكشف رمز الغرفة الخاصة لمن لا يملك صلاحية الدخول
      room_code: hasAccess ? r.room_code : '',
      onlineCount: getRoomOnlineCount(r.id)
    };
  });

  return res.json({
    rooms: enriched,
    globalOnlineCount: getGlobalOnlineCount()
  });
});

apiRouter.post('/rooms', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const perms = await getRolePermission(user.role);
  const {
    name,
    description = '',
    category = 'public',
    isPrivate = false,
    roomCode = '',
    password = '',
    bannerUrl = '',
    welcomeMessage = 'أهلاً بكم في الغرفة!'
  } = req.body;

  // Anyone above Guest can create a private room; public rooms require room management permission
  if (!isPrivate && !perms?.can_manage_rooms && user.role !== 'Owner') {
    return res.status(403).json({ error: 'إنشاء الغرف العامة متاح للإدارة فقط، ولكن يمكنك إنشاء غرفة خاصة.' });
  }
  if (user.is_guest) {
    return res.status(403).json({ error: 'يرجى تسجيل حساب دائم لإنشاء غرفة خاصة بك.' });
  }

  const cleanName = (name || '').trim();
  if (cleanName.length < 3) {
    return res.status(400).json({ error: 'اسم الغرفة يجب ألا يقل عن 3 أحرف.' });
  }

  const generatedCode = (roomCode || `RM-${Math.floor(1000 + Math.random() * 9000)}`).trim().toUpperCase();
  if (isPrivate && (!password || String(password).length < 3)) {
    return res.status(400).json({ error: 'الغرفة الخاصة تتطلب كلمة مرور لا تقل عن 3 أحرف.' });
  }

  const roomId = `room-${crypto.randomUUID().slice(0, 8)}`;
  const pwdHash = isPrivate ? hashPassword(String(password)) : '';

  await dbRun(
    `INSERT INTO rooms (
      id, name, description, category, is_private, room_code, password_hash,
      banner_url, owner_id, welcome_message, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      roomId,
      cleanName,
      String(description).slice(0, 250),
      category,
      isPrivate ? 1 : 0,
      generatedCode,
      pwdHash,
      bannerUrl || '/images/room_banner_general_1790452755617.jpg',
      user.id,
      String(welcomeMessage).slice(0, 200),
      Date.now()
    ]
  );

  const created = await dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (created) delete created.password_hash;
  return res.json({ room: { ...created, onlineCount: 0 } });
});

apiRouter.post('/rooms/verify-private', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { roomCode, password } = req.body;
  const cleanCode = (roomCode || '').trim().toUpperCase();
  const room = await dbGet<any>('SELECT * FROM rooms WHERE UPPER(room_code) = ? OR id = ?', [cleanCode, roomCode]);

  if (!room) {
    return res.status(404).json({ error: 'لم يتم العثور على غرفة بهذا المعرّف (Room ID).' });
  }

  if (room.is_private && room.owner_id !== req.user!.id && req.user!.role !== 'Owner') {
    if (!password || !verifyPassword(String(password), room.password_hash)) {
      return res.status(403).json({ error: 'كلمة مرور الغرفة الخاصة غير صحيحة.' });
    }
  }

  if (room.is_private) {
    await grantRoomAccess(room.id, req.user!.id);
  }

  return res.json({ roomId: room.id, name: room.name });
});

apiRouter.put('/rooms/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const roomId = req.params.id;
  const room = await dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });

  const perms = await getRolePermission(req.user!.role);
  if (!perms?.can_manage_rooms && room.owner_id !== req.user!.id) {
    return res.status(403).json({ error: 'لا تملك صلاحية تعديل هذه الغرفة.' });
  }

  const { name, description, welcomeMessage, bannerUrl, isLocked } = req.body;
  if (name) await dbRun('UPDATE rooms SET name = ? WHERE id = ?', [String(name).slice(0, 50), roomId]);
  if (description !== undefined) await dbRun('UPDATE rooms SET description = ? WHERE id = ?', [String(description).slice(0, 250), roomId]);
  if (welcomeMessage !== undefined) await dbRun('UPDATE rooms SET welcome_message = ? WHERE id = ?', [String(welcomeMessage).slice(0, 200), roomId]);
  if (bannerUrl !== undefined) await dbRun('UPDATE rooms SET banner_url = ? WHERE id = ?', [String(bannerUrl), roomId]);
  if (isLocked !== undefined) await dbRun('UPDATE rooms SET is_locked = ? WHERE id = ?', [isLocked ? 1 : 0, roomId]);

  await broadcastRoomState(roomId);
  const updated = await dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (updated) delete updated.password_hash;
  return res.json({ room: updated });
});

apiRouter.get('/rooms/:id/messages', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const roomId = req.params.id;
  const since = Number(req.query.since) || 0;
  const clearMine = req.query.fresh === '1';

  if (!(await canAccessRoom(roomId, req.user!))) {
    return res.status(403).json({ error: 'هذه غرفة خاصة. أدخل رمز الغرفة وكلمة المرور أولاً.' });
  }

  if (clearMine && req.user) {
    // Ephemeral public room messages: clear user's old public messages on fresh site entry
    await dbRun('DELETE FROM room_messages WHERE user_id = ? AND created_at < ?', [req.user.id, since || Date.now()]);
  }

  const rows = await dbAll<any>(
    `SELECT rm.*, u.username, u.display_name, u.avatar_url, u.gender, u.role, u.level,
            u.name_color, u.font_color, u.active_frame, u.active_badge,
            rp.badge_label as role_label, rp.badge_color as role_color
     FROM room_messages rm
     JOIN users u ON u.id = rm.user_id
     LEFT JOIN role_permissions rp ON rp.role_name = u.role
     WHERE rm.room_id = ? AND rm.created_at >= ?
     ORDER BY rm.created_at DESC
     LIMIT 80`,
    [roomId, since]
  );
  return res.json({ messages: rows.reverse() });
});

apiRouter.delete('/rooms/:roomId/messages/:msgId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { roomId, msgId } = req.params;
  const perms = await getRolePermission(req.user!.role);
  const room = await dbGet<any>('SELECT owner_id FROM rooms WHERE id = ?', [roomId]);
  if (!perms?.can_moderate_chat && room?.owner_id !== req.user!.id) {
    return res.status(403).json({ error: 'لا تملك صلاحية حذف الرسائل.' });
  }
  await dbRun('DELETE FROM room_messages WHERE id = ? AND room_id = ?', [msgId, roomId]);
  getIo()?.to(`room:${roomId}`).emit('room:message_deleted', { msgId });
  return res.json({ success: true });
});

apiRouter.post('/rooms/:id/moderate', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const roomId = req.params.id;
  const { targetUserId, actionType, durationMinutes = 60, reason = '' } = req.body;
  const perms = await getRolePermission(req.user!.role);
  const room = await dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);

  if (!perms?.can_moderate_chat && room?.owner_id !== req.user!.id) {
    return res.status(403).json({ error: 'ليس لديك صلاحيات الإشراف في هذه الغرفة.' });
  }

  const targetUser = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [targetUserId]);
  if (!targetUser) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const targetPerms = await getRolePermission(targetUser.role);
  if (
    (targetPerms?.rank_order || 0) >= (perms?.rank_order || 0) &&
    req.user!.role !== 'Owner' &&
    room?.owner_id !== req.user!.id
  ) {
    return res.status(403).json({ error: 'لا يمكنك تطبيق إجراء إداري على رتبة مساوية أو أعلى منك.' });
  }

  const now = Date.now();
  const mins = Math.max(0, Number(durationMinutes) || 0);
  // expires_at = 0 يعني دائم؛ أي قيمة > 0 تعني انتهاء تلقائي بعد المدة
  const expiresAt = mins > 0 ? now + mins * 60 * 1000 : 0;

  if (actionType === 'unmute' || actionType === 'unban') {
    const cleanType = actionType === 'unmute' ? 'mute' : 'ban';
    await dbRun('DELETE FROM room_moderation WHERE room_id = ? AND user_id = ? AND action_type = ?', [roomId, targetUserId, cleanType]);
    try {
      if (actionType === 'unmute') {
        emitToUser(targetUserId, 'room:unmuted', { roomId });
        getIo()?.to(`room:${roomId}`).emit('room:system_event', {
          id: crypto.randomUUID(),
          roomId,
          userId: targetUser.id,
          displayName: targetUser.display_name,
          avatarUrl: targetUser.avatar_url,
          badgeText: 'إدارة الغرفة',
          hasRoyalEntry: false,
          text: `تم فك كتم ${targetUser.display_name} داخل الغرفة`,
          createdAt: now
        });
      }
    } catch {}
    return res.json({ success: true, message: 'تم رفع العقوبة عن المستخدم داخل الغرفة.' });
  }

  // احذف أي عقوبة سابقة من نفس النوع حتى يمكن إعادة الحظر/الكتم بعد الرفع
  await dbRun(
    'DELETE FROM room_moderation WHERE room_id = ? AND user_id = ? AND action_type = ?',
    [roomId, targetUserId, actionType]
  );

  await dbRun(
    `INSERT INTO room_moderation (id, room_id, user_id, action_type, expires_at, reason, moderator_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), roomId, targetUserId, actionType, expiresAt, reason, req.user!.id, now]
  );

  if (actionType === 'kick' || actionType === 'ban') {
    emitToUser(targetUserId, 'room:kicked', {
      roomId,
      actionType,
      reason: reason || 'قرار إداري من مشرف الغرفة'
    });
  }

  getIo()?.to(`room:${roomId}`).emit('room:system_event', {
    id: crypto.randomUUID(),
    roomId,
    userId: targetUser.id,
    displayName: targetUser.display_name,
    avatarUrl: targetUser.avatar_url,
    badgeText: 'إدارة الغرفة',
    hasRoyalEntry: false,
    text: actionType === 'mute'
      ? `تم كتم ${targetUser.display_name} في الغرفة لمدة ${mins} دقيقة`
      : `تم تنفيذ إجراء (${actionType === 'kick' ? 'طرد' : 'حظر'}) بحق ${targetUser.display_name}`,
    createdAt: now
  });

  return res.json({ success: true });
});

// ==================================================
// 5. PRIVATE MESSAGES & FOLLOWERS / FOLLOWING SYSTEM (مع ميزة رد المتابعة Follow Back)
// ==================================================

apiRouter.get('/follows', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const viewerId = req.user!.id;
  const targetUserId = String(req.query.userId || viewerId);
  const searchQuery = String(req.query.search || '').trim().toLowerCase();

  // Users who follow targetUserId (المتابعون)
  const followersRows = await dbAll<any>(
    `SELECT f.created_at as followed_at,
            u.id, u.username, u.display_name, u.avatar_url, u.level, u.gender, u.role, u.active_frame, u.status_text, u.hide_online_status,
            EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = ? AND f2.following_id = u.id) as is_following,
            EXISTS(SELECT 1 FROM follows f3 WHERE f3.follower_id = u.id AND f3.following_id = ?) as follows_me
     FROM follows f
     JOIN users u ON u.id = f.follower_id
     WHERE f.following_id = ? AND u.is_banned = 0
     ORDER BY f.created_at DESC`,
    [viewerId, viewerId, targetUserId]
  );

  // Users targetUserId follows (أتابعهم)
  const followingRows = await dbAll<any>(
    `SELECT f.created_at as followed_at,
            u.id, u.username, u.display_name, u.avatar_url, u.level, u.gender, u.role, u.active_frame, u.status_text, u.hide_online_status,
            EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = ? AND f2.following_id = u.id) as is_following,
            EXISTS(SELECT 1 FROM follows f3 WHERE f3.follower_id = u.id AND f3.following_id = ?) as follows_me
     FROM follows f
     JOIN users u ON u.id = f.following_id
     WHERE f.follower_id = ? AND u.is_banned = 0
     ORDER BY f.created_at DESC`,
    [viewerId, viewerId, targetUserId]
  );

  // Suggested or searched active users to follow
  const suggestionsRows = searchQuery
    ? await dbAll<any>(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.level, u.gender, u.role, u.active_frame, u.status_text, u.hide_online_status,
                EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = ? AND f2.following_id = u.id) as is_following,
                EXISTS(SELECT 1 FROM follows f3 WHERE f3.follower_id = u.id AND f3.following_id = ?) as follows_me
         FROM users u
         WHERE u.id != ?
           AND u.is_banned = 0
           AND (LOWER(u.display_name) LIKE ? OR LOWER(u.username) LIKE ?)
         ORDER BY u.level DESC, u.created_at DESC
         LIMIT 40`,
        [viewerId, viewerId, viewerId, `%${searchQuery}%`, `%${searchQuery}%`]
      )
    : await dbAll<any>(
        `SELECT u.id, u.username, u.display_name, u.avatar_url, u.level, u.gender, u.role, u.active_frame, u.status_text, u.hide_online_status,
                EXISTS(SELECT 1 FROM follows f2 WHERE f2.follower_id = ? AND f2.following_id = u.id) as is_following,
                EXISTS(SELECT 1 FROM follows f3 WHERE f3.follower_id = u.id AND f3.following_id = ?) as follows_me
         FROM users u
         WHERE u.id != ?
           AND u.is_banned = 0
           AND NOT EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = u.id)
         ORDER BY follows_me DESC, u.level DESC, u.created_at DESC
         LIMIT 35`,
        [viewerId, viewerId, viewerId, viewerId]
      );

  const enrich = (row: any) => {
    const isFollowingVal = Boolean(row.is_following);
    const followsMeVal = Boolean(row.follows_me);
    return {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      level: row.level,
      gender: row.gender,
      role: row.role,
      active_frame: row.active_frame,
      status_text: row.status_text,
      followed_at: row.followed_at,
      isFollowing: isFollowingVal,
      followsMe: followsMeVal,
      isMutual: isFollowingVal && followsMeVal,
      isOnline: row.hide_online_status ? false : isUserOnline(row.id)
    };
  };

  const followers = followersRows.map(enrich);
  const following = followingRows.map(enrich);
  const suggestions = suggestionsRows.map(enrich);

  const ignored = await dbAll<any>(
    `SELECT iu.ignored_user_id, u.display_name, u.username, u.avatar_url
     FROM ignored_users iu
     JOIN users u ON u.id = iu.ignored_user_id
     WHERE iu.user_id = ?`,
    [viewerId]
  );

  return res.json({
    followers,
    following,
    suggestions,
    ignored,
    followersCount: followers.length,
    followingCount: following.length
  });
});

apiRouter.post('/follows/toggle', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { targetUserId } = req.body;
  if (!targetUserId || targetUserId === userId) {
    return res.status(400).json({ error: 'مستخدم غير صالح' });
  }

  const targetUser = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ? AND is_banned = 0', [targetUserId]);
  if (!targetUser) {
    return res.status(404).json({ error: 'المستخدم غير موجود' });
  }

  const existing = await dbGet('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [userId, targetUserId]);
  const now = Date.now();

  if (existing) {
    await dbRun('DELETE FROM follows WHERE follower_id = ? AND following_id = ?', [userId, targetUserId]);
    await dbRun(
      'DELETE FROM friends WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
      [userId, targetUserId, targetUserId, userId]
    );

    const targetFollowersCount =
      (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM follows WHERE following_id = ?', [targetUserId]))?.c || 0;
    const myFollowingCount =
      (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?', [userId]))?.c || 0;

    emitToUser(targetUserId, 'follow:updated', {
      followerId: userId,
      followingId: targetUserId,
      isFollowing: false,
      followersCount: targetFollowersCount
    });
    emitToUser(userId, 'follow:updated', {
      followerId: userId,
      followingId: targetUserId,
      isFollowing: false,
      followingCount: myFollowingCount
    });

    return res.json({
      success: true,
      isFollowing: false,
      isMutual: false,
      followersCount: targetFollowersCount,
      followingCount: myFollowingCount,
      message: `تم إلغاء متابعة ${targetUser.display_name}`
    });
  } else {
    if (targetUser.allow_follow_requests === 0) {
      return res.status(403).json({ error: 'هذا المستخدم قام بإيقاف استقبال المتابعات الجديدة في إعدادات الخصوصية.' });
    }
    await dbRun('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
      userId,
      targetUserId,
      now
    ]);

    const followsMe = Boolean(
      await dbGet('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?', [targetUserId, userId])
    );

    // Sync with friends table for mutuals so all rooms/live features recognize mutual followers as friends
    if (followsMe) {
      await dbRun(
        `UPDATE friends SET status = 'accepted'
         WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
        [userId, targetUserId, targetUserId, userId]
      );
      const hasFriendRow = await dbGet(
        'SELECT id FROM friends WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
        [userId, targetUserId, targetUserId, userId]
      );
      if (!hasFriendRow) {
        await dbRun(`INSERT INTO friends (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, 'accepted', ?)`, [
          crypto.randomUUID(),
          targetUserId,
          userId,
          now
        ]);
      }
    }

    const notifId = crypto.randomUUID();
    const notifTitle = followsMe ? 'رد المتابعة 🤝' : 'متابع جديد ✨';
    const notifBody = followsMe
      ? `قام ${req.user!.display_name} برد المتابعة لك! أنتما الآن متابعان لبعضكما.`
      : `بدأ ${req.user!.display_name} بمتابعتك الآن.`;

    try {
      await dbRun(
        'INSERT INTO notifications (id, user_id, title, body, notif_type, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
        [notifId, targetUserId, notifTitle, notifBody, 'follow', now]
      );
    } catch {
      // ignore if notifications schema differs
    }

    emitToUser(targetUserId, 'notification:new', {
      title: notifTitle,
      body: notifBody
    });

    const targetFollowersCount =
      (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM follows WHERE following_id = ?', [targetUserId]))?.c || 0;
    const myFollowingCount =
      (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM follows WHERE follower_id = ?', [userId]))?.c || 0;

    emitToUser(targetUserId, 'follow:updated', {
      followerId: userId,
      followingId: targetUserId,
      isFollowing: true,
      isMutual: followsMe,
      followersCount: targetFollowersCount
    });
    emitToUser(userId, 'follow:updated', {
      followerId: userId,
      followingId: targetUserId,
      isFollowing: true,
      isMutual: followsMe,
      followingCount: myFollowingCount
    });
    return res.json({
      success: true,
      isFollowing: true,
      isMutual: followsMe,
      followersCount: targetFollowersCount,
      followingCount: myFollowingCount,
      message: followsMe ? `تم رد المتابعة لـ ${targetUser.display_name} 🤝` : `تمت متابعة ${targetUser.display_name} بنجاح ✨`
    });
  }
});

apiRouter.get('/friends', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const rows = await dbAll<any>(
    `SELECT f.*,
            u1.display_name as req_name, u1.username as req_username, u1.avatar_url as req_avatar, u1.level as req_level, u1.gender as req_gender,
            u2.display_name as add_name, u2.username as add_username, u2.avatar_url as add_avatar, u2.level as add_level, u2.gender as add_gender
     FROM friends f
     JOIN users u1 ON u1.id = f.requester_id
     JOIN users u2 ON u2.id = f.addressee_id
     WHERE f.requester_id = ? OR f.addressee_id = ?
     ORDER BY f.created_at DESC`,
    [userId, userId]
  );

  const ignored = await dbAll<any>(
    `SELECT iu.ignored_user_id, u.display_name, u.username, u.avatar_url
     FROM ignored_users iu
     JOIN users u ON u.id = iu.ignored_user_id
     WHERE iu.user_id = ?`,
    [userId]
  );

  return res.json({ friends: rows, ignored });
});

apiRouter.post('/friends/request', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { targetUserId } = req.body;
  if (!targetUserId || targetUserId === userId) {
    return res.status(400).json({ error: 'طلب غير صالح' });
  }

  const now = Date.now();
  // Also ensure user follows targetUserId when sending a friend request
  await dbRun('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
    userId,
    targetUserId,
    now
  ]);

  const existing = await dbGet<any>(
    'SELECT * FROM friends WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)',
    [userId, targetUserId, targetUserId, userId]
  );
  if (existing) {
    if (existing.status === 'pending' && existing.addressee_id === userId) {
      await dbRun(`UPDATE friends SET status = 'accepted' WHERE id = ?`, [existing.id]);
      return res.json({ success: true, message: 'تم قبول الصداقة ورد المتابعة بنجاح!' });
    }
    return res.json({ success: true, message: 'تمت المتابعة وإرسال طلب الصداقة!' });
  }

  const id = crypto.randomUUID();
  await dbRun(`INSERT INTO friends (id, requester_id, addressee_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`, [
    id,
    userId,
    targetUserId,
    now
  ]);

  emitToUser(targetUserId, 'notification:new', {
    title: 'طلب صداقة ومتابعة 👥',
    body: `قام ${req.user!.display_name} بمتابعتك وإرسال طلب صداقة.`
  });

  return res.json({ success: true, message: 'تمت المتابعة وإرسال طلب الصداقة بنجاح!' });
});

apiRouter.post('/friends/respond', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { requestId, action } = req.body; // 'accept' | 'reject'
  const row = await dbGet<any>('SELECT * FROM friends WHERE id = ? AND addressee_id = ?', [requestId, userId]);
  if (!row) return res.status(404).json({ error: 'الطلب غير موجود' });

  if (action === 'accept') {
    const now = Date.now();
    await dbRun(`UPDATE friends SET status = 'accepted' WHERE id = ?`, [requestId]);
    // Ensure mutual follow on friend accept
    await dbRun('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
      userId,
      row.requester_id,
      now
    ]);
    await dbRun('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)', [
      row.requester_id,
      userId,
      now
    ]);
  } else {
    await dbRun('DELETE FROM friends WHERE id = ?', [requestId]);
  }
  return res.json({ success: true });
});

apiRouter.post('/friends/ignore', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { targetUserId, muteType = 'all' } = req.body;
  if (!targetUserId || targetUserId === userId) {
    return res.status(400).json({ error: 'هدف غير صالح' });
  }
  const exists = await dbGet('SELECT * FROM ignored_users WHERE user_id = ? AND ignored_user_id = ?', [userId, targetUserId]);
  if (exists) {
    await dbRun('DELETE FROM ignored_users WHERE user_id = ? AND ignored_user_id = ?', [userId, targetUserId]);
    return res.json({ ignored: false });
  } else {
    await dbRun(
      'INSERT INTO ignored_users (user_id, ignored_user_id, mute_type, created_at) VALUES (?, ?, ?, ?)',
      [userId, targetUserId, muteType || 'all', Date.now()]
    );
    return res.json({ ignored: true });
  }
});

/** حظر ثنائي الاتجاه يمنع الرسائل الخاصة */
apiRouter.post('/users/block', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { targetUserId } = req.body;
  if (!targetUserId || targetUserId === userId) {
    return res.status(400).json({ error: 'هدف غير صالح' });
  }
  const exists = await dbGet(
    'SELECT 1 FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?',
    [userId, targetUserId]
  );
  if (exists) {
    return res.json({ blocked: true, message: 'محظور مسبقًا' });
  }
  await dbRun(
    'INSERT INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)',
    [userId, targetUserId, Date.now()]
  );
  await dbRun(
    `DELETE FROM friends WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
    [userId, targetUserId, targetUserId, userId]
  );
  return res.json({ blocked: true });
});

apiRouter.post('/users/unblock', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { targetUserId } = req.body;
  await dbRun('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?', [userId, targetUserId]);
  return res.json({ blocked: false });
});

apiRouter.get('/users/blocked', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const rows = await dbAll<any>(
    `SELECT bu.blocked_id, bu.created_at, u.username, u.display_name, u.avatar_url, u.level
     FROM blocked_users bu
     JOIN users u ON u.id = bu.blocked_id
     WHERE bu.blocker_id = ?
     ORDER BY bu.created_at DESC`,
    [userId]
  );
  return res.json({ blocked: rows });
});

apiRouter.get('/messages/conversations', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const hides = await dbAll<any>(
    'SELECT partner_id, cleared_at, deleted_at FROM conversation_hides WHERE user_id = ?',
    [userId]
  );
  const hideMap = new Map<string, { cleared_at: number; deleted_at: number }>();
  for (const h of hides || []) {
    hideMap.set(h.partner_id, { cleared_at: Number(h.cleared_at) || 0, deleted_at: Number(h.deleted_at) || 0 });
  }

  const allMsgs = await dbAll<any>(
    `SELECT pm.*,
            u.id as partner_id, u.display_name as partner_name, u.username as partner_username,
            u.avatar_url as partner_avatar, u.level as partner_level, u.gender as partner_gender,
            u.active_frame as partner_frame
     FROM private_messages pm
     JOIN users u ON u.id = (CASE WHEN pm.sender_id = ? THEN pm.receiver_id ELSE pm.sender_id END)
     WHERE pm.sender_id = ? OR pm.receiver_id = ?
     ORDER BY pm.created_at DESC`,
    [userId, userId, userId]
  );

  const convMap = new Map<string, any>();
  for (const m of allMsgs) {
    const hid = hideMap.get(m.partner_id);
    if (hid && hid.deleted_at > 0) continue; // مخفية من قائمتي
    if (hid && hid.cleared_at > 0 && Number(m.created_at) <= hid.cleared_at) continue;

    if (!convMap.has(m.partner_id)) {
      convMap.set(m.partner_id, {
        partnerId: m.partner_id,
        partnerName: m.partner_name,
        partnerUsername: m.partner_username,
        partnerAvatar: m.partner_avatar,
        partnerLevel: m.partner_level,
        partnerGender: m.partner_gender,
        partnerFrame: m.partner_frame,
        lastMessage: m.is_deleted ? 'تم حذف رسالة' : (m.content || (m.media_type === 'image' ? '📷 صورة' : m.media_type === 'audio' ? '🎙️ رسالة صوتية' : m.media_type === 'gif' ? '🎞️ GIF' : m.media_type === 'sticker' ? '🎨 ملصق' : m.media_type === 'video' ? '🎬 فيديو' : 'رسالة')),
        lastTime: m.created_at,
        unreadCount: 0
      });
    }
    if (m.receiver_id === userId && !m.is_read && (!hid || Number(m.created_at) > (hid.cleared_at || 0))) {
      convMap.get(m.partner_id)!.unreadCount += 1;
    }
  }

  // ترتيب: المثبتة أولاً
  const pins = await dbAll<any>('SELECT partner_id FROM conversation_pins WHERE user_id = ?', [userId]);
  const pinSet = new Set((pins || []).map((p: any) => p.partner_id));
  const mutes = await dbAll<any>('SELECT partner_id FROM conversation_mutes WHERE user_id = ?', [userId]);
  const muteSet = new Set((mutes || []).map((m: any) => m.partner_id));
  const list = Array.from(convMap.values()).map((c: any) => ({
    ...c,
    isPinned: pinSet.has(c.partnerId),
    isMuted: muteSet.has(c.partnerId)
  }));
  list.sort((a: any, b: any) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return (b.lastTime || 0) - (a.lastTime || 0);
  });
  return res.json({ conversations: list });
});

apiRouter.get('/messages/:partnerId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;

  // Mark incoming messages from partner as read
  await dbRun('UPDATE private_messages SET is_read = 1 WHERE sender_id = ? AND receiver_id = ?', [partnerId, userId]);

  // احترام تفريغ المحادثة من طرف المستخدم (clearedAt)
  const hide = await dbGet<any>(
    'SELECT cleared_at, deleted_at FROM conversation_hides WHERE user_id = ? AND partner_id = ?',
    [userId, partnerId]
  );
  if (hide && Number(hide.deleted_at) > 0) {
    return res.json({ messages: [], partner: await dbGet('SELECT id, username, display_name, avatar_url, gender, level, role, active_frame, status_text FROM users WHERE id = ?', [partnerId]) });
  }
  const clearedAt = hide ? Number(hide.cleared_at) || 0 : 0;

  // أحدث الرسائل أولاً ثم نعكس للعرض (إصلاح اختفاء الرسائل عند كثرتها)
  const rawMessages = await dbAll<any>(
    `SELECT pm.*, u.display_name as sender_name, u.avatar_url as sender_avatar, u.username as sender_username
     FROM private_messages pm
     JOIN users u ON u.id = pm.sender_id
     WHERE ((pm.sender_id = ? AND pm.receiver_id = ?)
        OR (pm.sender_id = ? AND pm.receiver_id = ?))
       AND pm.created_at > ?
     ORDER BY pm.created_at DESC
     LIMIT 300`,
    [userId, partnerId, partnerId, userId, clearedAt]
  );
  const messages = (rawMessages || []).reverse();

  const partnerRow = await dbGet<any>(
    `SELECT id, username, display_name, avatar_url, gender, level, role, active_frame, status_text,
            COALESCE(hide_online_status, 0) as hide_online_status,
            COALESCE(last_seen_at, 0) as last_seen_at
     FROM users WHERE id = ?`,
    [partnerId]
  );
  const partner = partnerRow
    ? {
        ...partnerRow,
        isOnline: partnerRow.hide_online_status ? false : isUserOnline(partnerId),
        lastSeenAt: Number(partnerRow.last_seen_at) || 0
      }
    : null;

  return res.json({ messages, partner });
});

apiRouter.post('/messages/:partnerId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;
  const {
    content = '',
    mediaUrl = '',
    mediaType = 'text',
    replyToId = '',
    stickerId = '',
    gifUrl = '',
    gifPreviewUrl = ''
  } = req.body;

  if (!content.trim() && !mediaUrl && mediaType !== 'sticker' && mediaType !== 'gif') {
    return res.status(400).json({ error: 'الرسالة فارغة' });
  }

  // حظر ثنائي أو كتم
  const isBlocked = await dbGet(
    `SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)`,
    [userId, partnerId, partnerId, userId]
  );
  if (isBlocked) {
    return res.status(403).json({ error: 'لا يمكن إرسال رسالة بسبب الحظر.' });
  }
  const isIgnored = await dbGet('SELECT * FROM ignored_users WHERE user_id = ? AND ignored_user_id = ?', [partnerId, userId]);
  if (isIgnored) {
    return res.status(403).json({ error: 'لا يمكنك مراسلة هذا المستخدم حالياً.' });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const safeContent = content.trim().slice(0, 1000);

  const finalMediaUrl = mediaUrl || gifUrl || '';
  await dbRun(
    `INSERT INTO private_messages (id, sender_id, receiver_id, content, media_url, media_type, is_read, reply_to_id, is_deleted, sticker_id, gif_url, gif_preview_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
    [id, userId, partnerId, safeContent, finalMediaUrl, mediaType, replyToId || '', stickerId || '', gifUrl || '', gifPreviewUrl || '', now]
  );

  const msgObj = {
    id,
    sender_id: userId,
    receiver_id: partnerId,
    content: safeContent,
    media_url: finalMediaUrl,
    media_type: mediaType,
    is_read: 0,
    reply_to_id: replyToId || '',
    is_deleted: 0,
    sticker_id: stickerId || '',
    gif_url: gifUrl || '',
    gif_preview_url: gifPreviewUrl || '',
    created_at: now,
    sender_name: req.user!.display_name,
    sender_avatar: req.user!.avatar_url
  };

  emitToUser(partnerId, 'pm:new', msgObj);
  emitToUser(userId, 'pm:new', msgObj);

  return res.json({ message: msgObj });
});

// ==================================================
// 6. STORIES (24 HOURS AUTO-EXPIRY)
// ==================================================

apiRouter.get('/stories', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const now = Date.now();
  const userId = req.user!.id;
  // Clean up expired stories automatically
  await dbRun('DELETE FROM stories WHERE expires_at <= ?', [now]);

  const rows = await dbAll<any>(
    `SELECT s.*, u.username, u.display_name, u.avatar_url, u.gender, u.level, u.active_frame,
            (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id) as views_count,
            (SELECT COUNT(*) FROM story_views sv WHERE sv.story_id = s.id AND sv.liked = 1) as likes_count,
            (SELECT liked FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = ?) as viewer_liked,
            EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = s.user_id) as is_following
     FROM stories s
     JOIN users u ON u.id = s.user_id
     WHERE s.expires_at > ?
     ORDER BY s.created_at DESC`,
    [userId, userId, now]
  );

  return res.json({ stories: rows });
});

apiRouter.post('/stories', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { mediaUrl = '', mediaType = 'text', caption = '', bgStyle = 'from-indigo-900 via-slate-900 to-slate-950' } = req.body;

  if (!mediaUrl && !caption.trim()) {
    return res.status(400).json({ error: 'يرجى إضافة نص أو صورة أو فيديو للقصة.' });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000; // 24 hours
  const cleanCaption = String(caption).slice(0, 350);

  await dbRun(
    `INSERT INTO stories (id, user_id, media_url, media_type, caption, bg_style, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, user.id, mediaUrl, mediaType, cleanCaption, bgStyle, expiresAt, now]
  );

  await awardUserXp(user.id, 10);

  const createdStory = {
    id,
    user_id: user.id,
    media_url: mediaUrl,
    media_type: mediaType,
    caption: cleanCaption,
    bg_style: bgStyle,
    expires_at: expiresAt,
    created_at: now,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    gender: user.gender,
    level: user.level,
    active_frame: user.active_frame,
    views_count: 0,
    likes_count: 0,
    viewer_liked: 0,
    is_following: 0
  };

  return res.json({ success: true, storyId: id, story: createdStory });
});

apiRouter.post('/stories/:id/interact', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const storyId = req.params.id;
  const viewerId = req.user!.id;
  const { like } = req.body;

  const story = await dbGet<any>('SELECT * FROM stories WHERE id = ?', [storyId]);
  if (!story) return res.status(404).json({ error: 'القصة غير موجودة أو انتهت صلاحيتها' });

  const existing = await dbGet<any>('SELECT * FROM story_views WHERE story_id = ? AND viewer_id = ?', [storyId, viewerId]);
  const likedVal = like ? 1 : existing?.liked || 0;

  if (!existing) {
    await dbRun('INSERT INTO story_views (story_id, viewer_id, liked, created_at) VALUES (?, ?, ?, ?)', [
      storyId,
      viewerId,
      likedVal,
      Date.now()
    ]);
    await rewardCreatorEngagementGem(story.user_id, viewerId, `story_view:${storyId}`);
  } else if (like !== undefined) {
    await dbRun('UPDATE story_views SET liked = ? WHERE story_id = ? AND viewer_id = ?', [like ? 1 : 0, storyId, viewerId]);
    if (like) {
      await rewardCreatorEngagementGem(story.user_id, viewerId, `story_like:${storyId}`);
    }
  }

  const viewers = await dbAll<any>(
    `SELECT sv.liked, sv.created_at, u.id, u.display_name, u.avatar_url
     FROM story_views sv
     JOIN users u ON u.id = sv.viewer_id
     WHERE sv.story_id = ?
     ORDER BY sv.created_at DESC`,
    [storyId]
  );

  return res.json({ success: true, viewers });
});

apiRouter.delete('/stories/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const storyId = req.params.id;
  const story = await dbGet<any>('SELECT * FROM stories WHERE id = ?', [storyId]);
  if (!story) return res.status(404).json({ error: 'القصة غير موجودة' });

  const perms = await getRolePermission(req.user!.role);
  if (story.user_id !== req.user!.id && !perms?.can_moderate_chat) {
    return res.status(403).json({ error: 'لا يمكنك حذف هذه القصة' });
  }

  await dbRun('DELETE FROM stories WHERE id = ?', [storyId]);
  return res.json({ success: true });
});

// ==================================================
// 7. SHORT VIDEOS / REELS
// ==================================================

apiRouter.get('/reels', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const reels = await dbAll<any>(
    `SELECT r.*, u.username, u.display_name, u.avatar_url, u.gender, u.level, u.active_frame,
            (SELECT 1 FROM reel_likes rl WHERE rl.reel_id = r.id AND rl.user_id = ?) as is_liked,
            EXISTS(SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = r.user_id) as is_following
     FROM reels r
     JOIN users u ON u.id = r.user_id
     ORDER BY r.created_at DESC
     LIMIT 50`,
    [userId, userId]
  );
  return res.json({ reels });
});

apiRouter.post('/reels', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { videoUrl, title, description = '' } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ error: 'يرجى اختيار ملف الفيديو للريلز.' });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  const cleanTitle = (String(title || '').trim() || `ريلز ${user.display_name} ✨`).slice(0, 100);
  const cleanDesc = String(description || '').slice(0, 300);
  await dbRun(
    `INSERT INTO reels (id, user_id, video_url, title, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, user.id, videoUrl, cleanTitle, cleanDesc, now]
  );

  await awardUserXp(user.id, 15);

  // إشعار المتابعين بريلز جديد
  try {
    const followers = await dbAll<{ follower_id: string }>(
      'SELECT follower_id FROM follows WHERE following_id = ? LIMIT 200',
      [user.id]
    );
    for (const f of followers || []) {
      const nid = crypto.randomUUID();
      await dbRun(
        `INSERT INTO notifications (id, user_id, title, body, notif_type, is_read, actor_id, target_type, target_id, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          nid,
          f.follower_id,
          'ريلز جديد',
          `${user.display_name} نشر ريلز جديداً`,
          'reel',
          user.id,
          'reel',
          id,
          JSON.stringify({ reelId: id }),
          now
        ]
      );
      try {
        emitToUser(f.follower_id, 'notification:new', {
          id: nid,
          title: 'ريلز جديد',
          body: `${user.display_name} نشر ريلز جديداً`,
          notif_type: 'reel'
        });
      } catch {}
    }
  } catch (e) {
    console.error('[reels notify]', e);
  }

  const createdReel = {
    id,
    user_id: user.id,
    video_url: videoUrl,
    thumbnail_url: '',
    title: cleanTitle,
    description: cleanDesc,
    views_count: 0,
    likes_count: 0,
    comments_count: 0,
    shares_count: 0,
    created_at: now,
    username: user.username,
    display_name: user.display_name,
    avatar_url: user.avatar_url,
    gender: user.gender,
    level: user.level,
    active_frame: user.active_frame,
    is_liked: 0,
    is_following: 0
  };

  return res.json({ success: true, reelId: id, reel: createdReel });
});

apiRouter.delete('/reels/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const reelId = req.params.id;
  const reel = await dbGet<any>('SELECT * FROM reels WHERE id = ?', [reelId]);
  if (!reel) return res.status(404).json({ error: 'الفيديو غير موجود' });

  const perms = await getRolePermission(req.user!.role);
  if (reel.user_id !== req.user!.id && !perms?.can_moderate_chat && !perms?.can_access_admin) {
    return res.status(403).json({ error: 'لا يمكنك حذف هذا الريلز' });
  }

  await dbRun('DELETE FROM reels WHERE id = ?', [reelId]);
  return res.json({ success: true });
});

apiRouter.post('/reels/:id/view', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const reelId = req.params.id;
  const viewerId = req.user!.id;
  const reel = await dbGet<any>('SELECT * FROM reels WHERE id = ?', [reelId]);
  if (!reel) return res.status(404).json({ error: 'الفيديو غير موجود' });

  const alreadyViewed = await dbGet('SELECT * FROM reel_views WHERE reel_id = ? AND viewer_id = ?', [reelId, viewerId]);
  if (!alreadyViewed) {
    await dbRun('INSERT INTO reel_views (reel_id, viewer_id, created_at) VALUES (?, ?, ?)', [reelId, viewerId, Date.now()]);
    await dbRun('UPDATE reels SET views_count = views_count + 1 WHERE id = ?', [reelId]);
    await rewardCreatorEngagementGem(reel.user_id, viewerId, `reel_view:${reelId}`);
  }
  return res.json({ success: true });
});

apiRouter.post('/reels/:id/like', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const reelId = req.params.id;
  const userId = req.user!.id;
  const reel = await dbGet<any>('SELECT * FROM reels WHERE id = ?', [reelId]);
  if (!reel) return res.status(404).json({ error: 'الفيديو غير موجود' });

  const existing = await dbGet('SELECT * FROM reel_likes WHERE reel_id = ? AND user_id = ?', [reelId, userId]);
  if (existing) {
    await dbRun('DELETE FROM reel_likes WHERE reel_id = ? AND user_id = ?', [reelId, userId]);
    await dbRun('UPDATE reels SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?', [reelId]);
    return res.json({ liked: false });
  } else {
    await dbRun('INSERT INTO reel_likes (reel_id, user_id, created_at) VALUES (?, ?, ?)', [reelId, userId, Date.now()]);
    await dbRun('UPDATE reels SET likes_count = likes_count + 1 WHERE id = ?', [reelId]);
    await rewardCreatorEngagementGem(reel.user_id, userId, `reel_like:${reelId}`);
    return res.json({ liked: true });
  }
});

apiRouter.get('/reels/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const comments = await dbAll<any>(
    `SELECT rc.*, u.display_name, u.username, u.avatar_url, u.level, u.gender
     FROM reel_comments rc
     JOIN users u ON u.id = rc.user_id
     WHERE rc.reel_id = ?
     ORDER BY rc.created_at DESC
     LIMIT 60`,
    [req.params.id]
  );
  return res.json({ comments });
});

apiRouter.post('/reels/:id/comments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const reelId = req.params.id;
  const { content } = req.body;
  const clean = (content || '').trim().slice(0, 300);
  if (!clean) return res.status(400).json({ error: 'التعليق فارغ' });

  const reel = await dbGet<any>('SELECT * FROM reels WHERE id = ?', [reelId]);
  if (!reel) return res.status(404).json({ error: 'الفيديو غير موجود' });

  const id = crypto.randomUUID();
  await dbRun('INSERT INTO reel_comments (id, reel_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    reelId,
    req.user!.id,
    clean,
    Date.now()
  ]);
  await dbRun('UPDATE reels SET comments_count = comments_count + 1 WHERE id = ?', [reelId]);
  await rewardCreatorEngagementGem(reel.user_id, req.user!.id, `reel_comment:${reelId}`);

  return res.json({ success: true });
});

// ==================================================
// 8. FRIENDS WALL (حائط الأصدقاء)
// ==================================================

apiRouter.get('/wall', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const posts = await dbAll<any>(
    `SELECT wp.*, u.display_name, u.username, u.avatar_url, u.gender, u.level, u.role, u.active_frame,
            (SELECT 1 FROM wall_likes wl WHERE wl.post_id = wp.id AND wl.user_id = ?) as is_liked
     FROM wall_posts wp
     JOIN users u ON u.id = wp.user_id
     ORDER BY wp.created_at DESC
     LIMIT 40`,
    [req.user!.id]
  );

  for (const p of posts) {
    p.comments = await dbAll<any>(
      `SELECT wc.*, u.display_name, u.avatar_url
       FROM wall_comments wc
       JOIN users u ON u.id = wc.user_id
       WHERE wc.post_id = ?
       ORDER BY wc.created_at ASC
       LIMIT 20`,
      [p.id]
    );
  }

  return res.json({ posts });
});

apiRouter.post('/wall', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { content = '', mediaUrl = '' } = req.body;
  if (!content.trim() && !mediaUrl) {
    return res.status(400).json({ error: 'يرجى كتابة منشور أو إرفاق صورة.' });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  const cleanContent = String(content).trim().slice(0, 600);
  await dbRun('INSERT INTO wall_posts (id, user_id, content, media_url, created_at) VALUES (?, ?, ?, ?, ?)', [
    id,
    req.user!.id,
    cleanContent,
    mediaUrl,
    now
  ]);
  await awardUserXp(req.user!.id, 5);
  return res.json({ success: true });
});

apiRouter.post('/wall/:id/like', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const postId = req.params.id;
  const userId = req.user!.id;
  const existing = await dbGet('SELECT * FROM wall_likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
  if (existing) {
    await dbRun('DELETE FROM wall_likes WHERE post_id = ? AND user_id = ?', [postId, userId]);
    await dbRun('UPDATE wall_posts SET likes_count = GREATEST(0, likes_count - 1) WHERE id = ?', [postId]);
    return res.json({ liked: false });
  } else {
    await dbRun('INSERT INTO wall_likes (post_id, user_id, created_at) VALUES (?, ?, ?)', [postId, userId, Date.now()]);
    await dbRun('UPDATE wall_posts SET likes_count = likes_count + 1 WHERE id = ?', [postId]);
    return res.json({ liked: true });
  }
});

apiRouter.post('/wall/:id/comment', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const postId = req.params.id;
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'التعليق فارغ' });

  await dbRun('INSERT INTO wall_comments (id, post_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)', [
    crypto.randomUUID(),
    postId,
    req.user!.id,
    String(content).trim().slice(0, 250),
    Date.now()
  ]);
  await dbRun('UPDATE wall_posts SET comments_count = comments_count + 1 WHERE id = ?', [postId]);
  return res.json({ success: true });
});

// ==================================================
// 9. SERVER-AUTHORITATIVE ECONOMY, STORE & GIFTS
// ==================================================

apiRouter.post('/economy/heartbeat', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const result = await processMinuteHeartbeat(req.user!.id);
  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({
    awarded: result.awarded,
    user: await formatUserResponse(updated)
  });
});

apiRouter.post('/economy/daily-claim', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const now = Date.now();
  const cooldownMs = 24 * 60 * 60 * 1000;

  if (user.last_daily_claim && now - user.last_daily_claim < cooldownMs) {
    const remainingHours = Math.ceil((cooldownMs - (now - user.last_daily_claim)) / (1000 * 60 * 60));
    return res.status(400).json({
      error: `لقد استلمت المكافأة اليومية بالفعل. يمكنك استلامها مجدداً بعد ${remainingHours} ساعة.`
    });
  }

  const rewardSetting = await dbGet<{ value: string }>(`SELECT value FROM platform_settings WHERE key = 'daily_gold_reward'`);
  const goldReward = Math.max(5, parseInt(rewardSetting?.value || '25', 10) || 25);

  await dbRun('UPDATE users SET gold = gold + ?, last_daily_claim = ? WHERE id = ?', [goldReward, now, user.id]);
  await awardUserXp(user.id, 15);

  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({
    message: `تم استلام مكافأة الحضور اليومي: +${goldReward} عملة ذهبية و +15 XP!`,
    user: await formatUserResponse(updated)
  });
});

apiRouter.post('/economy/convert-xp', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { xpAmount } = req.body;
  const result = await convertXpToGold(req.user!.id, Number(xpAmount));
  if (!result.success) {
    return res.status(400).json({ error: result.message });
  }
  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({
    message: result.message,
    user: await formatUserResponse(updated)
  });
});

apiRouter.get('/store', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const items = await dbAll<any>('SELECT * FROM store_items WHERE is_active = 1 ORDER BY price ASC');
  const inventory = await dbAll<any>('SELECT * FROM user_inventory WHERE user_id = ?', [req.user!.id]);
  const ownedIds = new Set(inventory.map((i) => i.item_id));
  const equippedIds = new Set(inventory.filter((i) => i.is_equipped).map((i) => i.item_id));

  const enriched = items.map((item) => ({
    ...item,
    isOwned: ownedIds.has(item.id),
    isEquipped: equippedIds.has(item.id)
  }));

  return res.json({ items: enriched });
});

apiRouter.post('/store/buy', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { itemId } = req.body;

  // Server reads item price & requirements from DB — never trusts client!
  const item = await dbGet<any>('SELECT * FROM store_items WHERE id = ? AND is_active = 1', [itemId]);
  if (!item) return res.status(404).json({ error: 'العنصر غير متوفر في المتجر' });

  if (user.level < item.min_level) {
    return res.status(400).json({ error: `يتطلب هذا العنصر الوصول إلى المستوى ${item.min_level} على الأقل.` });
  }

  const alreadyOwned = await dbGet('SELECT id FROM user_inventory WHERE user_id = ? AND item_id = ?', [user.id, item.id]);
  if (alreadyOwned) {
    return res.status(400).json({ error: 'أنت تملك هذا العنصر بالفعل في مقتنياتك.' });
  }

  if (item.currency === 'gold') {
    if (user.gold < item.price) {
      return res.status(400).json({ error: 'رصيد العملات الذهبية (Gold) غير كافٍ للشراء.' });
    }
    await dbRun('UPDATE users SET gold = gold - ? WHERE id = ?', [item.price, user.id]);
  } else {
    if (user.gems < item.price) {
      return res.status(400).json({ error: 'رصيد الجواهر (Gems) غير كافٍ للشراء.' });
    }
    await dbRun('UPDATE users SET gems = gems - ? WHERE id = ?', [item.price, user.id]);
  }

  await dbRun('INSERT INTO user_inventory (id, user_id, item_id, is_equipped, purchased_at) VALUES (?, ?, ?, 0, ?)', [
    crypto.randomUUID(),
    user.id,
    item.id,
    Date.now()
  ]);

  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({
    message: `تم شراء "${item.name}" بنجاح! يمكنك تفعيله الآن.`,
    user: await formatUserResponse(updated)
  });
});

apiRouter.post('/store/equip', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  const { itemId } = req.body;
  const inv = await dbGet<any>(
    `SELECT ui.*, si.item_type, si.css_value, si.name
     FROM user_inventory ui
     JOIN store_items si ON si.id = ui.item_id
     WHERE ui.user_id = ? AND ui.item_id = ?`,
    [user.id, itemId]
  );

  if (!inv) {
    return res.status(404).json({ error: 'لا تملك هذا العنصر في حقيبتك.' });
  }

  // Toggle equip state
  const newEquipped = inv.is_equipped ? 0 : 1;
  // Unequip other items of same type first
  const sameTypeItems = await dbAll<{ id: string }>(
    `SELECT ui.id FROM user_inventory ui
     JOIN store_items si ON si.id = ui.item_id
     WHERE ui.user_id = ? AND si.item_type = ?`,
    [user.id, inv.item_type]
  );
  for (const st of sameTypeItems) {
    await dbRun('UPDATE user_inventory SET is_equipped = 0 WHERE id = ?', [st.id]);
  }

  await dbRun('UPDATE user_inventory SET is_equipped = ? WHERE id = ?', [newEquipped, inv.id]);

  const valToSet = newEquipped ? inv.css_value : '';
  if (inv.item_type === 'name_color') {
    await dbRun('UPDATE users SET name_color = ? WHERE id = ?', [valToSet, user.id]);
  } else if (inv.item_type === 'frame') {
    await dbRun('UPDATE users SET active_frame = ? WHERE id = ?', [valToSet, user.id]);
  } else if (inv.item_type === 'badge') {
    await dbRun('UPDATE users SET active_badge = ? WHERE id = ?', [valToSet, user.id]);
  } else if (inv.item_type === 'effect') {
    await dbRun('UPDATE users SET active_effect = ? WHERE id = ?', [valToSet, user.id]);
  }

  const updated = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({
    message: newEquipped ? `تم تفعيل "${inv.name}" على حسابك!` : `تم إلغاء تفعيل "${inv.name}".`,
    user: await formatUserResponse(updated)
  });
});

apiRouter.get('/gifts', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const gifts = await dbAll('SELECT * FROM gifts_catalog ORDER BY currency DESC, cost ASC');
  return res.json({ gifts });
});

apiRouter.post('/gifts/send', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const sender = req.user!;
  const { giftId, receiverId, contextType = 'room', contextId = 'room-general', battleSide = 'host' } = req.body;

  // Authoritative gift lookup from DB
  const gift = await dbGet<any>('SELECT * FROM gifts_catalog WHERE id = ?', [giftId]);
  if (!gift) {
    return res.status(404).json({ error: 'الهدية غير موجودة' });
  }

  const receiver = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [receiverId]);
  if (!receiver) {
    return res.status(404).json({ error: 'المستلم غير موجود' });
  }

  // Verify sender balance on server
  if (gift.currency === 'gold') {
    if (sender.gold < gift.cost) {
      return res.status(400).json({ error: `رصيدك من العملات الذهبية غير كافٍ (تحتاج ${gift.cost} Gold).` });
    }
    await dbRun('UPDATE users SET gold = gold - ? WHERE id = ?', [gift.cost, sender.id]);
  } else {
    if (sender.gems < gift.cost) {
      return res.status(400).json({ error: `رصيدك من الجواهر النادرة غير كافٍ (تحتاج ${gift.cost} Gems).` });
    }
    await dbRun('UPDATE users SET gems = gems - ? WHERE id = ?', [gift.cost, sender.id]);
  }

  // Credit sender support power & XP, and credit receiver reward
  await dbRun('UPDATE users SET total_support_power = total_support_power + ? WHERE id = ?', [gift.bar_power, sender.id]);
  const receiverGoldBonus = gift.currency === 'gems' ? gift.cost * 5 : Math.floor(gift.cost * 0.25);
  await dbRun('UPDATE users SET gold = gold + ? WHERE id = ?', [receiverGoldBonus, receiver.id]);
  await awardUserXp(sender.id, Math.min(200, Math.max(5, Math.floor(gift.bar_power / 100))));

  const txId = crypto.randomUUID();
  const now = Date.now();
  await dbRun(
    `INSERT INTO gift_transactions (id, sender_id, receiver_id, gift_id, context_type, context_id, currency, cost, bar_power, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [txId, sender.id, receiver.id, gift.id, contextType, contextId, gift.currency, gift.cost, gift.bar_power, now]
  );

  const giftAnimationPayload = {
    id: txId,
    senderId: sender.id,
    senderName: sender.display_name,
    senderAvatar: sender.avatar_url,
    senderLevel: sender.level,
    receiverId: receiver.id,
    receiverName: receiver.display_name,
    giftId: gift.id,
    giftName: gift.name_ar,
    giftEmoji: gift.icon_emoji,
    currency: gift.currency,
    cost: gift.cost,
    barPower: gift.bar_power,
    tier: gift.tier,
    effectClass: gift.effect_class,
    createdAt: now
  };

  if (contextType === 'live') {
    const stream = await dbGet<any>(`SELECT * FROM live_streams WHERE id = ? AND status = 'active'`, [contextId]);
    if (stream) {
      await dbRun('UPDATE live_streams SET support_bar = support_bar + ? WHERE id = ?', [gift.bar_power, contextId]);
      if (stream.battle_status === 'Active' || stream.battle_status === 'Ending') {
        const isThirdSide =
          stream.battle_mode === 'Triple' &&
          (receiver.id === stream.battle_third_id || battleSide === 'third');
        const isOpponentSide =
          !isThirdSide &&
          (receiver.id === stream.battle_opponent_id || battleSide === 'opponent');

        if (isThirdSide) {
          await dbRun('UPDATE live_streams SET battle_third_score = battle_third_score + ? WHERE id = ?', [
            gift.bar_power,
            contextId
          ]);
          if (stream.battle_opponent_live_id) {
            await dbRun('UPDATE live_streams SET battle_third_score = battle_third_score + ? WHERE id = ?', [
              gift.bar_power,
              stream.battle_opponent_live_id
            ]);
          }
        } else if (isOpponentSide) {
          await dbRun('UPDATE live_streams SET battle_opponent_score = battle_opponent_score + ? WHERE id = ?', [
            gift.bar_power,
            contextId
          ]);
          if (stream.battle_opponent_live_id) {
            await dbRun('UPDATE live_streams SET battle_host_score = battle_host_score + ? WHERE id = ?', [
              gift.bar_power,
              stream.battle_opponent_live_id
            ]);
          }
        } else {
          await dbRun('UPDATE live_streams SET battle_host_score = battle_host_score + ? WHERE id = ?', [
            gift.bar_power,
            contextId
          ]);
          if (stream.battle_opponent_live_id) {
            await dbRun('UPDATE live_streams SET battle_opponent_score = battle_opponent_score + ? WHERE id = ?', [
              gift.bar_power,
              stream.battle_opponent_live_id
            ]);
          }
        }
      }

      const liveChatEvent: LiveChatItem = {
        id: crypto.randomUUID(),
        userId: sender.id,
        displayName: sender.display_name,
        avatarUrl: sender.avatar_url,
        level: sender.level,
        role: sender.role,
        gender: sender.gender,
        type: 'gift',
        content: `أرسل هدية ${gift.name_ar} إلى ${receiver.display_name}`,
        giftEmoji: gift.icon_emoji,
        giftName: gift.name_ar,
        giftPower: gift.bar_power,
        createdAt: now
      };

      getIo()?.to(`live:${contextId}`).emit('live:gift_animation', giftAnimationPayload);
      getIo()?.to(`live:${contextId}`).emit('live:chat_event', liveChatEvent);
      await broadcastLiveState(contextId);
      if (stream.battle_opponent_live_id) {
        getIo()?.to(`live:${stream.battle_opponent_live_id}`).emit('live:gift_animation', giftAnimationPayload);
        getIo()?.to(`live:${stream.battle_opponent_live_id}`).emit('live:chat_event', liveChatEvent);
        await broadcastLiveState(stream.battle_opponent_live_id);
      }
    }
  } else if (contextType === 'room') {
    getIo()?.to(`room:${contextId}`).emit('room:gift_animation', giftAnimationPayload);
    getIo()?.to(`room:${contextId}`).emit('room:system_event', {
      id: crypto.randomUUID(),
      roomId: contextId,
      userId: sender.id,
      displayName: sender.display_name,
      avatarUrl: sender.avatar_url,
      badgeText: `${gift.icon_emoji} هدية ملكية`,
      hasRoyalEntry: true,
      text: `أهدى [ ${gift.icon_emoji} ${gift.name_ar} (+${gift.bar_power} نقطة دعم) ] إلى ${receiver.display_name}`,
      createdAt: now
    });
  }

  const updatedSender = (await getUserBySessionToken(req.sessionToken))!;
  return res.json({
    success: true,
    giftAnimation: giftAnimationPayload,
    user: await formatUserResponse(updatedSender)
  });
});

// ==================================================
// 10. LIVE AUDIO STREAMING & LIVE BATTLES + WEBRTC ICE CONFIG
// ==================================================

apiRouter.get('/webrtc/ice-config', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const iceServers: any[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ];

  const turnUrl = (process.env.TURN_URL || '').trim();
  const turnUsername = (process.env.TURN_USERNAME || '').trim();
  const turnPassword = (process.env.TURN_PASSWORD || '').trim();

  if (turnUrl) {
    const turnUrls = turnUrl.split(',').map((u) => u.trim()).filter(Boolean);
    const turnEntry: Record<string, any> = { urls: turnUrls.length > 1 ? turnUrls : turnUrls[0] };
    if (turnUsername) turnEntry.username = turnUsername;
    if (turnPassword) turnEntry.credential = turnPassword;
    iceServers.push(turnEntry);
  }

  return res.json({
    iceServers,
    turnConfigured: Boolean(turnUrl)
  });
});

apiRouter.get('/live', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const streams = await dbAll<any>(
    `SELECT ls.*, u.display_name as host_name, u.username as host_username,
            u.avatar_url as host_avatar, u.level as host_level, u.gender as host_gender,
            u.active_frame as host_frame
     FROM live_streams ls
     JOIN users u ON u.id = ls.host_id
     WHERE ls.status = 'active'
     ORDER BY ls.support_bar DESC, ls.created_at DESC`
  );

  const enriched = await Promise.all(streams.map(async (s) => ({
    ...s,
    max_seats: 4,
    viewerCount: getLiveViewerCount(s.id),
    seats: await getOrInitLiveSeats(s.id)
  })));

  return res.json({ streams: enriched });
});

apiRouter.post('/live/start', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const user = req.user!;
  if (user.is_guest) {
    return res.status(403).json({ error: 'يجب تسجيل حساب دائم لبدء بث صوتي مباشر.' });
  }

  // End and clean up any previous active stream by this host
  const prevStreams = await dbAll<{ id: string }>(
    `SELECT id FROM live_streams WHERE host_id = ? AND status = 'active'`,
    [user.id]
  );
  const now = Date.now();
  for (const prev of prevStreams) {
    await dbRun(`UPDATE live_streams SET status = 'ended', ended_at = ? WHERE id = ?`, [now, prev.id]);
    await cleanupLiveSession(prev.id);
    getIo()?.to(`live:${prev.id}`).emit('live:ended', { liveId: prev.id });
  }

  const { title, topic = 'سوالف وتحديات صوتية' } = req.body;
  const cleanTitle = (title || `بث ${user.display_name} الصوتي`).trim().slice(0, 80);
  const liveId = `live-${crypto.randomUUID().slice(0, 8)}`;

  await dbRun(
    `INSERT INTO live_streams (
      id, host_id, title, topic, status, support_bar, total_taps, max_seats, battle_status, battle_mode, battle_round, created_at, ended_at
    ) VALUES (?, ?, ?, ?, 'active', 0, 0, 4, 'Idle', 'Classic', 0, ?, 0)`,
    [liveId, user.id, cleanTitle, String(topic).slice(0, 40), now]
  );

  const seats = await getOrInitLiveSeats(liveId, user);
  const stream = await dbGet<any>(
    `SELECT ls.*, u.display_name as host_name, u.username as host_username,
            u.avatar_url as host_avatar, u.level as host_level, u.gender as host_gender,
            u.active_frame as host_frame
     FROM live_streams ls
     JOIN users u ON u.id = ls.host_id
     WHERE ls.id = ?`,
    [liveId]
  );

  // إشعار المتابعين ببدء البث
  try {
    const followers = await dbAll<{ follower_id: string }>(
      'SELECT follower_id FROM follows WHERE following_id = ? LIMIT 200',
      [user.id]
    );
    for (const f of followers || []) {
      const nid = crypto.randomUUID();
      await dbRun(
        `INSERT INTO notifications (id, user_id, title, body, notif_type, is_read, actor_id, target_type, target_id, data_json, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          nid,
          f.follower_id,
          'بث مباشر',
          `${user.display_name} بدأ بثاً مباشراً: ${cleanTitle}`,
          'live',
          user.id,
          'live',
          liveId,
          JSON.stringify({ liveId }),
          now
        ]
      );
      try {
        emitToUser(f.follower_id, 'notification:new', {
          id: nid,
          title: 'بث مباشر',
          body: `${user.display_name} بدأ بثاً مباشراً`,
          notif_type: 'live'
        });
      } catch {}
    }
  } catch (e) {
    console.error('[live notify]', e);
  }

  return res.json({
    stream: {
      ...stream,
      viewerCount: 1,
      seats
    }
  });
});

apiRouter.post('/live/:id/end', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const liveId = req.params.id;
  const stream = await dbGet<any>('SELECT * FROM live_streams WHERE id = ?', [liveId]);
  if (!stream) return res.status(404).json({ error: 'البث غير موجود' });

  const perms = await getRolePermission(req.user!.role);
  if (stream.host_id !== req.user!.id && !perms?.can_manage_live) {
    return res.status(403).json({ error: 'فقط المضيف أو الإدارة يمكنهم إنهاء البث.' });
  }

  const linkedLiveId = stream.battle_opponent_live_id;

  await dbRun(
    `UPDATE live_streams SET status = 'ended', battle_status = 'Finished', ended_at = ? WHERE id = ?`,
    [Date.now(), liveId]
  );
  getIo()?.to(`live:${liveId}`).emit('live:ended', { liveId });
  await cleanupLiveSession(liveId);

  if (linkedLiveId) {
    await dbRun(
      `UPDATE live_streams
       SET battle_status = 'Idle',
           battle_invite_expires_at = 0,
           battle_punishment_ends_at = 0,
           battle_opponent_id = '',
           battle_opponent_name = '',
           battle_opponent_avatar = '',
           battle_opponent_live_id = '',
           battle_opponent_accepted = 0,
           battle_third_id = '',
           battle_third_name = '',
           battle_third_avatar = '',
           battle_third_accepted = 0,
           battle_host_score = 0,
           battle_opponent_score = 0,
           battle_third_score = 0,
           battle_ends_at = 0,
           battle_winner_id = ''
       WHERE id = ? AND status = 'active'`,
      [linkedLiveId]
    );
    await broadcastLiveState(linkedLiveId);
  }

  return res.json({ success: true });
});

apiRouter.get('/live/:id/eligible-opponents', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const liveId = req.params.id;
  const stream = await dbGet<any>(`SELECT id, host_id, status FROM live_streams WHERE id = ? AND status = 'active'`, [liveId]);
  if (!stream) return res.status(404).json({ error: 'البث غير نشط' });
  // Strictly return ONLY users who currently host an active live stream (status = 'active')
  const opponents = await getEligibleBattleOpponents(liveId, stream.host_id);
  return res.json({ opponents });
});

const handleBattleInvite = async (req: AuthenticatedRequest, res: Response) => {
  const liveId = req.params.id;
  const stream = await dbGet<any>(`SELECT * FROM live_streams WHERE id = ? AND status = 'active'`, [liveId]);
  if (!stream) return res.status(404).json({ error: 'البث غير نشط أو انتهى.' });

  const perms = await getRolePermission(req.user!.role);
  if (stream.host_id !== req.user!.id && !perms?.can_manage_live) {
    return res.status(403).json({ error: 'فقط مضيف البث يمكنه إرسال دعوة جولة التحدي.' });
  }

  if (stream.battle_status === 'Active' || stream.battle_status === 'Ending') {
    return res.status(400).json({ error: 'توجد جولة تحدي نشطة بالفعل في هذا البث.' });
  }
  if (stream.battle_status === 'Waiting' && stream.battle_invite_expires_at > Date.now()) {
    return res.status(400).json({ error: 'توجد دعوة تحدي معلقة بالفعل بانتظار رد المنافس.' });
  }

  const {
    mode = 'Classic',
    opponentId,
    thirdId,
    durationSeconds = 300
  } = req.body;

  if (!opponentId || opponentId === 'opponent' || opponentId === 'third') {
    return res.status(400).json({ error: 'يجب اختيار مضيف لديه بث مباشر نشط لإرسال دعوة التحدي (PK Battle).' });
  }

  if (opponentId === stream.host_id) {
    return res.status(400).json({ error: 'لا يمكنك دعوة نفسك لجولة التحدي.' });
  }

  const opponentUser = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ? AND is_banned = 0', [opponentId]);
  if (!opponentUser) {
    return res.status(404).json({ error: 'المستخدم المختار غير موجود أو محظور.' });
  }

  if (!isUserOnline(opponentUser.id)) {
    return res.status(400).json({ error: 'المضيف المنافس غير متصل حالياً.' });
  }

  // CRITICAL: Verify opponent currently has an ACTIVE live stream (`status = 'active'`).
  // Regular viewers/listeners in the room CANNOT be targeted for PK Battles.
  const opponentStream = await getActiveLiveStreamForHost(opponentUser.id, liveId);
  if (!opponentStream || opponentStream.status !== 'active') {
    return res.status(400).json({
      error:
        'لا يمكن بدء جولة تحدي (PK Battle) إلا مع مضيف لديه بث مباشر نشط حالياً (status = active)! المشاهدون داخل البث يمكنهم الانضمام كضيوف في المقاعد فقط.'
    });
  }

  if (opponentStream.battle_status === 'Active' || opponentStream.battle_status === 'Ending') {
    return res.status(400).json({ error: 'المضيف المنافس يخوض جولة تحدي أخرى حالياً.' });
  }
  if (opponentStream.battle_status === 'Waiting' && Number(opponentStream.battle_invite_expires_at) > Date.now()) {
    return res.status(400).json({ error: 'المضيف المنافس لديه دعوة تحدي معلقة حالياً.' });
  }

  const validModes = ['Classic', 'Box', 'Bear', 'Triple'];
  const safeMode = validModes.includes(mode) ? mode : 'Classic';
  const safeDuration = Math.max(30, Math.min(600, Number(durationSeconds) || 300));

  let thirdUser: AuthUser | undefined;
  if (safeMode === 'Triple') {
    if (!thirdId || thirdId === 'third' || thirdId === 'opponent') {
      return res.status(400).json({ error: 'في الجولة الثلاثية يجب اختيار مضيف ثالث لديه بث مباشر نشط.' });
    }
    if (thirdId === stream.host_id || thirdId === opponentUser.id) {
      return res.status(400).json({ error: 'يجب أن يكون المنافس الثالث مضيفاً مختلفاً.' });
    }
    thirdUser = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ? AND is_banned = 0', [thirdId]);
    if (!thirdUser) {
      return res.status(404).json({ error: 'المنافس الثالث غير موجود.' });
    }
    if (!isUserOnline(thirdUser.id)) {
      return res.status(400).json({ error: `المضيف الثالث (${thirdUser.display_name}) غير متصل حالياً.` });
    }
    const thirdStream = await getActiveLiveStreamForHost(thirdUser.id, liveId);
    if (!thirdStream || thirdStream.status !== 'active') {
      return res.status(400).json({
        error: `المستخدم (${thirdUser.display_name}) ليس لديه بث مباشر نشط حالياً (status = active) لخوض جولة PK.`
      });
    }
    if (thirdStream.battle_status === 'Active' || thirdStream.battle_status === 'Ending') {
      return res.status(400).json({ error: `المضيف الثالث (${thirdUser.display_name}) يخوض جولة تحدي أخرى حالياً.` });
    }
  }

  const now = Date.now();
  const inviteExpiresAt = now + 45 * 1000;
  const hostUser = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);

  await dbRun(
    `UPDATE live_streams
     SET battle_status = 'Waiting',
         battle_mode = ?,
         battle_duration = ?,
         battle_invite_expires_at = ?,
         battle_opponent_id = ?,
         battle_opponent_name = ?,
         battle_opponent_avatar = ?,
         battle_opponent_live_id = ?,
         battle_opponent_accepted = 0,
         battle_host_score = 0,
         battle_opponent_score = 0,
         battle_third_id = ?,
         battle_third_name = ?,
         battle_third_avatar = ?,
         battle_third_accepted = 0,
         battle_third_score = 0,
         battle_ends_at = 0,
         battle_punishment_ends_at = 0,
         battle_winner_id = ''
     WHERE id = ?`,
    [
      safeMode,
      safeDuration,
      inviteExpiresAt,
      opponentUser.id,
      opponentUser.display_name,
      opponentUser.avatar_url || '',
      opponentStream.id,
      thirdUser ? thirdUser.id : '',
      thirdUser ? thirdUser.display_name : '',
      thirdUser ? thirdUser.avatar_url || '' : '',
      liveId
    ]
  );

  const invitePayload = {
    liveId,
    liveTitle: stream.title,
    hostId: stream.host_id,
    hostName: hostUser?.display_name || req.user!.display_name,
    hostAvatar: hostUser?.avatar_url || '',
    mode: safeMode,
    durationSeconds: safeDuration,
    expiresAt: inviteExpiresAt
  };

  emitToUser(opponentUser.id, 'live:battle:invited', invitePayload);
  if (thirdUser) {
    emitToUser(thirdUser.id, 'live:battle:invited', invitePayload);
  }

  getIo()?.to(`live:${liveId}`).emit('live:chat_event', {
    id: crypto.randomUUID(),
    userId: req.user!.id,
    displayName: req.user!.display_name,
    avatarUrl: req.user!.avatar_url,
    level: req.user!.level,
    role: req.user!.role,
    gender: req.user!.gender,
    type: 'system',
    content: `⚔️ أرسل المضيف دعوة تحدي (${safeMode}) إلى ${opponentUser.display_name}${
      thirdUser ? ` و ${thirdUser.display_name}` : ''
    } — بانتظار القبول لبدء الجولة!`,
    createdAt: now
  });

  await broadcastLiveState(liveId);
  return res.json({
    success: true,
    status: 'Waiting',
    message: `تم إرسال دعوة التحدي إلى ${opponentUser.display_name} بنجاح. ستبدأ الجولة فور قبوله للدعوة.`
  });
};

apiRouter.post('/live/:id/battle/invite', requireAuth, handleBattleInvite);
apiRouter.post('/live/:id/battle/start', requireAuth, handleBattleInvite);

apiRouter.post('/live/:id/battle/respond', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const liveId = req.params.id;
  const user = req.user!;
  const { action } = req.body as { action: 'accept' | 'decline' };

  const stream = await dbGet<any>(`SELECT * FROM live_streams WHERE id = ? AND status = 'active'`, [liveId]);
  if (!stream) return res.status(404).json({ error: 'البث المباشر غير نشط أو انتهى.' });

  if (stream.battle_status !== 'Waiting') {
    return res.status(400).json({ error: 'لا توجد دعوة تحدي معلقة حالياً أو أن المهلة قد انتهت.' });
  }

  const now = Date.now();
  if (stream.battle_invite_expires_at > 0 && stream.battle_invite_expires_at <= now) {
    await dbRun(`UPDATE live_streams SET battle_status = 'Idle', battle_invite_expires_at = 0 WHERE id = ?`, [liveId]);
    await broadcastLiveState(liveId);
    return res.status(400).json({ error: 'انتهت صلاحية دعوة التحدي.' });
  }

  const isSecondOpponent = stream.battle_opponent_id === user.id;
  const isThirdOpponent = stream.battle_mode === 'Triple' && stream.battle_third_id === user.id;

  if (!isSecondOpponent && !isThirdOpponent) {
    return res.status(403).json({ error: 'أنت لست الطرف المدعو في هذه الجولة.' });
  }

  if (action === 'decline') {
    await dbRun(
      `UPDATE live_streams
       SET battle_status = 'Idle',
           battle_invite_expires_at = 0,
           battle_opponent_id = '',
           battle_opponent_name = '',
           battle_opponent_avatar = '',
           battle_opponent_accepted = 0,
           battle_third_id = '',
           battle_third_name = '',
           battle_third_avatar = '',
           battle_third_accepted = 0
       WHERE id = ?`,
      [liveId]
    );

    emitToUser(stream.host_id, 'live:battle:declined', {
      liveId,
      declinedByName: user.display_name
    });

    getIo()?.to(`live:${liveId}`).emit('live:chat_event', {
      id: crypto.randomUUID(),
      userId: user.id,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      level: user.level,
      role: user.role,
      gender: user.gender,
      type: 'system',
      content: `❌ اعتذر ${user.display_name} عن قبول دعوة جولة التحدي.`,
      createdAt: now
    });

    await broadcastLiveState(liveId);
    return res.json({ success: true, status: 'Idle', message: 'تم رفض دعوة التحدي.' });
  }

  // Action === 'accept'
  // Verify the accepting user still has an active live stream (`status = 'active'`)
  const opponentStream = await getActiveLiveStreamForHost(user.id, liveId);
  if (!opponentStream || opponentStream.status !== 'active') {
    return res.status(400).json({
      error: 'يجب أن يكون لديك بث مباشر نشط حالياً (status = active) لقبول جولة التحدي (PK Battle).'
    });
  }

  // Also ensure the main opponent (and third opponent in Triple mode) still have active live streams
  const mainOpponentStream = await getActiveLiveStreamForHost(stream.battle_opponent_id, liveId);
  if (!mainOpponentStream) {
    await dbRun(`UPDATE live_streams SET battle_status = 'Idle', battle_invite_expires_at = 0 WHERE id = ?`, [liveId]);
    await broadcastLiveState(liveId);
    return res.status(400).json({ error: 'المضيف المنافس أنهى بثه المباشر قبل بدء الجولة.' });
  }

  if (stream.battle_mode === 'Triple' && stream.battle_third_id) {
    const thirdOpponentStream = await getActiveLiveStreamForHost(stream.battle_third_id, liveId);
    if (!thirdOpponentStream) {
      await dbRun(`UPDATE live_streams SET battle_status = 'Idle', battle_invite_expires_at = 0 WHERE id = ?`, [liveId]);
      await broadcastLiveState(liveId);
      return res.status(400).json({ error: 'المضيف الثالث أنهى بثه المباشر قبل بدء الجولة.' });
    }
  }

  const nextOpponentAccepted = isSecondOpponent ? 1 : Number(stream.battle_opponent_accepted) || 0;
  const nextThirdAccepted = isThirdOpponent ? 1 : Number(stream.battle_third_accepted) || 0;
  const hostUser = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [stream.host_id]);

  const allAccepted =
    stream.battle_mode === 'Triple'
      ? nextOpponentAccepted === 1 && nextThirdAccepted === 1
      : nextOpponentAccepted === 1;

  if (!allAccepted) {
    await dbRun(
      `UPDATE live_streams
       SET battle_opponent_accepted = ?,
           battle_third_accepted = ?
       WHERE id = ?`,
      [nextOpponentAccepted, nextThirdAccepted, liveId]
    );
    getIo()?.to(`live:${liveId}`).emit('live:chat_event', {
      id: crypto.randomUUID(),
      userId: user.id,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
      level: user.level,
      role: user.role,
      gender: user.gender,
      type: 'system',
      content: `✅ قبل ${user.display_name} دعوة التحدي — بانتظار قبول الطرف الثالث...`,
      createdAt: now
    });
    await broadcastLiveState(liveId);
    return res.json({ success: true, status: 'Waiting', message: 'تم تسجيل قبولك، بانتظار الطرف الثالث.' });
  }

  const nextRound = (Number(stream.battle_round) || 0) + 1;
  const durationSec = Math.max(30, Number(stream.battle_duration) || 300);
  const endsAt = now + durationSec * 1000;

  await dbRun(
    `UPDATE live_streams
     SET battle_status = 'Active',
         battle_round = ?,
         battle_started_at = ?,
         battle_ends_at = ?,
         battle_punishment_ends_at = 0,
         battle_invite_expires_at = 0,
         battle_opponent_live_id = ?,
         battle_opponent_accepted = ?,
         battle_third_accepted = ?,
         battle_host_score = 0,
         battle_opponent_score = 0,
         battle_third_score = 0,
         battle_winner_id = ''
     WHERE id = ?`,
    [nextRound, now, endsAt, opponentStream.id, nextOpponentAccepted, nextThirdAccepted, liveId]
  );

  // Also synchronize the Opponent Host's active live stream so both streams show the 50/50 PK Split Screen!
  if (isSecondOpponent && opponentStream) {
    await dbRun(
      `UPDATE live_streams
       SET battle_status = 'Active',
           battle_mode = ?,
           battle_round = ?,
           battle_duration = ?,
           battle_started_at = ?,
           battle_ends_at = ?,
           battle_punishment_ends_at = 0,
           battle_invite_expires_at = 0,
           battle_opponent_id = ?,
           battle_opponent_name = ?,
           battle_opponent_avatar = ?,
           battle_opponent_live_id = ?,
           battle_opponent_accepted = 1,
           battle_host_score = 0,
           battle_opponent_score = 0,
           battle_third_score = 0,
           battle_winner_id = ''
       WHERE id = ?`,
      [
        stream.battle_mode,
        nextRound,
        durationSec,
        now,
        endsAt,
        stream.host_id,
        hostUser?.display_name || 'المضيف',
        hostUser?.avatar_url || '',
        liveId,
        opponentStream.id
      ]
    );
  }

  const startSystemMsg = {
    id: crypto.randomUUID(),
    userId: user.id,
    displayName: user.display_name,
    avatarUrl: user.avatar_url,
    level: user.level,
    role: user.role,
    gender: user.gender,
    type: 'system',
    content: `🔥 قبل المضيف ${user.display_name} تحدي PK! انطلقت الجولة رقم ${nextRound} (${stream.battle_mode}) الآن بشاشة مقسومة 50/50!`,
    createdAt: now
  };

  getIo()?.to(`live:${liveId}`).emit('live:chat_event', startSystemMsg);
  if (opponentStream) {
    getIo()?.to(`live:${opponentStream.id}`).emit('live:chat_event', startSystemMsg);
  }

  await broadcastLiveState(liveId);
  if (opponentStream) {
    await broadcastLiveState(opponentStream.id);
    await bridgePkWebRTCSessions(liveId, opponentStream.id);
  }

  return res.json({
    success: true,
    status: 'Active',
    round: nextRound,
    opponentLiveId: opponentStream.id,
    message: `بدأت جولة PK رقم ${nextRound} الآن!`
  });
});

apiRouter.post('/live/:id/battle/next-round', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const liveId = req.params.id;
  const stream = await dbGet<any>(`SELECT * FROM live_streams WHERE id = ? AND status = 'active'`, [liveId]);
  if (!stream) return res.status(404).json({ error: 'البث غير موجود أو غير نشط.' });

  const perms = await getRolePermission(req.user!.role);
  if (stream.host_id !== req.user!.id && !perms?.can_manage_live) {
    return res.status(403).json({ error: 'فقط المضيف يمكنه بدء الجولة التالية.' });
  }

  if (stream.battle_status !== 'Finished') {
    return res.status(400).json({ error: 'لا يمكن بدء جولة تالية إلا بعد انتهاء الجولة الحالية.' });
  }

  if (!stream.battle_opponent_id || !isUserOnline(stream.battle_opponent_id)) {
    return res.status(400).json({ error: 'المنافس لم يعد متصلاً حالياً. يرجى إنهاء الجولة أو دعوة منافس متصل.' });
  }

  const activeOpponentStream = await getActiveLiveStreamForHost(stream.battle_opponent_id, liveId);
  if (!activeOpponentStream || activeOpponentStream.status !== 'active') {
    return res.status(400).json({
      error: 'المضيف المنافس لم يعد لديه بث مباشر نشط حالياً (status = active). لا يمكن بدء جولة جديدة.'
    });
  }

  if (stream.battle_mode === 'Triple') {
    if (!stream.battle_third_id || !isUserOnline(stream.battle_third_id)) {
      return res.status(400).json({ error: 'المنافس الثالث لم يعد متصلاً حالياً.' });
    }
    const activeThirdStream = await getActiveLiveStreamForHost(stream.battle_third_id, liveId);
    if (!activeThirdStream || activeThirdStream.status !== 'active') {
      return res.status(400).json({
        error: 'المضيف الثالث لم يعد لديه بث مباشر نشط حالياً (status = active).'
      });
    }
  }

  const now = Date.now();
  const nextRound = (Number(stream.battle_round) || 1) + 1;
  const durationSec = Math.max(30, Number(stream.battle_duration) || 300);
  const endsAt = now + durationSec * 1000;

  await dbRun(
    `UPDATE live_streams
     SET battle_status = 'Active',
         battle_round = ?,
         battle_started_at = ?,
         battle_ends_at = ?,
         battle_punishment_ends_at = 0,
         battle_host_score = 0,
         battle_opponent_score = 0,
         battle_third_score = 0,
         battle_winner_id = ''
     WHERE id = ?`,
    [nextRound, now, endsAt, liveId]
  );

  if (stream.battle_opponent_live_id) {
    await dbRun(
      `UPDATE live_streams
       SET battle_status = 'Active',
           battle_round = ?,
           battle_started_at = ?,
           battle_ends_at = ?,
           battle_punishment_ends_at = 0,
           battle_host_score = 0,
           battle_opponent_score = 0,
           battle_third_score = 0,
           battle_winner_id = ''
       WHERE id = ?`,
      [nextRound, now, endsAt, stream.battle_opponent_live_id]
    );
  }

  const nextRoundMsg = {
    id: crypto.randomUUID(),
    userId: req.user!.id,
    displayName: req.user!.display_name,
    avatarUrl: req.user!.avatar_url,
    level: req.user!.level,
    role: req.user!.role,
    gender: req.user!.gender,
    type: 'system',
    content: `🔥 انطلقت الجولة رقم ${nextRound} (${stream.battle_mode}) بين ${req.user!.display_name} و ${stream.battle_opponent_name}!`,
    createdAt: now
  };

  getIo()?.to(`live:${liveId}`).emit('live:chat_event', nextRoundMsg);
  await broadcastLiveState(liveId);
  if (stream.battle_opponent_live_id) {
    getIo()?.to(`live:${stream.battle_opponent_live_id}`).emit('live:chat_event', nextRoundMsg);
    await broadcastLiveState(stream.battle_opponent_live_id);
  }

  return res.json({
    success: true,
    round: nextRound,
    message: `بدأت الجولة رقم ${nextRound}!`
  });
});

apiRouter.post('/live/:id/battle/reset', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const liveId = req.params.id;
  const stream = await dbGet<any>('SELECT * FROM live_streams WHERE id = ?', [liveId]);
  if (!stream) return res.status(404).json({ error: 'البث غير موجود' });

  const perms = await getRolePermission(req.user!.role);
  if (stream.host_id !== req.user!.id && !perms?.can_manage_live) {
    return res.status(403).json({ error: 'غير مصرح لك بإعادة ضبط الجولة.' });
  }

  const linkedLiveId = stream.battle_opponent_live_id;

  const resetSql = `
    UPDATE live_streams
    SET battle_status = 'Idle',
        battle_invite_expires_at = 0,
        battle_punishment_ends_at = 0,
        battle_opponent_id = '',
        battle_opponent_name = '',
        battle_opponent_avatar = '',
        battle_opponent_live_id = '',
        battle_opponent_accepted = 0,
        battle_third_id = '',
        battle_third_name = '',
        battle_third_avatar = '',
        battle_third_accepted = 0,
        battle_host_score = 0,
        battle_opponent_score = 0,
        battle_third_score = 0,
        battle_ends_at = 0,
        battle_winner_id = ''
    WHERE id = ?
  `;
  await dbRun(resetSql, [liveId]);
  await broadcastLiveState(liveId);

  if (linkedLiveId) {
    await dbRun(resetSql, [linkedLiveId]);
    await broadcastLiveState(linkedLiveId);
  }

  return res.json({ success: true });
});

// ==================================================
// 11. RANKINGS & LEADERBOARDS
// ==================================================

apiRouter.get('/rankings', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  const topXp = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, xp, active_frame, active_badge
     FROM users ORDER BY xp DESC, level DESC LIMIT 15`
  );

  const topSupporters = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, total_support_power, active_frame, active_badge
     FROM users ORDER BY total_support_power DESC, xp DESC LIMIT 15`
  );

  const richestGold = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, gold, gems, active_frame
     FROM users ORDER BY gold DESC, gems DESC LIMIT 15`
  );

  const mostActive = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, public_msg_count, xp, active_frame
     FROM users ORDER BY public_msg_count DESC, xp DESC LIMIT 15`
  );

  const topCreators = await dbAll<any>(
    `SELECT u.id, u.username, u.display_name, u.avatar_url, u.gender, u.level, u.active_frame,
            COALESCE(SUM(r.views_count + r.likes_count * 3), 0) as creator_score
     FROM users u
     LEFT JOIN reels r ON r.user_id = u.id
     GROUP BY u.id
     ORDER BY creator_score DESC, u.xp DESC
     LIMIT 15`
  );

  // Top 3 Staff & Top 3 Members for the Chat Room Right Sidebar Podiums
  const topStaff = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, xp, active_frame
     FROM users
     WHERE role IN ('Owner', 'Super Admin', 'Admin', 'Moderator', 'Room Moderator')
     ORDER BY xp DESC, total_support_power DESC
     LIMIT 3`
  );

  const topMembers = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, xp, total_support_power, active_frame
     FROM users
     WHERE role IN ('VIP', 'Member', 'Guest')
     ORDER BY xp DESC, total_support_power DESC
     LIMIT 3`
  );

  return res.json({
    topXp,
    topSupporters,
    richestGold,
    mostActive,
    topCreators,
    topStaff,
    topMembers
  });
});

// ==================================================
// 12. REPORTS & MODERATION
// ==================================================

apiRouter.post('/reports', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { targetType, targetId, reason, details = '' } = req.body;
  if (!targetType || !targetId || !reason?.trim()) {
    return res.status(400).json({ error: 'يرجى تحديد سبب البلاغ.' });
  }

  await dbRun(
    `INSERT INTO reports (id, reporter_id, target_type, target_id, reason, details, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      crypto.randomUUID(),
      req.user!.id,
      String(targetType),
      String(targetId),
      String(reason).slice(0, 120),
      String(details).slice(0, 400),
      Date.now()
    ]
  );

  return res.json({ success: true, message: 'تم إرسال بلاغك إلى الإدارة للمراجعة الفورية.' });
});

apiRouter.get('/notifications', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const notifs = await dbAll<any>(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 30',
    [req.user!.id]
  );
  await dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user!.id]);
  return res.json({ notifications: notifs });
});

// ==================================================
// 13. FULL ADMIN PANEL ENDPOINTS (SERVER-SIDE RBAC)
// ==================================================


// كلمات محظورة

// ==================================================
// NEWS / إعلانات الإدارة
// ==================================================
async function requireAdminRank(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  const perms = await getRolePermission(req.user!.role);
  const rank = perms?.rank_order || 0;
  // أدمن فما فوق (Admin=80, Super Admin=90, Owner=100)
  if (rank < 80 && req.user!.role !== 'Owner') {
    res.status(403).json({ error: 'نشر الأخبار متاح لرتبة أدمن فما فوق.' });
    return false;
  }
  return true;
}

apiRouter.get('/news', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rows = await dbAll<any>(
      `SELECT * FROM news_posts ORDER BY is_pinned DESC, created_at DESC LIMIT 50`
    );
    return res.json({ news: rows || [] });
  } catch {
    return res.json({ news: [] });
  }
});

apiRouter.post('/news', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdminRank(req, res))) return;
  const { title = '', body = '', mediaUrl = '', mediaType = 'text', audioUrl = '', isPinned = false } = req.body || {};
  const cleanTitle = String(title).trim().slice(0, 120);
  const cleanBody = String(body).trim().slice(0, 4000);
  if (!cleanTitle && !cleanBody && !mediaUrl && !audioUrl) {
    return res.status(400).json({ error: 'أضف عنوانًا أو نصًا أو وسائط.' });
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await dbRun(
    `INSERT INTO news_posts (id, title, body, media_url, media_type, audio_url, author_id, author_name, is_pinned, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      cleanTitle || 'خبر',
      cleanBody,
      String(mediaUrl || ''),
      String(mediaType || 'text').slice(0, 20),
      String(audioUrl || ''),
      req.user!.id,
      req.user!.display_name || req.user!.username,
      isPinned ? 1 : 0,
      now
    ]
  );
  const row = await dbGet('SELECT * FROM news_posts WHERE id = ?', [id]);
  // إشعار لكل المتصلين
  try {
    getIo()?.emit('news:new', {
      id,
      title: cleanTitle || 'خبر جديد',
      body: cleanBody.slice(0, 120),
      authorName: req.user!.display_name
    });
  } catch {}
  return res.json({ news: row });
});

apiRouter.delete('/news/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!(await requireAdminRank(req, res))) return;
  await dbRun('DELETE FROM news_posts WHERE id = ?', [req.params.id]);
  return res.json({ success: true });
});

apiRouter.get('/admin/banned-words', requireAuth, requirePermission('can_access_admin'), async (_req, res) => {
  try {
    const rows = await dbAll<any>('SELECT * FROM banned_words ORDER BY created_at DESC LIMIT 200');
    return res.json({ words: rows || [] });
  } catch {
    return res.json({ words: [] });
  }
});

apiRouter.post('/admin/banned-words', requireAuth, requirePermission('can_access_admin'), async (req: AuthenticatedRequest, res: Response) => {
  const word = String(req.body?.word || '').trim().toLowerCase();
  if (word.length < 2) return res.status(400).json({ error: 'الكلمة قصيرة جدًا' });
  const muteMins = Math.max(1, Math.min(1440, Number(req.body?.autoMuteMinutes) || 2));
  await dbRun(
    `INSERT INTO banned_words (id, word, added_by, added_by_name, auto_mute_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (word) DO UPDATE SET auto_mute_minutes = EXCLUDED.auto_mute_minutes`,
    [crypto.randomUUID(), word, req.user!.id, req.user!.display_name || '', muteMins, Date.now()]
  );
  return res.json({ success: true });
});

apiRouter.delete('/admin/banned-words/:id', requireAuth, requirePermission('can_access_admin'), async (req: AuthenticatedRequest, res: Response) => {
  await dbRun('DELETE FROM banned_words WHERE id = ?', [req.params.id]);
  return res.json({ success: true });
});

apiRouter.get('/admin/overview', requireAuth, requirePermission('can_access_admin'), async (_req: AuthenticatedRequest, res: Response) => {
  const totalUsers = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM users'))?.c || 0;
  const totalRooms = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM rooms'))?.c || 0;
  const totalMessages = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM room_messages'))?.c || 0;
  const totalPrivateMessages = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM private_messages'))?.c || 0;
  const totalReels = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM reels'))?.c || 0;
  const totalStories = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM stories WHERE expires_at > ?', [Date.now()]))?.c || 0;
  const activeLives = (await dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM live_streams WHERE status = 'active'`))?.c || 0;
  const pendingReports = (await dbGet<{ c: number }>(`SELECT COUNT(*) as c FROM reports WHERE status = 'pending'`))?.c || 0;
  const totalGiftTx = (await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM gift_transactions'))?.c || 0;
  const totalGoldCirculating = (await dbGet<{ s: number }>('SELECT COALESCE(SUM(gold), 0) as s FROM users'))?.s || 0;
  const totalGemsCirculating = (await dbGet<{ s: number }>('SELECT COALESCE(SUM(gems), 0) as s FROM users'))?.s || 0;

  const usersRaw = await dbAll<any>(
    `SELECT id, username, display_name, avatar_url, gender, role, level, xp, gold, gems,
            is_guest, is_muted, is_banned, ban_reason, banned_until, created_at
     FROM users ORDER BY created_at DESC LIMIT 100`
  );
  const users = (usersRaw || []).map((u: any) => ({
    ...u,
    is_banned: Number(u.is_banned) === 1 ? 1 : 0,
    is_muted: Number(u.is_muted) === 1 ? 1 : 0,
    is_guest: Number(u.is_guest) === 1 ? 1 : 0
  }));

  const roles = await dbAll<any>('SELECT * FROM role_permissions ORDER BY rank_order DESC');
  const reports = await dbAll<any>(
    `SELECT r.*, u.display_name as reporter_name, u.username as reporter_username
     FROM reports r
     JOIN users u ON u.id = r.reporter_id
     ORDER BY r.created_at DESC LIMIT 60`
  );

  const settingsRows = await dbAll<{ key: string; value: string }>('SELECT * FROM platform_settings');
  const settings: Record<string, string> = {};
  for (const s of settingsRows) settings[s.key] = s.value;

  return res.json({
    stats: {
      totalUsers,
      onlineNow: getGlobalOnlineCount(),
      totalRooms,
      totalMessages,
      totalPrivateMessages,
      totalReels,
      totalStories,
      activeLives,
      pendingReports,
      totalGiftTx,
      totalGoldCirculating,
      totalGemsCirculating
    },
    users,
    roles,
    reports,
    settings
  });
});

apiRouter.post('/admin/users/action', requireAuth, requirePermission('can_manage_users'), async (req: AuthenticatedRequest, res: Response) => {
  const actor = req.user!;
  const actorPerms = (await getRolePermission(actor.role))!;
  const { targetUserId, action, roleName, goldDelta, gemsDelta, xpDelta, reason = '', durationHours = 24 } = req.body;

  const target = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [targetUserId]);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const targetPerms = await getRolePermission(target.role);
  if ((targetPerms?.rank_order || 0) >= actorPerms.rank_order && actor.role !== 'Owner') {
    return res.status(403).json({ error: 'لا يمكنك التعديل على مستخدم يملك رتبة مساوية أو أعلى من رتبتك.' });
  }

  const now = Date.now();
  if (action === 'set_role') {
    if (!actorPerms.can_manage_roles && actor.role !== 'Owner') {
      return res.status(403).json({ error: 'تغيير الرتب متاح للمالك أو السوبر أدمن فقط.' });
    }
    const newRolePerms = await getRolePermission(roleName);
    if (!newRolePerms) return res.status(400).json({ error: 'الرتبة غير صالحة' });
    if (newRolePerms.rank_order >= actorPerms.rank_order && actor.role !== 'Owner') {
      return res.status(403).json({ error: 'لا يمكنك منح رتبة أعلى أو مساوية لرتبتك.' });
    }
    await dbRun('UPDATE users SET role = ? WHERE id = ?', [roleName, target.id]);
  } else if (action === 'mute') {
    const mins = Number(req.body.durationMinutes);
    const until =
      mins > 0
        ? now + mins * 60 * 1000
        : durationHours > 0
          ? now + durationHours * 3600 * 1000
          : 0;
    await dbRun('UPDATE users SET is_muted = 1, muted_until = ? WHERE id = ?', [until, target.id]);
    try {
      emitToUser(target.id, 'auth:muted', {
        until,
        reason: reason || 'كتم من الإدارة',
        minutes: mins > 0 ? mins : durationHours * 60
      });
    } catch {}
  } else if (action === 'unmute') {
    await dbRun('UPDATE users SET is_muted = 0, muted_until = 0 WHERE id = ?', [target.id]);
  } else if (action === 'temp_ban') {
    const until = now + Math.max(1, Number(durationHours)) * 3600 * 1000;
    await dbRun('UPDATE users SET is_banned = 1, banned_until = ?, ban_reason = ? WHERE id = ?', [until, reason || 'حظر مؤقت من الإدارة', target.id]);
    emitToUser(target.id, 'auth:banned', { reason: reason || 'حظر مؤقت من الإدارة' });
  } else if (action === 'perm_ban') {
    await dbRun('UPDATE users SET is_banned = 1, banned_until = 0, ban_reason = ? WHERE id = ?', [reason || 'حظر دائم من الإدارة', target.id]);
    emitToUser(target.id, 'auth:banned', { reason: reason || 'حظر دائم من الإدارة' });
  } else if (action === 'unban') {
    await dbRun(`UPDATE users SET is_banned = 0, banned_until = 0, ban_reason = '' WHERE id = ?`, [target.id]);
    try {
      emitToUser(target.id, 'auth:unbanned', {});
    } catch {}
  } else if (action === 'economy_adjust') {
    if (!actorPerms.can_manage_economy && actor.role !== 'Owner') {
      return res.status(403).json({ error: 'لا تملك صلاحية إدارة الاقتصاد.' });
    }
    if (goldDelta) await dbRun('UPDATE users SET gold = GREATEST(0, gold + ?) WHERE id = ?', [Number(goldDelta), target.id]);
    if (gemsDelta) await dbRun('UPDATE users SET gems = GREATEST(0, gems + ?) WHERE id = ?', [Number(gemsDelta), target.id]);
    if (xpDelta) await awardUserXp(target.id, Number(xpDelta));
  }

  return res.json({ success: true });
});

apiRouter.put('/admin/roles/:roleName', requireAuth, requirePermission('can_manage_roles'), async (req: AuthenticatedRequest, res: Response) => {
  const roleName = req.params.roleName;
  if (roleName === 'Owner') {
    return res.status(400).json({ error: 'صلاحيات رتبة المالك (Owner) كاملة دائماً ولا يمكن تقليصها.' });
  }
  const {
    badgeLabel,
    canManageUsers,
    canManageRoles,
    canManageRooms,
    canModerateChat,
    canManageLive,
    canManageEconomy,
    canViewReports,
    canAccessAdmin
  } = req.body;

  await dbRun(
    `UPDATE role_permissions
     SET badge_label = COALESCE(?, badge_label),
         can_manage_users = ?,
         can_manage_roles = ?,
         can_manage_rooms = ?,
         can_moderate_chat = ?,
         can_manage_live = ?,
         can_manage_economy = ?,
         can_view_reports = ?,
         can_access_admin = ?
     WHERE role_name = ?`,
    [
      badgeLabel,
      canManageUsers ? 1 : 0,
      canManageRoles ? 1 : 0,
      canManageRooms ? 1 : 0,
      canModerateChat ? 1 : 0,
      canManageLive ? 1 : 0,
      canManageEconomy ? 1 : 0,
      canViewReports ? 1 : 0,
      canAccessAdmin ? 1 : 0,
      roleName
    ]
  );

  return res.json({ success: true });
});

apiRouter.post('/admin/reports/:id/resolve', requireAuth, requirePermission('can_view_reports'), async (req: AuthenticatedRequest, res: Response) => {
  const reportId = req.params.id;
  const { status = 'resolved', resolutionNote = '' } = req.body;
  await dbRun(
    'UPDATE reports SET status = ?, resolved_by = ?, resolution_note = ? WHERE id = ?',
    [status, req.user!.display_name, String(resolutionNote).slice(0, 300), reportId]
  );
  return res.json({ success: true });
});

apiRouter.post('/admin/store/item', requireAuth, requirePermission('can_manage_economy'), async (req: AuthenticatedRequest, res: Response) => {
  const { name, description, itemType, currency, price, cssValue, minLevel = 1 } = req.body;
  if (!name || !itemType || !currency || !price || !cssValue) {
    return res.status(400).json({ error: 'بيانات العنصر غير مكتملة' });
  }
  const id = `item-${crypto.randomUUID().slice(0, 8)}`;
  await dbRun(
    `INSERT INTO store_items (id, name, description, item_type, currency, price, css_value, min_level, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, name, description || '', itemType, currency, Number(price), cssValue, Number(minLevel)]
  );
  return res.json({ success: true });
});

apiRouter.put('/admin/settings', requireAuth, requirePermission('can_access_admin'), async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'Owner' && req.user!.role !== 'Super Admin') {
    return res.status(403).json({ error: 'تعديل إعدادات النظام متاح للمالك أو السوبر أدمن فقط.' });
  }
  const updates = req.body as Record<string, string>;
  for (const [k, v] of Object.entries(updates)) {
    await dbRun('INSERT OR REPLACE INTO platform_settings (key, value) VALUES (?, ?)', [k, String(v)]);
  }
  return res.json({ success: true });
});

apiRouter.post('/admin/data-reset', requireAuth, requirePermission('can_access_admin'), async (req: AuthenticatedRequest, res: Response) => {
  if (req.user!.role !== 'Owner' && req.user!.role !== 'Super Admin' && req.user!.role !== 'Admin') {
    return res.status(403).json({ error: 'هذا الإجراء متاح للإدارة العليا فقط.' });
  }

  const { action, roomId } = req.body as {
    action: 'clear_public_messages' | 'reset_engagement_points' | 'cleanup_temp_data';
    roomId?: string;
  };

  if (action === 'clear_public_messages') {
    if (roomId) {
      await dbRun('DELETE FROM room_messages WHERE room_id = ?', [roomId]);
      getIo()?.to(`room:${roomId}`).emit('room:messages_cleared', { roomId });
    } else {
      await dbRun('DELETE FROM room_messages');
      getIo()?.emit('room:messages_cleared', { roomId: 'all' });
    }
    return res.json({
      success: true,
      message: roomId ? 'تم حذف الرسائل العامة في الغرفة المحددة بنجاح.' : 'تم حذف وتنظيف جميع الرسائل العامة في كافة الغرف بنجاح!'
    });
  }

  if (action === 'reset_engagement_points') {
    await dbRun('UPDATE users SET total_support_power = 0');
    await dbRun('UPDATE live_streams SET support_bar = 0, total_taps = 0, battle_host_score = 0, battle_opponent_score = 0, battle_third_score = 0');
    return res.json({
      success: true,
      message: 'تم تصفير نقاط التفاعل والدعم في الموقع بنجاح!'
    });
  }

  if (action === 'cleanup_temp_data') {
    const now = Date.now();
    await dbRun('DELETE FROM room_messages');
    await dbRun('DELETE FROM stories WHERE expires_at < ?', [now]);
    await dbRun('DELETE FROM sessions WHERE expires_at < ?', [now]);
    await dbRun(`DELETE FROM live_streams WHERE status = 'ended'`);
    await dbRun('DELETE FROM notifications WHERE is_read = 1 AND created_at < ?', [now - 7 * 24 * 3600 * 1000]);
    getIo()?.emit('room:messages_cleared', { roomId: 'all' });
    return res.json({
      success: true,
      message: 'تم تنظيف البيانات المؤقتة والرسائل العامة والجلسات المنتهية بنجاح!'
    });
  }

  return res.status(400).json({ error: 'إجراء غير معروف' });
});



// حذف رسالة خاصة (للمرسل أو soft delete)
apiRouter.post('/messages/:partnerId/delete/:msgId', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { partnerId, msgId } = req.params;
  const msg = await dbGet<any>('SELECT * FROM private_messages WHERE id = ?', [msgId]);
  if (!msg) return res.status(404).json({ error: 'الرسالة غير موجودة' });
  if (msg.sender_id !== userId && msg.receiver_id !== userId) {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  // soft delete للجميع إن كان المرسل، وإلا نخفيها من جهة الطالب فقط عبر cleared ليس مثالياً — soft delete عام
  if (msg.sender_id === userId) {
    await dbRun('UPDATE private_messages SET is_deleted = 1, content = ? WHERE id = ?', ['تم حذف هذه الرسالة', msgId]);
  } else {
    await dbRun('UPDATE private_messages SET is_deleted = 1, content = ? WHERE id = ?', ['تم حذف هذه الرسالة', msgId]);
  }
  try {
    const { emitToUser } = await import('./api.js');
  } catch {}
  // بث عبر socket إن أمكن
  return res.json({ success: true, msgId });
});

/** تفريغ المحادثة لدي فقط */
apiRouter.post('/messages/:partnerId/clear', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;
  const now = Date.now();
  await dbRun(
    `INSERT INTO conversation_hides (user_id, partner_id, cleared_at, deleted_at)
     VALUES (?, ?, ?, 0)
     ON CONFLICT (user_id, partner_id) DO UPDATE SET cleared_at = EXCLUDED.cleared_at, deleted_at = 0`,
    [userId, partnerId, now]
  );
  return res.json({ success: true, clearedAt: now });
});

/** إخفاء المحادثة من قائمتي */
apiRouter.post('/messages/:partnerId/hide', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;
  const now = Date.now();
  await dbRun(
    `INSERT INTO conversation_hides (user_id, partner_id, cleared_at, deleted_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (user_id, partner_id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
    [userId, partnerId, now, now]
  );
  return res.json({ success: true });
});

// ==================================================

apiRouter.get('/games', requireAuth, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const rooms = await dbAll<any>(
      `SELECT gr.*, u.display_name as host_name,
              (SELECT COUNT(*) FROM game_players gp WHERE gp.game_id = gr.id) as player_count
       FROM game_rooms gr
       JOIN users u ON u.id = gr.host_id
       WHERE gr.status != 'finished'
       ORDER BY gr.created_at DESC
       LIMIT 50`
    );
    return res.json({ rooms: rooms || [] });
  } catch (e: any) {
    return res.json({ rooms: [] });
  }
});

apiRouter.post('/games', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const { name = 'غرفة رسم', totalRounds = 3, maxPlayers = 8 } = req.body || {};
  const id = crypto.randomUUID();
  const now = Date.now();
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  await dbRun(
    `INSERT INTO game_rooms (id, name, host_id, status, max_players, current_round, total_rounds, word, drawer_id, round_ends_at, is_private, room_code, created_at)
     VALUES (?, ?, ?, 'waiting', ?, 0, ?, '', '', 0, 0, ?, ?)`,
    [id, String(name).slice(0, 40), userId, Math.min(12, Number(maxPlayers) || 8), Math.min(10, Number(totalRounds) || 3), code, now]
  );
  await dbRun(
    `INSERT INTO game_players (game_id, user_id, score, is_spectator, joined_at) VALUES (?, ?, 0, 0, ?)`,
    [id, userId, now]
  );
  const room = await dbGet('SELECT * FROM game_rooms WHERE id = ?', [id]);
  return res.json({ room });
});

apiRouter.post('/games/:gameId/join', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const gameId = req.params.gameId;
  const spectator = Boolean(req.body?.spectator);
  const room = await dbGet<any>('SELECT * FROM game_rooms WHERE id = ?', [gameId]);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  const count = await dbGet<{ c: number }>('SELECT COUNT(*) as c FROM game_players WHERE game_id = ?', [gameId]);
  if (!spectator && (count?.c || 0) >= room.max_players) {
    return res.status(400).json({ error: 'الغرفة ممتلئة' });
  }
  await dbRun(
    `INSERT INTO game_players (game_id, user_id, score, is_spectator, joined_at)
     VALUES (?, ?, 0, ?, ?)
     ON CONFLICT (game_id, user_id) DO UPDATE SET is_spectator = EXCLUDED.is_spectator`,
    [gameId, userId, spectator ? 1 : 0, Date.now()]
  );
  const players = await dbAll<any>(
    `SELECT gp.*, u.display_name, u.avatar_url, u.username
     FROM game_players gp JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ?`,
    [gameId]
  );
  return res.json({ room, players });
});

apiRouter.post('/games/:gameId/start-round', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const gameId = req.params.gameId;
  const { word = '' } = req.body || {};
  const room = await dbGet<any>('SELECT * FROM game_rooms WHERE id = ?', [gameId]);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  if (room.host_id !== userId) return res.status(403).json({ error: 'فقط المضيف يبدأ الجولة' });
  const nextRound = (room.current_round || 0) + 1;
  const endsAt = Date.now() + 90_000;
  await dbRun(
    `UPDATE game_rooms SET status = 'playing', current_round = ?, word = ?, drawer_id = ?, round_ends_at = ? WHERE id = ?`,
    [nextRound, String(word).slice(0, 30), userId, endsAt, gameId]
  );
  const updated = await dbGet('SELECT * FROM game_rooms WHERE id = ?', [gameId]);
  return res.json({ room: updated });
});


// بحث في محادثة خاصة
apiRouter.get('/messages/:partnerId/search', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 1) return res.json({ messages: [] });
  const rows = await dbAll<any>(
    `SELECT pm.*, u.display_name as sender_name
     FROM private_messages pm
     JOIN users u ON u.id = pm.sender_id
     WHERE ((pm.sender_id = ? AND pm.receiver_id = ?) OR (pm.sender_id = ? AND pm.receiver_id = ?))
       AND pm.content ILIKE ?
       AND COALESCE(pm.is_deleted, 0) = 0
     ORDER BY pm.created_at DESC LIMIT 40`,
    [userId, partnerId, partnerId, userId, `%${q}%`]
  );
  return res.json({ messages: rows || [] });
});

// تثبيت محادثة
apiRouter.post('/messages/:partnerId/pin', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;
  const existing = await dbGet('SELECT 1 FROM conversation_pins WHERE user_id = ? AND partner_id = ?', [userId, partnerId]);
  if (existing) {
    await dbRun('DELETE FROM conversation_pins WHERE user_id = ? AND partner_id = ?', [userId, partnerId]);
    return res.json({ pinned: false });
  }
  await dbRun(
    `INSERT INTO conversation_pins (user_id, partner_id, pinned_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id, partner_id) DO UPDATE SET pinned_at = EXCLUDED.pinned_at`,
    [userId, partnerId, Date.now()]
  );
  return res.json({ pinned: true });
});

// كتم إشعارات محادثة
apiRouter.post('/messages/:partnerId/mute-chat', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.id;
  const partnerId = req.params.partnerId;
  const existing = await dbGet('SELECT 1 FROM conversation_mutes WHERE user_id = ? AND partner_id = ?', [userId, partnerId]);
  if (existing) {
    await dbRun('DELETE FROM conversation_mutes WHERE user_id = ? AND partner_id = ?', [userId, partnerId]);
    return res.json({ muted: false });
  }
  await dbRun(
    `INSERT INTO conversation_mutes (user_id, partner_id, muted_at) VALUES (?, ?, ?)
     ON CONFLICT (user_id, partner_id) DO UPDATE SET muted_at = EXCLUDED.muted_at`,
    [userId, partnerId, Date.now()]
  );
  return res.json({ muted: true });
});

// وضع الغرفة الهادئة + مؤقت المقعد
apiRouter.post('/rooms/:id/chat-settings', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const roomId = req.params.id;
  const user = req.user!;
  const room = await dbGet<any>('SELECT * FROM rooms WHERE id = ?', [roomId]);
  if (!room) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  const perms = await getRolePermission(user.role);
  if (room.owner_id !== user.id && !perms?.can_manage_rooms && user.role !== 'Owner') {
    return res.status(403).json({ error: 'غير مسموح' });
  }
  const { quietMode, seatTalkSeconds, welcomeMessage } = req.body || {};
  if (quietMode !== undefined) {
    await dbRun('UPDATE rooms SET quiet_mode = ? WHERE id = ?', [quietMode ? 1 : 0, roomId]);
  }
  if (seatTalkSeconds !== undefined) {
    await dbRun('UPDATE rooms SET seat_talk_seconds = ? WHERE id = ?', [Math.max(0, Math.min(600, Number(seatTalkSeconds) || 0)), roomId]);
  }
  if (welcomeMessage !== undefined) {
    await dbRun('UPDATE rooms SET welcome_message = ? WHERE id = ?', [String(welcomeMessage).slice(0, 200), roomId]);
  }
  const updated = await dbGet('SELECT id, quiet_mode, seat_talk_seconds, welcome_message FROM rooms WHERE id = ?', [roomId]);
  return res.json({ room: updated });
});

