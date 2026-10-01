import { relations } from 'drizzle-orm';
import { bigint, index, integer, pgTable, primaryKey, text, unique } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  uid: text('uid').notNull().default(''),
  username: text('username').notNull().unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull().default(''),
  email: text('email').notNull().default(''),
  isGuest: integer('is_guest').notNull().default(0),
  profileCompleted: integer('profile_completed').notNull().default(0),
  avatarUrl: text('avatar_url').notNull().default(''),
  bannerUrl: text('banner_url').notNull().default(''),
  bio: text('bio').notNull().default(''),
  country: text('country').notNull().default('السعودية'),
  age: integer('age').notNull().default(22),
  gender: text('gender').notNull().default('male'),
  role: text('role').notNull().default('Member'),
  xp: integer('xp').notNull().default(0),
  level: integer('level').notNull().default(1),
  gold: integer('gold').notNull().default(50),
  gems: integer('gems').notNull().default(0),
  totalSupportPower: integer('total_support_power').notNull().default(0),
  publicMsgCount: integer('public_msg_count').notNull().default(0),
  nameColor: text('name_color').notNull().default(''),
  fontColor: text('font_color').notNull().default(''),
  activeFrame: text('active_frame').notNull().default(''),
  activeBadge: text('active_badge').notNull().default(''),
  activeEffect: text('active_effect').notNull().default(''),
  statusText: text('status_text').notNull().default('متصل الآن'),
  isMuted: integer('is_muted').notNull().default(0),
  mutedUntil: bigint('muted_until', { mode: 'number' }).notNull().default(0),
  isBanned: integer('is_banned').notNull().default(0),
  bannedUntil: bigint('banned_until', { mode: 'number' }).notNull().default(0),
  banReason: text('ban_reason').notNull().default(''),
  lastXpTick: bigint('last_xp_tick', { mode: 'number' }).notNull().default(0),
  lastDailyClaim: bigint('last_daily_claim', { mode: 'number' }).notNull().default(0),
  dailyXpConverted: integer('daily_xp_converted').notNull().default(0),
  dailyXpResetDay: text('daily_xp_reset_day').notNull().default(''),
  allowFollowRequests: integer('allow_follow_requests').notNull().default(1),
  pmPrivacy: text('pm_privacy').notNull().default('everyone'),
  callPrivacy: text('call_privacy').notNull().default('everyone'),
  hideOnlineStatus: integer('hide_online_status').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const sessions = pgTable(
  'sessions',
  {
    token: text('token').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [index('idx_sessions_user').on(table.userId)]
);

export const rooms = pgTable('rooms', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  category: text('category').notNull().default('public'),
  isPrivate: integer('is_private').notNull().default(0),
  roomCode: text('room_code').notNull().default(''),
  passwordHash: text('password_hash').notNull().default(''),
  bannerUrl: text('banner_url').notNull().default(''),
  avatarUrl: text('avatar_url').notNull().default(''),
  ownerId: text('owner_id'),
  isLocked: integer('is_locked').notNull().default(0),
  slowModeSeconds: integer('slow_mode_seconds').notNull().default(0),
  maxSeats: integer('max_seats').notNull().default(4),
  welcomeMessage: text('welcome_message')
    .notNull()
    .default('أهلاً وسهلاً بكم في الغرفة، نرجو الالتزام بالاحترام المتبادل.'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const roomMessages = pgTable(
  'room_messages',
  {
    id: text('id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    mediaUrl: text('media_url').notNull().default(''),
    mediaType: text('media_type').notNull().default('text'),
    isSystem: integer('is_system').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [index('idx_room_msgs_room').on(table.roomId, table.createdAt)]
);

export const roomModeration = pgTable('room_moderation', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  userId: text('user_id').notNull(),
  actionType: text('action_type').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull().default(0),
  reason: text('reason').notNull().default(''),
  moderatorId: text('moderator_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const friends = pgTable(
  'friends',
  {
    id: text('id').primaryKey(),
    requesterId: text('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('pending'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [unique('uq_friends_pair').on(table.requesterId, table.addresseeId)]
);

export const follows = pgTable(
  'follows',
  {
    followerId: text('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followingId: text('following_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.followerId, table.followingId] }),
    index('idx_follows_follower').on(table.followerId),
    index('idx_follows_following').on(table.followingId)
  ]
);

export const ignoredUsers = pgTable(
  'ignored_users',
  {
    userId: text('user_id').notNull(),
    ignoredUserId: text('ignored_user_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.ignoredUserId] })]
);

export const privateMessages = pgTable(
  'private_messages',
  {
    id: text('id').primaryKey(),
    senderId: text('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    receiverId: text('receiver_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull().default(''),
    mediaUrl: text('media_url').notNull().default(''),
    mediaType: text('media_type').notNull().default('text'),
    isRead: integer('is_read').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [index('idx_pm_sender_rec').on(table.senderId, table.receiverId, table.createdAt)]
);

export const stories = pgTable('stories', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  mediaUrl: text('media_url').notNull().default(''),
  mediaType: text('media_type').notNull().default('text'),
  caption: text('caption').notNull().default(''),
  bgStyle: text('bg_style').notNull().default('from-indigo-900 via-slate-900 to-slate-950'),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const storyViews = pgTable(
  'story_views',
  {
    storyId: text('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    viewerId: text('viewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    liked: integer('liked').notNull().default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.storyId, table.viewerId] })]
);

export const reels = pgTable('reels', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  videoUrl: text('video_url').notNull(),
  thumbnailUrl: text('thumbnail_url').notNull().default(''),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  viewsCount: integer('views_count').notNull().default(0),
  likesCount: integer('likes_count').notNull().default(0),
  commentsCount: integer('comments_count').notNull().default(0),
  sharesCount: integer('shares_count').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const reelViews = pgTable(
  'reel_views',
  {
    reelId: text('reel_id').notNull(),
    viewerId: text('viewer_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.reelId, table.viewerId] })]
);

export const reelLikes = pgTable(
  'reel_likes',
  {
    reelId: text('reel_id')
      .notNull()
      .references(() => reels.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.reelId, table.userId] })]
);

export const reelComments = pgTable('reel_comments', {
  id: text('id').primaryKey(),
  reelId: text('reel_id')
    .notNull()
    .references(() => reels.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const wallPosts = pgTable('wall_posts', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull().default(''),
  mediaUrl: text('media_url').notNull().default(''),
  likesCount: integer('likes_count').notNull().default(0),
  commentsCount: integer('comments_count').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const wallLikes = pgTable(
  'wall_likes',
  {
    postId: text('post_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.postId, table.userId] })]
);

export const wallComments = pgTable('wall_comments', {
  id: text('id').primaryKey(),
  postId: text('post_id')
    .notNull()
    .references(() => wallPosts.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const storeItems = pgTable('store_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  itemType: text('item_type').notNull(),
  currency: text('currency').notNull(),
  price: integer('price').notNull(),
  cssValue: text('css_value').notNull(),
  iconName: text('icon_name').notNull().default('Sparkles'),
  minLevel: integer('min_level').notNull().default(1),
  isActive: integer('is_active').notNull().default(1)
});

export const userInventory = pgTable(
  'user_inventory',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => storeItems.id, { onDelete: 'cascade' }),
    isEquipped: integer('is_equipped').notNull().default(0),
    purchasedAt: bigint('purchased_at', { mode: 'number' }).notNull()
  },
  (table) => [unique('uq_user_item').on(table.userId, table.itemId)]
);

export const giftsCatalog = pgTable('gifts_catalog', {
  id: text('id').primaryKey(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  currency: text('currency').notNull(),
  cost: integer('cost').notNull(),
  barPower: integer('bar_power').notNull(),
  iconEmoji: text('icon_emoji').notNull(),
  tier: text('tier').notNull(),
  effectClass: text('effect_class').notNull()
});

export const giftTransactions = pgTable('gift_transactions', {
  id: text('id').primaryKey(),
  senderId: text('sender_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  receiverId: text('receiver_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  giftId: text('gift_id')
    .notNull()
    .references(() => giftsCatalog.id, { onDelete: 'cascade' }),
  contextType: text('context_type').notNull(),
  contextId: text('context_id').notNull(),
  currency: text('currency').notNull(),
  cost: integer('cost').notNull(),
  barPower: integer('bar_power').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const liveStreams = pgTable(
  'live_streams',
  {
    id: text('id').primaryKey(),
    hostId: text('host_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    topic: text('topic').notNull().default('سوالف وصوتيات'),
    status: text('status').notNull().default('active'),
    supportBar: integer('support_bar').notNull().default(0),
    totalTaps: integer('total_taps').notNull().default(0),
    maxSeats: integer('max_seats').notNull().default(4),
    openStage: integer('open_stage').notNull().default(1),
    battleStatus: text('battle_status').notNull().default('Idle'),
    battleMode: text('battle_mode').notNull().default('Classic'),
    battleRound: integer('battle_round').notNull().default(0),
    battleStartedAt: bigint('battle_started_at', { mode: 'number' }).notNull().default(0),
    battleDuration: integer('battle_duration').notNull().default(120),
    battleInviteExpiresAt: bigint('battle_invite_expires_at', { mode: 'number' }).notNull().default(0),
    battleOpponentId: text('battle_opponent_id').notNull().default(''),
    battleOpponentName: text('battle_opponent_name').notNull().default(''),
    battleOpponentAvatar: text('battle_opponent_avatar').notNull().default(''),
    battleOpponentLiveId: text('battle_opponent_live_id').notNull().default(''),
    battleOpponentAccepted: integer('battle_opponent_accepted').notNull().default(0),
    battleHostScore: integer('battle_host_score').notNull().default(0),
    battleOpponentScore: integer('battle_opponent_score').notNull().default(0),
    battleThirdId: text('battle_third_id').notNull().default(''),
    battleThirdName: text('battle_third_name').notNull().default(''),
    battleThirdAvatar: text('battle_third_avatar').notNull().default(''),
    battleThirdAccepted: integer('battle_third_accepted').notNull().default(0),
    battleThirdScore: integer('battle_third_score').notNull().default(0),
    battleEndsAt: bigint('battle_ends_at', { mode: 'number' }).notNull().default(0),
    battlePunishmentEndsAt: bigint('battle_punishment_ends_at', { mode: 'number' }).notNull().default(0),
    battleWinnerId: text('battle_winner_id').notNull().default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    endedAt: bigint('ended_at', { mode: 'number' }).notNull().default(0)
  },
  (table) => [index('idx_live_status').on(table.status, table.hostId)]
);

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  notifType: text('notif_type').notNull().default('info'),
  isRead: integer('is_read').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type').notNull(),
  targetId: text('target_id').notNull(),
  reason: text('reason').notNull(),
  details: text('details').notNull().default(''),
  status: text('status').notNull().default('pending'),
  resolvedBy: text('resolved_by').notNull().default(''),
  resolutionNote: text('resolution_note').notNull().default(''),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const rolePermissions = pgTable('role_permissions', {
  roleName: text('role_name').primaryKey(),
  rankOrder: integer('rank_order').notNull(),
  badgeLabel: text('badge_label').notNull(),
  badgeColor: text('badge_color').notNull(),
  canManageUsers: integer('can_manage_users').notNull().default(0),
  canManageRoles: integer('can_manage_roles').notNull().default(0),
  canManageRooms: integer('can_manage_rooms').notNull().default(0),
  canModerateChat: integer('can_moderate_chat').notNull().default(0),
  canManageLive: integer('can_manage_live').notNull().default(0),
  canManageEconomy: integer('can_manage_economy').notNull().default(0),
  canViewReports: integer('can_view_reports').notNull().default(0),
  canAccessAdmin: integer('can_access_admin').notNull().default(0)
});

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});

export const uploadedFiles = pgTable('uploaded_files', {
  filename: text('filename').primaryKey(),
  mimeType: text('mime_type').notNull(),
  dataBase64: text('data_base64').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const cloudMediaFiles = pgTable('cloud_media_files', {
  filename: text('filename').primaryKey(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull().default(0),
  firebaseUrl: text('firebase_url').notNull().default(''),
  dataBase64: text('data_base64').notNull().default(''),
  createdAt: bigint('created_at', { mode: 'number' }).notNull()
});

export const usersRelations = relations(users, ({ many }) => ({
  reels: many(reels),
  wallPosts: many(wallPosts),
  stories: many(stories)
}));

export const reelsRelations = relations(reels, ({ one }) => ({
  author: one(users, {
    fields: [reels.userId],
    references: [users.id]
  })
}));

export const wallPostsRelations = relations(wallPosts, ({ one }) => ({
  author: one(users, {
    fields: [wallPosts.userId],
    references: [users.id]
  })
}));

export const storiesRelations = relations(stories, ({ one }) => ({
  author: one(users, {
    fields: [stories.userId],
    references: [users.id]
  })
}));
