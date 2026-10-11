import { dbGet, dbRun } from '../db/index.js';

interface RoomAccessUser {
  id: string;
  role: string;
}

/**
 * هل يحق للمستخدم دخول الغرفة؟
 * - الغرف العامة: متاحة للجميع.
 * - الغرف الخاصة: لمالك الغرفة، أو Owner المنصة، أو من أدخل كلمة السر الصحيحة سابقاً.
 */
export async function canAccessRoom(roomId: string, user: RoomAccessUser): Promise<boolean> {
  if (!roomId || typeof roomId !== 'string') return false;
  const room = await dbGet<{ id: string; is_private: number; owner_id: string | null }>(
    'SELECT id, is_private, owner_id FROM rooms WHERE id = ?',
    [roomId]
  );
  if (!room) return false;
  if (!room.is_private) return true;
  if (room.owner_id === user.id || user.role === 'Owner') return true;
  const grant = await dbGet<{ ok: number }>(
    'SELECT 1 AS ok FROM room_access WHERE room_id = ? AND user_id = ?',
    [roomId, user.id]
  );
  return Boolean(grant);
}

/** تسجيل أن المستخدم أدخل كلمة سر الغرفة الخاصة بنجاح. */
export async function grantRoomAccess(roomId: string, userId: string): Promise<void> {
  await dbRun(
    'INSERT OR IGNORE INTO room_access (room_id, user_id, granted_at) VALUES (?, ?, ?)',
    [roomId, userId, Date.now()]
  );
}
