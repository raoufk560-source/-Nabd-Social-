import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { dbGet, dbRun } from '../db/index.js';

export interface AuthUser {
  id: string;
  username: string;
  display_name: string;
  is_guest: number;
  profile_completed: number;
  avatar_url: string;
  banner_url: string;
  bio: string;
  country: string;
  age: number;
  gender: string;
  role: string;
  xp: number;
  level: number;
  gold: number;
  gems: number;
  total_support_power: number;
  public_msg_count: number;
  name_color: string;
  font_color: string;
  active_frame: string;
  active_badge: string;
  active_effect: string;
  status_text: string;
  is_muted: number;
  muted_until: number;
  is_banned: number;
  banned_until: number;
  ban_reason: string;
  last_xp_tick: number;
  last_daily_claim: number;
  daily_xp_converted: number;
  daily_xp_reset_day: string;
  allow_follow_requests?: number;
  pm_privacy?: string;
  call_privacy?: string;
  hide_online_status?: number;
  created_at: number;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionToken?: string;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derivedKey}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  if (keyBuffer.length !== derivedKey.length) return false;
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

export async function createSession(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const now = Date.now();
  const expiresAt = now + 1000 * 60 * 60 * 24 * 30; // 30 days persistent session
  await dbRun(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
    [token, userId, expiresAt, now]
  );
  return token;
}

export async function getUserBySessionToken(token?: string): Promise<AuthUser | undefined> {
  if (!token) return undefined;
  const now = Date.now();
  const session = await dbGet<{ token: string; user_id: string; expires_at: number }>(
    'SELECT token, user_id, expires_at FROM sessions WHERE token = ?',
    [token]
  );
  if (!session) return undefined;
  if (Number(session.expires_at) < now) {
    await dbRun('DELETE FROM sessions WHERE token = ?', [token]);
    return undefined;
  }

  const user = await dbGet<AuthUser>(
    `SELECT id, username, display_name, is_guest, profile_completed, avatar_url, banner_url,
            bio, country, age, gender, role, xp, level, gold, gems, total_support_power,
            public_msg_count, name_color, font_color, active_frame, active_badge, active_effect,
            status_text, is_muted, muted_until, is_banned, banned_until, ban_reason,
            last_xp_tick, last_daily_claim, daily_xp_converted, daily_xp_reset_day,
            allow_follow_requests, pm_privacy, call_privacy, hide_online_status, created_at
     FROM users WHERE id = ?`,
    [session.user_id]
  );

  if (!user) return undefined;

  // Auto-unban if temporary ban has expired
  if (user.is_banned && Number(user.banned_until) > 0 && Number(user.banned_until) < now) {
    await dbRun("UPDATE users SET is_banned = 0, banned_until = 0, ban_reason = '' WHERE id = ?", [user.id]);
    user.is_banned = 0;
    user.banned_until = 0;
    user.ban_reason = '';
  }

  // Auto-unmute if temporary mute has expired
  if (user.is_muted && Number(user.muted_until) > 0 && Number(user.muted_until) < now) {
    await dbRun('UPDATE users SET is_muted = 0, muted_until = 0 WHERE id = ?', [user.id]);
    user.is_muted = 0;
    user.muted_until = 0;
  }

  return user;
}

export function extractTokenFromReq(req: Request): string | undefined {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }
  const cookieToken = req.cookies?.nabd_session;
  if (cookieToken) return cookieToken;
  return undefined;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const token = extractTokenFromReq(req);
    const user = await getUserBySessionToken(token);
    if (!user) {
      return res.status(401).json({ error: 'يجب تسجيل الدخول للوصول إلى هذه الميزة' });
    }
    if (user.is_banned) {
      return res.status(403).json({
        error: `حسابك محظور حالياً. السبب: ${user.ban_reason || 'مخالفة قوانين المنصة'}`,
        isBanned: true
      });
    }
    req.user = user;
    req.sessionToken = token;
    next();
  } catch (err) {
    console.error('[Auth] Error verifying session:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من الجلسة' });
  }
}

export async function getRolePermission(roleName: string) {
  return await dbGet<{
    role_name: string;
    rank_order: number;
    badge_label: string;
    badge_color: string;
    can_manage_users: number;
    can_manage_roles: number;
    can_manage_rooms: number;
    can_moderate_chat: number;
    can_manage_live: number;
    can_manage_economy: number;
    can_view_reports: number;
    can_access_admin: number;
  }>('SELECT * FROM role_permissions WHERE role_name = ?', [roleName]);
}

export function requirePermission(permissionField: string) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'غير مصرح لك' });
      }
      const perms = await getRolePermission(req.user.role);
      if (!perms || !(perms as any)[permissionField]) {
        return res.status(403).json({ error: 'لا تملك الصلاحيات الكافية لتنفيذ هذا الإجراء' });
      }
      next();
    } catch (err) {
      console.error('[Permission] Error checking role permissions:', err);
      return res.status(500).json({ error: 'حدث خطأ أثناء التحقق من الصلاحيات' });
    }
  };
}


/** تسجيل بصمة الدخول (IP + جهاز) لكشف الحسابات المتعددة — لصاحب الموقع فقط */
export async function recordLoginFingerprint(
  userId: string,
  ip: string,
  deviceId: string,
  userAgent: string
): Promise<void> {
  try {
    const now = Date.now();
    const cleanIp = String(ip || '').replace('::ffff:', '').slice(0, 64);
    const cleanDevice = String(deviceId || '').slice(0, 120);
    const cleanUa = String(userAgent || '').slice(0, 300);
    if (!userId) return;
    // حتى لو IP فارغ، خزّن device_id
    if (!cleanIp && !cleanDevice) return;

    try {
      await dbRun(
        `UPDATE users SET last_ip = CASE WHEN ? <> '' THEN ? ELSE last_ip END,
                            last_device_id = CASE WHEN ? <> '' THEN ? ELSE last_device_id END
         WHERE id = ?`,
        [cleanIp, cleanIp, cleanDevice, cleanDevice, userId]
      );
    } catch {
      // columns may not exist yet on first boot race
    }

    const existing = await dbGet<{ id: string }>(
      `SELECT id FROM login_fingerprints
       WHERE user_id = ? AND ip_address = ? AND device_id = ?
       LIMIT 1`,
      [userId, cleanIp || '', cleanDevice || '']
    );
    if (existing?.id) {
      await dbRun(`UPDATE login_fingerprints SET last_seen = ?, user_agent = ? WHERE id = ?`, [
        now,
        cleanUa,
        existing.id
      ]);
      return;
    }
    const id = crypto.randomUUID();
    await dbRun(
      `INSERT INTO login_fingerprints (id, user_id, ip_address, device_id, user_agent, last_seen, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, userId, cleanIp || '', cleanDevice || '', cleanUa, now, now]
    );
  } catch (e) {
    console.warn('[fingerprint]', e);
  }
}

export function extractClientIp(req: { headers?: any; ip?: string; socket?: any }): string {
  const xf = req.headers?.['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  if (Array.isArray(xf) && xf[0]) return String(xf[0]).split(',')[0].trim();
  return String(req.ip || req.socket?.remoteAddress || '').replace('::ffff:', '');
}
