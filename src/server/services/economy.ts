import crypto from 'crypto';
import { dbGet, dbRun } from '../db/index.js';
import { AuthUser } from '../auth/security.js';

export function calculateLevelFromXp(xp: number): {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
} {
  const safeXp = Math.max(0, Math.floor(xp));
  let level = 1;
  let threshold = 100;
  let remaining = safeXp;

  while (remaining >= threshold) {
    remaining -= threshold;
    level += 1;
    threshold = 100 + (level - 1) * 50;
  }

  const progressPercent = Math.min(100, Math.round((remaining / threshold) * 100));
  return {
    level,
    currentLevelXp: remaining,
    nextLevelXp: threshold,
    progressPercent
  };
}

export async function awardUserXp(userId: string, amount: number): Promise<{ xp: number; level: number; leveledUp: boolean }> {
  const user = await dbGet<{ xp: number; level: number }>('SELECT xp, level FROM users WHERE id = ?', [userId]);
  if (!user) return { xp: 0, level: 1, leveledUp: false };

  const newXp = Math.max(0, Number(user.xp) + amount);
  const calc = calculateLevelFromXp(newXp);
  const leveledUp = calc.level > Number(user.level);

  await dbRun('UPDATE users SET xp = ?, level = ? WHERE id = ?', [newXp, calc.level, userId]);

  if (leveledUp) {
    const bonusGold = calc.level * 15;
    await dbRun('UPDATE users SET gold = gold + ? WHERE id = ?', [bonusGold, userId]);
    await dbRun(
      'INSERT INTO notifications (id, user_id, title, body, notif_type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        crypto.randomUUID(),
        userId,
        `ترقية إلى المستوى ${calc.level}! 🎉`,
        `مبارك! وصلت إلى المستوى ${calc.level} وحصلت على ${bonusGold} عملة ذهبية كمكافأة تقدم.`,
        'reward',
        Date.now()
      ]
    );
  }

  return { xp: newXp, level: calc.level, leveledUp };
}

export async function processMinuteHeartbeat(userId: string): Promise<{
  awarded: boolean;
  xp: number;
  level: number;
  gold: number;
  gems: number;
}> {
  const now = Date.now();
  const user = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) {
    return { awarded: false, xp: 0, level: 1, gold: 0, gems: 0 };
  }

  if (now - Number(user.last_xp_tick || 0) < 55000) {
    return {
      awarded: false,
      xp: Number(user.xp),
      level: Number(user.level),
      gold: Number(user.gold),
      gems: Number(user.gems)
    };
  }

  const setting = await dbGet<{ value: string }>('SELECT value FROM platform_settings WHERE key = ?', ['xp_per_minute']);
  const xpGain = Math.max(1, parseInt(setting?.value || '1', 10) || 1);

  await dbRun('UPDATE users SET last_xp_tick = ? WHERE id = ?', [now, userId]);
  const res = await awardUserXp(userId, xpGain);
  const updated = await dbGet<{ gold: number; gems: number }>('SELECT gold, gems FROM users WHERE id = ?', [userId]);

  return {
    awarded: true,
    xp: res.xp,
    level: res.level,
    gold: Number(updated?.gold ?? user.gold),
    gems: Number(updated?.gems ?? user.gems)
  };
}

const userMessageRateMap = new Map<string, { lastMsgAt: number; lastContent: string }>();

export async function recordPublicMessageActivity(userId: string, content: string): Promise<{
  goldAwarded: number;
  newMsgCount: number;
}> {
  const now = Date.now();
  const prev = userMessageRateMap.get(userId);
  const trimmed = content.trim();

  if (prev && (now - prev.lastMsgAt < 2500 || (prev.lastContent === trimmed && now - prev.lastMsgAt < 15000))) {
    return { goldAwarded: 0, newMsgCount: 0 };
  }

  userMessageRateMap.set(userId, { lastMsgAt: now, lastContent: trimmed });

  const user = await dbGet<{ public_msg_count: number }>('SELECT public_msg_count FROM users WHERE id = ?', [userId]);
  if (!user) return { goldAwarded: 0, newMsgCount: 0 };

  const newCount = Number(user.public_msg_count || 0) + 1;
  const setting = await dbGet<{ value: string }>('SELECT value FROM platform_settings WHERE key = ?', ['messages_per_gold']);
  const threshold = Math.max(5, parseInt(setting?.value || '20', 10) || 20);

  let goldAwarded = 0;
  if (newCount % threshold === 0) {
    goldAwarded = 1;
    await dbRun('UPDATE users SET public_msg_count = ?, gold = gold + 1 WHERE id = ?', [newCount, userId]);
    await awardUserXp(userId, 5);
  } else {
    await dbRun('UPDATE users SET public_msg_count = ? WHERE id = ?', [newCount, userId]);
    await awardUserXp(userId, 1);
  }

  return { goldAwarded, newMsgCount: newCount };
}

export async function convertXpToGold(userId: string, xpToConvert: number): Promise<{
  success: boolean;
  message: string;
  xp?: number;
  gold?: number;
  dailyRemaining?: number;
}> {
  const cleanXp = Math.floor(Number(xpToConvert));
  if (!Number.isFinite(cleanXp) || cleanXp < 20 || cleanXp % 20 !== 0) {
    return { success: false, message: 'يجب أن تكون كمية الـ XP من مضاعفات 20 (بحد أدنى 20 XP).' };
  }

  const user = await dbGet<AuthUser>('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { success: false, message: 'المستخدم غير موجود' };

  const todayStr = new Date().toISOString().slice(0, 10);
  const alreadyConvertedToday = user.daily_xp_reset_day === todayStr ? Number(user.daily_xp_converted) : 0;
  const DAILY_CAP = 200;

  if (alreadyConvertedToday + cleanXp > DAILY_CAP) {
    return {
      success: false,
      message: `لقد وصلت للحد اليومي المسموح لتحويل الـ XP (${DAILY_CAP} XP يومياً للحفاظ على توازن الاقتصاد). المتبقي لك اليوم: ${Math.max(0, DAILY_CAP - alreadyConvertedToday)} XP.`
    };
  }

  if (Number(user.xp) < cleanXp) {
    return { success: false, message: 'رصيد الـ XP لديك غير كافٍ لإتمام التحويل.' };
  }

  const goldGained = Math.floor(cleanXp / 2);
  const newXp = Number(user.xp) - cleanXp;
  const newGold = Number(user.gold) + goldGained;
  const newConverted = alreadyConvertedToday + cleanXp;
  const newLevel = calculateLevelFromXp(newXp).level;

  await dbRun(
    'UPDATE users SET xp = ?, level = ?, gold = ?, daily_xp_converted = ?, daily_xp_reset_day = ? WHERE id = ?',
    [newXp, newLevel, newGold, newConverted, todayStr, userId]
  );

  return {
    success: true,
    message: `تم تحويل ${cleanXp} XP إلى ${goldGained} عملة ذهبية بنجاح!`,
    xp: newXp,
    gold: newGold,
    dailyRemaining: DAILY_CAP - newConverted
  };
}

const contentGemRewardTracker = new Set<string>();

export async function rewardCreatorEngagementGem(creatorId: string, actorId: string, contentKey: string): Promise<boolean> {
  if (!creatorId || !actorId || creatorId === actorId) return false;
  const uniqueKey = `${creatorId}:${actorId}:${contentKey}`;
  if (contentGemRewardTracker.has(uniqueKey)) return false;
  contentGemRewardTracker.add(uniqueKey);

  await dbRun('UPDATE users SET gems = gems + 2 WHERE id = ?', [creatorId]);
  await awardUserXp(creatorId, 5);
  return true;
}
