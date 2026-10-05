import pg from 'pg';
import { getPool } from '../drizzle/index.ts';

let initialized = false;

/**
 * Normalizes parameterized SQL queries with `?` placeholders into PostgreSQL `$1, $2...` syntax,
 * and translates legacy SQLite `INSERT OR IGNORE` / `INSERT OR REPLACE` idioms into PostgreSQL `ON CONFLICT`.
 */
function normalizeSqlForPostgres(rawSql: string): string {
  let sql = rawSql.trim();

  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/gi, 'INSERT INTO');
    sql = sql.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
  } else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+platform_settings/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
    sql = sql.replace(/;?\s*$/, ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value');
  } else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+story_views/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
    sql = sql.replace(
      /;?\s*$/,
      ' ON CONFLICT (story_id, viewer_id) DO UPDATE SET liked = EXCLUDED.liked, created_at = EXCLUDED.created_at'
    );
  } else if (/INSERT\s+OR\s+REPLACE\s+INTO\s+uploaded_files/i.test(sql)) {
    sql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/gi, 'INSERT INTO');
    sql = sql.replace(
      /;?\s*$/,
      ' ON CONFLICT (filename) DO UPDATE SET mime_type = EXCLUDED.mime_type, data_base64 = EXCLUDED.data_base64, created_at = EXCLUDED.created_at'
    );
  }

  let paramIndex = 0;
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      result += ch;
    } else if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      result += ch;
    } else if (ch === '?' && !inSingleQuote && !inDoubleQuote) {
      paramIndex += 1;
      result += `$${paramIndex}`;
    } else {
      result += ch;
    }
  }

  return result;
}

export async function dbAll<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const pool = getPool();
  const pgSql = normalizeSqlForPostgres(sql);
  const res = await pool.query(pgSql, params);
  return res.rows as T[];
}

export async function dbGet<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  const rows = await dbAll<T>(sql, params);
  return rows[0];
}

export async function dbRun(sql: string, params: any[] = []): Promise<pg.QueryResult> {
  const pool = getPool();
  const pgSql = normalizeSqlForPostgres(sql);
  return await pool.query(pgSql, params);
}

export async function initDatabase(): Promise<pg.Pool> {
  const pool = getPool();

  if (initialized) {
    return pool;
  }

  try {
    await pool.query('SELECT 1');
  } catch (err: any) {
    console.error(
      '[Database Error] فشل الاتصال بقاعدة بيانات PostgreSQL (DATABASE_URL). تأكد من صحة رابط الاتصال:',
      err?.message || err
    );
    throw new Error(`PostgreSQL connection failed: ${err?.message || 'Unknown error'}`);
  }

  try {
    await createSchema(pool);
  } catch (err: any) {
    // When running against managed Cloud SQL where DDL is handled by Drizzle migrations, ignore schema DDL permission errors
    if (err?.code !== '42501') {
      console.warn('[PostgreSQL] Schema DDL notice:', err?.message || err);
    }
  }
  await seedSystemCatalogs();

  // ترحيل تلقائي: مسارات صور قديمة (/src/assets/...) لا تعمل بعد النشر
  try {
    await pool.query(
      "UPDATE rooms SET banner_url = REPLACE(banner_url, '/src/assets/images/', '/images/') WHERE banner_url LIKE '/src/assets/images/%'"
    );
  } catch (err: any) {
    console.warn('[PostgreSQL] Banner path migration skipped:', err?.message || err);
  }
  initialized = true;
  console.log('[PostgreSQL] Connected and verified schema successfully via DATABASE_URL.');
  return pool;
}

export function getDb(): pg.Pool {
  return getPool();
}

async function createSchema(pool: pg.Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      uid TEXT NOT NULL DEFAULT '',
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      is_guest INTEGER NOT NULL DEFAULT 0,
      profile_completed INTEGER NOT NULL DEFAULT 0,
      avatar_url TEXT NOT NULL DEFAULT '',
      banner_url TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT 'السعودية',
      age INTEGER NOT NULL DEFAULT 22,
      gender TEXT NOT NULL DEFAULT 'male',
      role TEXT NOT NULL DEFAULT 'Member',
      xp INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      gold INTEGER NOT NULL DEFAULT 50,
      gems INTEGER NOT NULL DEFAULT 0,
      total_support_power INTEGER NOT NULL DEFAULT 0,
      public_msg_count INTEGER NOT NULL DEFAULT 0,
      name_color TEXT NOT NULL DEFAULT '',
      font_color TEXT NOT NULL DEFAULT '',
      active_frame TEXT NOT NULL DEFAULT '',
      active_badge TEXT NOT NULL DEFAULT '',
      active_effect TEXT NOT NULL DEFAULT '',
      status_text TEXT NOT NULL DEFAULT 'متصل الآن',
      is_muted INTEGER NOT NULL DEFAULT 0,
      muted_until BIGINT NOT NULL DEFAULT 0,
      is_banned INTEGER NOT NULL DEFAULT 0,
      banned_until BIGINT NOT NULL DEFAULT 0,
      ban_reason TEXT NOT NULL DEFAULT '',
      last_xp_tick BIGINT NOT NULL DEFAULT 0,
      last_daily_claim BIGINT NOT NULL DEFAULT 0,
      daily_xp_converted INTEGER NOT NULL DEFAULT 0,
      daily_xp_reset_day TEXT NOT NULL DEFAULT '',
      allow_follow_requests INTEGER NOT NULL DEFAULT 1,
      pm_privacy TEXT NOT NULL DEFAULT 'everyone',
      call_privacy TEXT NOT NULL DEFAULT 'everyone',
      hide_online_status INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'public',
      is_private INTEGER NOT NULL DEFAULT 0,
      room_code TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL DEFAULT '',
      banner_url TEXT NOT NULL DEFAULT '',
      avatar_url TEXT NOT NULL DEFAULT '',
      owner_id TEXT,
      is_locked INTEGER NOT NULL DEFAULT 0,
      slow_mode_seconds INTEGER NOT NULL DEFAULT 0,
      max_seats INTEGER NOT NULL DEFAULT 4,
      welcome_message TEXT NOT NULL DEFAULT 'أهلاً وسهلاً بكم في الغرفة، نرجو الالتزام بالاحترام المتبادل.',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_messages (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS room_access (
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      granted_at BIGINT NOT NULL,
      PRIMARY KEY (room_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS room_moderation (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      expires_at BIGINT NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      moderator_id TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      UNIQUE(requester_id, addressee_id)
    );

    CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      following_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (follower_id, following_id)
    );

    CREATE TABLE IF NOT EXISTS ignored_users (
      user_id TEXT NOT NULL,
      ignored_user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, ignored_user_id)
    );

    CREATE TABLE IF NOT EXISTS private_messages (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text',
      caption TEXT NOT NULL DEFAULT '',
      bg_style TEXT NOT NULL DEFAULT 'from-indigo-900 via-slate-900 to-slate-950',
      expires_at BIGINT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS story_views (
      story_id TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
      viewer_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      liked INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (story_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS reels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      views_count INTEGER NOT NULL DEFAULT 0,
      likes_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      shares_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reel_views (
      reel_id TEXT NOT NULL,
      viewer_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (reel_id, viewer_id)
    );

    CREATE TABLE IF NOT EXISTS reel_likes (
      reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (reel_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS reel_comments (
      id TEXT PRIMARY KEY,
      reel_id TEXT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wall_posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL DEFAULT '',
      likes_count INTEGER NOT NULL DEFAULT 0,
      comments_count INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wall_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (post_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS wall_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES wall_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      item_type TEXT NOT NULL,
      currency TEXT NOT NULL,
      price INTEGER NOT NULL,
      css_value TEXT NOT NULL,
      icon_name TEXT NOT NULL DEFAULT 'Sparkles',
      min_level INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS user_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
      is_equipped INTEGER NOT NULL DEFAULT 0,
      purchased_at BIGINT NOT NULL,
      UNIQUE(user_id, item_id)
    );

    CREATE TABLE IF NOT EXISTS gifts_catalog (
      id TEXT PRIMARY KEY,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      currency TEXT NOT NULL,
      cost INTEGER NOT NULL,
      bar_power INTEGER NOT NULL,
      icon_emoji TEXT NOT NULL,
      tier TEXT NOT NULL,
      effect_class TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gift_transactions (
      id TEXT PRIMARY KEY,
      sender_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      gift_id TEXT NOT NULL REFERENCES gifts_catalog(id) ON DELETE CASCADE,
      context_type TEXT NOT NULL,
      context_id TEXT NOT NULL,
      currency TEXT NOT NULL,
      cost INTEGER NOT NULL,
      bar_power INTEGER NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS live_streams (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      topic TEXT NOT NULL DEFAULT 'سوالف وصوتيات',
      status TEXT NOT NULL DEFAULT 'active',
      support_bar INTEGER NOT NULL DEFAULT 0,
      total_taps INTEGER NOT NULL DEFAULT 0,
      max_seats INTEGER NOT NULL DEFAULT 4,
      open_stage INTEGER NOT NULL DEFAULT 1,
      battle_status TEXT NOT NULL DEFAULT 'Idle',
      battle_mode TEXT NOT NULL DEFAULT 'Classic',
      battle_round INTEGER NOT NULL DEFAULT 0,
      battle_started_at BIGINT NOT NULL DEFAULT 0,
      battle_duration INTEGER NOT NULL DEFAULT 120,
      battle_invite_expires_at BIGINT NOT NULL DEFAULT 0,
      battle_opponent_id TEXT NOT NULL DEFAULT '',
      battle_opponent_name TEXT NOT NULL DEFAULT '',
      battle_opponent_avatar TEXT NOT NULL DEFAULT '',
      battle_opponent_live_id TEXT NOT NULL DEFAULT '',
      battle_opponent_accepted INTEGER NOT NULL DEFAULT 0,
      battle_host_score INTEGER NOT NULL DEFAULT 0,
      battle_opponent_score INTEGER NOT NULL DEFAULT 0,
      battle_third_id TEXT NOT NULL DEFAULT '',
      battle_third_name TEXT NOT NULL DEFAULT '',
      battle_third_avatar TEXT NOT NULL DEFAULT '',
      battle_third_accepted INTEGER NOT NULL DEFAULT 0,
      battle_third_score INTEGER NOT NULL DEFAULT 0,
      battle_ends_at BIGINT NOT NULL DEFAULT 0,
      battle_punishment_ends_at BIGINT NOT NULL DEFAULT 0,
      battle_winner_id TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL,
      ended_at BIGINT NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      notif_type TEXT NOT NULL DEFAULT 'info',
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      resolved_by TEXT NOT NULL DEFAULT '',
      resolution_note TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role_name TEXT PRIMARY KEY,
      rank_order INTEGER NOT NULL,
      badge_label TEXT NOT NULL,
      badge_color TEXT NOT NULL,
      can_manage_users INTEGER NOT NULL DEFAULT 0,
      can_manage_roles INTEGER NOT NULL DEFAULT 0,
      can_manage_rooms INTEGER NOT NULL DEFAULT 0,
      can_moderate_chat INTEGER NOT NULL DEFAULT 0,
      can_manage_live INTEGER NOT NULL DEFAULT 0,
      can_manage_economy INTEGER NOT NULL DEFAULT 0,
      can_view_reports INTEGER NOT NULL DEFAULT 0,
      can_access_admin INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS uploaded_files (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      data_base64 TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cloud_media_files (
      filename TEXT PRIMARY KEY,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      firebase_url TEXT NOT NULL DEFAULT '',
      data_base64 TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS news_posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      media_url TEXT NOT NULL DEFAULT '',
      media_type TEXT NOT NULL DEFAULT 'text',
      audio_url TEXT NOT NULL DEFAULT '',
      author_id TEXT NOT NULL DEFAULT '',
      author_name TEXT NOT NULL DEFAULT '',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS banned_words (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      added_by TEXT NOT NULL DEFAULT '',
      added_by_name TEXT NOT NULL DEFAULT '',
      auto_mute_minutes INTEGER NOT NULL DEFAULT 15,
      created_at BIGINT NOT NULL
    );
  `);

  const alterColumns = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS uid TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_completed INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS total_support_power INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS public_msg_count INTEGER NOT NULL DEFAULT 0;',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS name_color TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS font_color TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_frame TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_badge TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_effect TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS status_text TEXT NOT NULL DEFAULT 'متصل الآن';",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_muted INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS muted_until BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until BIGINT NOT NULL DEFAULT 0;',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_xp_tick BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_daily_claim BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_xp_converted INTEGER NOT NULL DEFAULT 0;',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_xp_reset_day TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_follow_requests INTEGER NOT NULL DEFAULT 1;',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pm_privacy TEXT NOT NULL DEFAULT 'everyone';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS call_privacy TEXT NOT NULL DEFAULT 'everyone';",
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_online_status INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at BIGINT NOT NULL DEFAULT 0;',
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_song_url TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_config TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE reels ADD COLUMN IF NOT EXISTS thumbnail_url TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE reels ADD COLUMN IF NOT EXISTS shares_count INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS ended_at BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_round INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_started_at BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_duration INTEGER NOT NULL DEFAULT 120;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_invite_expires_at BIGINT NOT NULL DEFAULT 0;',
    "ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_opponent_avatar TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_opponent_live_id TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_opponent_accepted INTEGER NOT NULL DEFAULT 0;',
    "ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_third_avatar TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_third_accepted INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS battle_punishment_ends_at BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS open_stage INTEGER NOT NULL DEFAULT 1;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS guest_requests_locked INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS active_multiplier INTEGER NOT NULL DEFAULT 1;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS multiplier_ends_at BIGINT NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS box_active INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS box_progress INTEGER NOT NULL DEFAULT 0;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS box_target INTEGER NOT NULL DEFAULT 500;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS box_reward_pool INTEGER NOT NULL DEFAULT 100;',
    'ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS stream_level INTEGER NOT NULL DEFAULT 1;',
    "ALTER TABLE live_streams ADD COLUMN IF NOT EXISTS round_rule TEXT NOT NULL DEFAULT '';",
    
    // ميزات الشات المتقدمة
    'ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS is_pinned INTEGER NOT NULL DEFAULT 0;',
    "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS quiet_mode INTEGER NOT NULL DEFAULT 0;",
    'ALTER TABLE rooms ADD COLUMN IF NOT EXISTS seat_talk_seconds INTEGER NOT NULL DEFAULT 0;',

    // رسائل الغرف
    "ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS is_deleted INTEGER NOT NULL DEFAULT 0;',
    "ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS mentioned_usernames TEXT NOT NULL DEFAULT '';",
    // الرسائل الخاصة
    "ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS reply_to_id TEXT NOT NULL DEFAULT '';",
    'ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS is_deleted INTEGER NOT NULL DEFAULT 0;',
    "ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS sticker_id TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS gif_url TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE private_messages ADD COLUMN IF NOT EXISTS gif_preview_url TEXT NOT NULL DEFAULT '';",
    // الإشعارات
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actor_id TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS target_id TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS data_json TEXT NOT NULL DEFAULT '{}';",
    // كتم شخصي
    "ALTER TABLE ignored_users ADD COLUMN IF NOT EXISTS mute_type TEXT NOT NULL DEFAULT 'all';"
  ];

  for (const sql of alterColumns) {
    try {
      await pool.query(sql);
    } catch {
      // ignore if already exists
    }
  }

  // جداول جديدة: حظر + ألعاب الرسم
  try {
    await pool.query(`
      
      CREATE TABLE IF NOT EXISTS message_reactions (
        message_id TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        context_type TEXT NOT NULL DEFAULT 'room',
        emoji TEXT NOT NULL,
        created_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (message_id, user_id, emoji)
      );
      CREATE TABLE IF NOT EXISTS conversation_pins (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        partner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pinned_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, partner_id)
      );
      CREATE TABLE IF NOT EXISTS conversation_mutes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        partner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        muted_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, partner_id)
      );

      CREATE TABLE IF NOT EXISTS conversation_hides (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        partner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cleared_at BIGINT NOT NULL DEFAULT 0,
        deleted_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, partner_id)
      );
      
      CREATE TABLE IF NOT EXISTS blocked_users (
        blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (blocker_id, blocked_id)
      );
      
      CREATE TABLE IF NOT EXISTS login_fingerprints (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        last_seen BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_fp_user ON login_fingerprints(user_id);
      CREATE INDEX IF NOT EXISTS idx_fp_ip ON login_fingerprints(ip_address);
      CREATE INDEX IF NOT EXISTS idx_fp_device ON login_fingerprints(device_id);
CREATE TABLE IF NOT EXISTS game_rooms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'waiting',
        max_players INTEGER NOT NULL DEFAULT 8,
        current_round INTEGER NOT NULL DEFAULT 0,
        total_rounds INTEGER NOT NULL DEFAULT 3,
        word TEXT NOT NULL DEFAULT '',
        drawer_id TEXT NOT NULL DEFAULT '',
        round_ends_at BIGINT NOT NULL DEFAULT 0,
        is_private INTEGER NOT NULL DEFAULT 0,
        room_code TEXT NOT NULL DEFAULT '',
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS game_players (
        game_id TEXT NOT NULL REFERENCES game_rooms(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score INTEGER NOT NULL DEFAULT 0,
        is_spectator INTEGER NOT NULL DEFAULT 0,
        joined_at BIGINT NOT NULL,
        PRIMARY KEY (game_id, user_id)
      );
    `);
  } catch (e: any) {
    console.warn('[Schema] new tables notice:', e?.message || e);
  }

  // Drop legacy uid unique constraint if it exists so standard users without Firebase UID do not conflict
  try {
    await pool.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_uid_unique;');
  } catch {
    // ignore
  }

  // Drop legacy follows id primary key if migrated from earlier Drizzle schema
  try {
    await pool.query('ALTER TABLE follows DROP COLUMN IF EXISTS id CASCADE;');
    await pool.query('ALTER TABLE follows ADD PRIMARY KEY (follower_id, following_id);');
  } catch {
    // ignore
  }

  const indexQueries = [
    'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);',
    'CREATE INDEX IF NOT EXISTS idx_room_msgs_room ON room_messages(room_id, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_pm_sender_rec ON private_messages(sender_id, receiver_id, created_at);',
    'CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);',
    'CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);',
    'CREATE INDEX IF NOT EXISTS idx_live_status ON live_streams(status, host_id);'
  ];
  for (const idxSql of indexQueries) {
    try {
      await pool.query(idxSql);
    } catch {
      // ignore
    }
  }

  // Enforce 4 seats maximum (1 Host + 3 Guests) on both live_streams and rooms
  try {
    await pool.query('UPDATE live_streams SET max_seats = 4 WHERE max_seats != 4;');
    await pool.query('UPDATE rooms SET max_seats = 4 WHERE max_seats > 4;');
    await pool.query(`
      UPDATE live_streams
      SET battle_status = 'Idle',
          battle_opponent_id = '',
          battle_opponent_name = '',
          battle_third_id = '',
          battle_third_name = '',
          battle_winner_id = ''
      WHERE battle_opponent_id IN ('opponent', 'third')
         OR battle_third_id IN ('opponent', 'third')
         OR battle_winner_id IN ('opponent', 'third');
    `);
  } catch {
    // ignore
  }
}


  // ضمان جدول بصمات الدخول (كشف الهوية)
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS login_fingerprints (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        ip_address TEXT NOT NULL DEFAULT '',
        device_id TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        last_seen BIGINT NOT NULL DEFAULT 0,
        created_at BIGINT NOT NULL DEFAULT 0
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fp_user ON login_fingerprints(user_id);`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fp_ip ON login_fingerprints(ip_address);`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_fp_device ON login_fingerprints(device_id);`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_ip TEXT NOT NULL DEFAULT ''`).catch(() => {});
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_device_id TEXT NOT NULL DEFAULT ''`).catch(() => {});
  } catch (e: any) {
    console.warn('[Schema] login_fingerprints:', e?.message || e);
  }

async function seedSystemCatalogs() {
  const now = Date.now();

  // Preserve migrated existing Owner user (raoufka) idempotently without duplication
  await dbRun(
    `INSERT INTO users (
      id, uid, username, display_name, password_hash, is_guest, profile_completed,
      bio, country, age, gender, role, xp, level, gold, gems, status_text,
      last_xp_tick, created_at, allow_follow_requests, pm_privacy, call_privacy, hide_online_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO NOTHING`,
    [
      '9788ab1c-ccee-428e-a41e-9b07951780f9',
      '9788ab1c-ccee-428e-a41e-9b07951780f9',
      'raoufka',
      'raoufk',
      '08b81ef7acf0b35b962fd1a66014ad37:ea36c448d66849f9905d10302d5a0f9a68d895b8ad492988fd801cd469aa01c582beb2fcfb822894cfcc61a589df3dd985040bc1e7aaa78520c2e8a5b2d428db',
      0,
      1,
      'أهلاً بكم في ملفي الشخصي على نبض المجالس ✨',
      'السعودية',
      22,
      'male',
      'Site Owner',
      116,
      2,
      5030,
      500,
      'متصل الآن',
      1790612970625,
      1790530720977,
      1,
      'everyone',
      'everyone',
      0
    ]
  );

  await dbRun(
    `INSERT INTO sessions (token, user_id, expires_at, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (token) DO NOTHING`,
    [
      '7daa1f47093f4ddb5f7c7cde44cfb75a1b7c95103744a5db4f2ccf13128d5557',
      '9788ab1c-ccee-428e-a41e-9b07951780f9',
      1793122721029,
      1790530721029
    ]
  );

  // 1. Seed Default Rooms
  const existingRooms = await dbAll('SELECT id FROM rooms LIMIT 1');
  if (existingRooms.length === 0) {
    const defaultRooms = [
      {
        id: 'room-general',
        name: 'الغرفة العامة',
        description: 'المجلس العربي العام للنقاش، التعارف، والدردشة الصوتية والكتابية لجميع الأعضاء.',
        category: 'general',
        is_private: 0,
        room_code: 'GEN-100',
        banner_url: '/images/room_banner_general_1790452755617.jpg',
        welcome_message: 'أهلاً بكم في الغرفة العامة — احترم الجميع واستمتع بوقتك معنا!'
      },
      {
        id: 'room-girls',
        name: 'غرفة البنات',
        description: 'مساحة راقية مخصصة للفتيات فقط للسوالف، الموضة، والفن والقصص اليومية.',
        category: 'female',
        is_private: 0,
        room_code: 'GRL-200',
        banner_url: '/images/room_banner_girls_1790452764290.jpg',
        welcome_message: 'مرحباً بكِ في مجلس البنات — خصوصية، أناقة، وسوالف ممتعة.'
      },
      {
        id: 'room-boys',
        name: 'غرفة الأولاد',
        description: 'مجلس الشباب للنقاشات الرياضية، التقنية، الألعاب، والتحديات الصوتية.',
        category: 'male',
        is_private: 0,
        room_code: 'BOY-300',
        banner_url: '/images/room_banner_boys_1790452774299.jpg',
        welcome_message: 'حياكم الله في غرفة الشباب — تحديات، نقاشات، ومقاعد صوتية مفتوحة.'
      }
    ];

    for (const r of defaultRooms) {
      await dbRun(
        `INSERT INTO rooms (id, name, description, category, is_private, room_code, banner_url, welcome_message, max_seats, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 4, ?)
         ON CONFLICT (id) DO NOTHING`,
        [r.id, r.name, r.description, r.category, r.is_private, r.room_code, r.banner_url, r.welcome_message, now]
      );
    }
  }

  // 2. Seed Gifts Catalog (10 Gold + 10 Gems = 20 Gifts)
  const gifts = [
    // 10 Gold Gifts
    { id: 'gift-gold-rose', name_ar: 'وردة الجوري الذهبية', name_en: 'Golden Rose', currency: 'gold', cost: 50, bar_power: 120, icon_emoji: '🌹', tier: 'standard', effect_class: 'from-rose-500/30 to-amber-600/20 border-rose-400/50' },
    { id: 'gift-gold-item', name_ar: 'سبيكة ذهب', name_en: 'Gold Item', currency: 'gold', cost: 100, bar_power: 200, icon_emoji: '🪙', tier: 'standard', effect_class: 'from-amber-500/30 to-yellow-600/20 border-amber-400/50' },
    { id: 'gift-gold-lantern', name_ar: 'فانوس المجلس الملكي', name_en: 'Royal Lantern', currency: 'gold', cost: 150, bar_power: 260, icon_emoji: '🏮', tier: 'standard', effect_class: 'from-orange-500/30 to-amber-600/20 border-orange-400/50' },
    { id: 'gift-tea-cup', name_ar: 'فنجان شاي عربي', name_en: 'Tea Cup', currency: 'gold', cost: 250, bar_power: 300, icon_emoji: '🍵', tier: 'standard', effect_class: 'from-emerald-500/30 to-teal-600/20 border-emerald-400/50' },
    { id: 'gift-gold-oud', name_ar: 'بخور وعود فاخر', name_en: 'Royal Oud', currency: 'gold', cost: 400, bar_power: 520, icon_emoji: '🪵', tier: 'medium', effect_class: 'from-amber-700/40 to-yellow-800/30 border-amber-500/50' },
    { id: 'gift-headphones', name_ar: 'سماعات استوديو', name_en: 'Headphones', currency: 'gold', cost: 500, bar_power: 600, icon_emoji: '🎧', tier: 'medium', effect_class: 'from-sky-500/30 to-blue-600/20 border-sky-400/50' },
    { id: 'gift-phone', name_ar: 'هاتف ذكي فاخر', name_en: 'Phone', currency: 'gold', cost: 1000, bar_power: 1050, icon_emoji: '📱', tier: 'medium', effect_class: 'from-indigo-500/30 to-violet-600/20 border-indigo-400/50' },
    { id: 'gift-gold-sword', name_ar: 'سيف العرب المذهب', name_en: 'Golden Sword', currency: 'gold', cost: 1500, bar_power: 2100, icon_emoji: '⚔️', tier: 'high', effect_class: 'from-yellow-500/40 to-amber-700/30 border-yellow-400/60' },
    { id: 'gift-computer', name_ar: 'حاسوب احترافي', name_en: 'Computer', currency: 'gold', cost: 2000, bar_power: 3000, icon_emoji: '💻', tier: 'high', effect_class: 'from-purple-500/40 to-fuchsia-600/20 border-purple-400/60' },
    { id: 'gift-gold-car', name_ar: 'سيارة رياضية خارقة', name_en: 'Supercar', currency: 'gold', cost: 3500, bar_power: 5500, icon_emoji: '🏎️', tier: 'high', effect_class: 'from-red-500/40 to-amber-600/30 border-red-400/60' },
    // 10 Gem Gifts
    { id: 'gift-gem-ring', name_ar: 'خاتم الألماس النادر', name_en: 'Diamond Ring', currency: 'gems', cost: 50, bar_power: 5000, icon_emoji: '💍', tier: 'epic', effect_class: 'from-cyan-400/40 to-sky-600/30 border-cyan-300/70' },
    { id: 'gift-airplane', name_ar: 'طائرة خاصة', name_en: 'Airplane', currency: 'gems', cost: 100, bar_power: 10000, icon_emoji: '✈️', tier: 'epic', effect_class: 'from-cyan-500/40 to-blue-700/30 border-cyan-300/70' },
    { id: 'gift-gem-crown', name_ar: 'تاج الملوك الماسي', name_en: 'Royal Crown', currency: 'gems', cost: 200, bar_power: 18000, icon_emoji: '👑', tier: 'epic', effect_class: 'from-amber-400/50 to-yellow-600/30 border-amber-300/80' },
    { id: 'gift-teddy-bear', name_ar: 'الدب الملكي', name_en: 'Teddy Bear', currency: 'gems', cost: 300, bar_power: 25000, icon_emoji: '🧸', tier: 'epic', effect_class: 'from-pink-500/40 to-rose-700/30 border-pink-300/70' },
    { id: 'gift-lamp', name_ar: 'المصباح السحري', name_en: 'Lamp', currency: 'gems', cost: 500, bar_power: 50000, icon_emoji: '🪔', tier: 'legendary', effect_class: 'from-amber-400/50 to-orange-700/40 border-amber-300/80' },
    { id: 'gift-gem-yacht', name_ar: 'يخت المحيط الفاخر', name_en: 'Luxury Yacht', currency: 'gems', cost: 750, bar_power: 75000, icon_emoji: '🛥️', tier: 'legendary', effect_class: 'from-blue-500/50 to-indigo-800/40 border-blue-300/80' },
    { id: 'gift-falcon', name_ar: 'الصقر الحر', name_en: 'Falcon', currency: 'gems', cost: 1000, bar_power: 100000, icon_emoji: '🦅', tier: 'legendary', effect_class: 'from-red-500/50 to-amber-700/40 border-red-300/80' },
    { id: 'gift-gem-castle', name_ar: 'القلعة الأسطورية', name_en: 'Mythic Castle', currency: 'gems', cost: 1200, bar_power: 150000, icon_emoji: '🏰', tier: 'legendary', effect_class: 'from-purple-500/50 to-indigo-900/40 border-purple-300/80' },
    { id: 'gift-lion', name_ar: 'الأسد الذهبي', name_en: 'Lion', currency: 'gems', cost: 1500, bar_power: 200000, icon_emoji: '🦁', tier: 'mythic', effect_class: 'from-yellow-400/60 via-amber-500/50 to-red-700/50 border-yellow-200' },
    { id: 'gift-gem-galaxy', name_ar: 'مجرة الكون الساحرة', name_en: 'Cosmic Galaxy', currency: 'gems', cost: 2500, bar_power: 350000, icon_emoji: '🌌', tier: 'mythic', effect_class: 'from-fuchsia-500/60 via-indigo-600/50 to-cyan-500/50 border-cyan-200' }
  ];

  for (const g of gifts) {
    await dbRun(
      `INSERT INTO gifts_catalog (id, name_ar, name_en, currency, cost, bar_power, icon_emoji, tier, effect_class)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [g.id, g.name_ar, g.name_en, g.currency, g.cost, g.bar_power, g.icon_emoji, g.tier, g.effect_class]
    );
  }

  // 3. Seed Store Items
  const existingStore = await dbAll('SELECT id FROM store_items LIMIT 1');
  if (existingStore.length === 0) {
    const items = [
      { id: 'item-color-gold', name: 'لون اسم ذهبي ملكي', description: 'يميز اسمك باللون الذهبي اللامع في جميع الغرف والدردشات.', item_type: 'name_color', currency: 'gold', price: 150, css_value: '#FBBF24', icon_name: 'Palette', min_level: 1 },
      { id: 'item-color-cyan', name: 'لون اسم سماوي متألق', description: 'لون سماوي صافي يبرز اسمك داخل الرسائل وقائمة المتصلين.', item_type: 'name_color', currency: 'gold', price: 120, css_value: '#38BDF8', icon_name: 'Palette', min_level: 1 },
      { id: 'item-color-rose', name: 'لون اسم وردي ياقوتي', description: 'إطلالة وردية أنيقة لاسم المستخدم في الغرف والبثوث.', item_type: 'name_color', currency: 'gold', price: 120, css_value: '#FB7185', icon_name: 'Palette', min_level: 1 },
      { id: 'item-frame-emerald', name: 'إطار الزمرد النقي', description: 'إطار دائري زمردي يحيط بصورتك الشخصية في الغرف والبروفايل.', item_type: 'frame', currency: 'gold', price: 300, css_value: 'ring-2 ring-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]', icon_name: 'Sparkles', min_level: 2 },
      { id: 'item-frame-royal', name: 'إطار التاج البنفسجي', description: 'إطار ملكي متوهج خاص بنخبة الأعضاء والداعمين.', item_type: 'frame', currency: 'gold', price: 600, css_value: 'ring-2 ring-purple-400 shadow-[0_0_15px_rgba(192,132,252,0.55)]', icon_name: 'Crown', min_level: 3 },
      { id: 'item-frame-mythic', name: 'إطار اللهب الأسطوري', description: 'إطار نادر جداً بالعملات الماسية يمنح حضورك هيبة خاصة.', item_type: 'frame', currency: 'gems', price: 80, css_value: 'ring-2 ring-amber-300 shadow-[0_0_18px_rgba(251,191,36,0.75)]', icon_name: 'Flame', min_level: 5 },
      { id: 'item-badge-vip', name: 'وسام VIP الماسي', description: 'يظهر بجانب اسمك في جميع غرف الدردشة والبثوث الصوتية.', item_type: 'badge', currency: 'gold', price: 500, css_value: '💎 VIP مميز', icon_name: 'Award', min_level: 2 },
      { id: 'item-badge-knight', name: 'وسام فارس المجلس', description: 'وسام شرفي للمتفاعلين في الغرف والجولات الصوتية.', item_type: 'badge', currency: 'gold', price: 350, css_value: '⚔️ فارس المجلس', icon_name: 'Shield', min_level: 2 },
      { id: 'item-badge-star', name: 'وسام نجم البثوث', description: 'وسام نادر بالماس يبرز مكانتك بين صناع المحتوى والداعمين.', item_type: 'badge', currency: 'gems', price: 120, css_value: '🌟 نجم ساطع', icon_name: 'Star', min_level: 4 },
      { id: 'item-effect-royal', name: 'تأثير دخول مهيب', description: 'يظهر إشعار ترحيبي مميز عند دخولك أي غرفة دردشة أو بث مباشر.', item_type: 'effect', currency: 'gold', price: 450, css_value: 'royal-entry', icon_name: 'Zap', min_level: 2 }
    ];

    for (const item of items) {
      await dbRun(
        `INSERT INTO store_items (id, name, description, item_type, currency, price, css_value, icon_name, min_level, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, item.name, item.description, item.item_type, item.currency, item.price, item.css_value, item.icon_name, item.min_level]
      );
    }
  }

  // 4. Seed Role Hierarchy & Permissions
  const existingRoles = await dbAll('SELECT role_name FROM role_permissions LIMIT 1');
  if (existingRoles.length === 0) {
    const roles = [
      { role_name: 'Site Owner', rank_order: 200, badge_label: '🏰 صاحب الموقع', badge_color: 'bg-gradient-to-r from-amber-500/30 to-rose-500/30 text-amber-200 border-amber-300/50', u: 1, r: 1, rm: 1, m: 1, l: 1, e: 1, rp: 1, a: 1 },
      { role_name: 'Owner', rank_order: 100, badge_label: '👑 المالك', badge_color: 'bg-amber-500/20 text-amber-300 border-amber-400/40', u: 1, r: 1, rm: 1, m: 1, l: 1, e: 1, rp: 1, a: 1 },
      { role_name: 'Super Admin', rank_order: 90, badge_label: '⚡ سوبر أدمن', badge_color: 'bg-purple-500/20 text-purple-300 border-purple-400/40', u: 1, r: 1, rm: 1, m: 1, l: 1, e: 1, rp: 1, a: 1 },
      { role_name: 'Admin', rank_order: 80, badge_label: '🛡️ أدمن', badge_color: 'bg-indigo-500/20 text-indigo-300 border-indigo-400/40', u: 1, r: 0, rm: 1, m: 1, l: 1, e: 0, rp: 1, a: 1 },
      { role_name: 'Moderator', rank_order: 70, badge_label: '⚖️ مشرف عام', badge_color: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/40', u: 0, r: 0, rm: 0, m: 1, l: 1, e: 0, rp: 1, a: 1 },
      { role_name: 'Room Moderator', rank_order: 60, badge_label: '🎙️ مشرف غرفة', badge_color: 'bg-teal-500/20 text-teal-300 border-teal-400/40', u: 0, r: 0, rm: 0, m: 1, l: 0, e: 0, rp: 0, a: 0 },
      { role_name: 'VIP', rank_order: 50, badge_label: '💎 VIP', badge_color: 'bg-rose-500/20 text-rose-300 border-rose-400/40', u: 0, r: 0, rm: 0, m: 0, l: 0, e: 0, rp: 0, a: 0 },
      { role_name: 'Member', rank_order: 20, badge_label: 'عضو', badge_color: 'bg-slate-700/40 text-slate-300 border-slate-600/40', u: 0, r: 0, rm: 0, m: 0, l: 0, e: 0, rp: 0, a: 0 },
      { role_name: 'Guest', rank_order: 10, badge_label: 'زائر', badge_color: 'bg-slate-800/60 text-slate-400 border-slate-700/40', u: 0, r: 0, rm: 0, m: 0, l: 0, e: 0, rp: 0, a: 0 }
    ];

    for (const role of roles) {
      await dbRun(
        `INSERT INTO role_permissions (
          role_name, rank_order, badge_label, badge_color,
          can_manage_users, can_manage_roles, can_manage_rooms, can_moderate_chat,
          can_manage_live, can_manage_economy, can_view_reports, can_access_admin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (role_name) DO NOTHING`,
        [role.role_name, role.rank_order, role.badge_label, role.badge_color, role.u, role.r, role.rm, role.m, role.l, role.e, role.rp, role.a]
      );
    }
  }

  // Ensure Site Owner role exists (أعلى رتبة فوق المالك)
  try {
    await dbRun(
      `INSERT INTO role_permissions (
        role_name, rank_order, badge_label, badge_color,
        can_manage_users, can_manage_roles, can_manage_rooms, can_moderate_chat,
        can_manage_live, can_manage_economy, can_view_reports, can_access_admin
      ) VALUES (?, ?, ?, ?, 1, 1, 1, 1, 1, 1, 1, 1)
      ON CONFLICT (role_name) DO UPDATE SET
        rank_order = EXCLUDED.rank_order,
        badge_label = EXCLUDED.badge_label,
        badge_color = EXCLUDED.badge_color,
        can_manage_users = 1, can_manage_roles = 1, can_manage_rooms = 1,
        can_moderate_chat = 1, can_manage_live = 1, can_manage_economy = 1,
        can_view_reports = 1, can_access_admin = 1`,
      [
        'Site Owner',
        200,
        '🏰 صاحب الموقع',
        'bg-gradient-to-r from-amber-500/30 to-rose-500/30 text-amber-200 border-amber-300/50'
      ]
    );
  } catch {
    // ignore
  }

  // Ensure Admin & Super Admin & Owner & Site Owner have full admin powers
  try {
    await dbRun(
      `UPDATE role_permissions
       SET can_manage_roles = 1, can_manage_users = 1, can_moderate_chat = 1, can_access_admin = 1
       WHERE role_name IN ('Site Owner', 'Owner', 'Super Admin', 'Admin')`
    );
  } catch {
    // ignore
  }

  // ترقية أول حساب مسجّل (غير زائر) لرتبة صاحب الموقع إن لم يوجد أحد بهذه الرتبة
  try {
    const hasSiteOwner = await dbGet<{ c: number }>(
      `SELECT COUNT(*) as c FROM users WHERE role = 'Site Owner' AND is_guest = 0`
    );
    if (!hasSiteOwner || Number(hasSiteOwner.c) === 0) {
      const firstUser = await dbGet<{ id: string }>(
        `SELECT id FROM users WHERE is_guest = 0 ORDER BY created_at ASC LIMIT 1`
      );
      if (firstUser?.id) {
        await dbRun(`UPDATE users SET role = 'Site Owner' WHERE id = ?`, [firstUser.id]);
      }
    }
  } catch {
    // ignore
  }

  // 5. Seed Platform Settings
  const existingSettings = await dbAll('SELECT key FROM platform_settings LIMIT 1');
  if (existingSettings.length === 0) {
    const defaultSettings = [
      ['platform_name', 'نبض المجالس'],
      ['announcement_banner', 'أهلاً بكم في منصة نبض المجالس — أول حساب مسجل يحصل تلقائياً على رتبة صاحب الموقع (أعلى رتبة فوق المالك)!'],
      ['xp_per_minute', '1'],
      ['messages_per_gold', '20'],
      ['daily_gold_reward', '25'],
      ['allow_guest_login', 'true'],
      ['maintenance_mode', 'false']
    ];
    for (const [k, v] of defaultSettings) {
      await dbRun('INSERT INTO platform_settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [k, v]);
    }
  }
}

export function normalizeModerationText(input: string): string {
  return String(input || '')
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // strip Arabic diacritics & tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[._\-*+#@!$%^&~|\\/،,؟?]+/g, '') // remove separator symbols used to bypass filters
    .replace(/(.)\1+/g, '$1') // collapse repeated characters (e.g. مممممنوع -> منوع)
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}

export async function checkMessageBannedWords(content: string): Promise<{
  matched: boolean;
  word?: string;
  autoMuteMinutes?: number;
}> {
  const cleanMsg = String(content || '').trim();
  if (!cleanMsg) return { matched: false };

  const bannedRows = await dbAll<{ word: string; auto_mute_minutes: number }>(
    'SELECT word, auto_mute_minutes FROM banned_words'
  );
  if (!bannedRows || bannedRows.length === 0) return { matched: false };

  const normalizedFull = normalizeModerationText(cleanMsg);
  const normalizedCompact = normalizedFull.replace(/\s+/g, '');
  const tokens = cleanMsg
    .split(/\s+/)
    .map((t) => normalizeModerationText(t))
    .filter(Boolean);

  for (const row of bannedRows) {
    const target = normalizeModerationText(row.word);
    if (!target) continue;
    const targetCompact = target.replace(/\s+/g, '');

    // 1. Direct or compact substring match
    if (normalizedFull.includes(target) || (targetCompact.length >= 3 && normalizedCompact.includes(targetCompact))) {
      return { matched: true, word: row.word, autoMuteMinutes: row.auto_mute_minutes || 15 };
    }

    // 2. Fuzzy similarity match on words (similar word written by user)
    for (const token of tokens) {
      if (token === target) {
        return { matched: true, word: row.word, autoMuteMinutes: row.auto_mute_minutes || 15 };
      }
      if (target.length >= 4 && Math.abs(token.length - target.length) <= 1) {
        const dist = levenshteinDistance(token, target);
        if (dist <= 1) {
          return { matched: true, word: row.word, autoMuteMinutes: row.auto_mute_minutes || 15 };
        }
      }
    }
  }

  return { matched: false };
}

