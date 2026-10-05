export interface LevelProgress {
  level: number;
  currentLevelXp: number;
  nextLevelXp: number;
  progressPercent: number;
}

export interface RolePermission {
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
}

export interface User {
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
  gender: 'male' | 'female';
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
  is_banned: number;
  allow_follow_requests?: number;
  pm_privacy?: string;
  call_privacy?: string;
  hide_online_status?: number;
  avatar_config?: string;
  created_at: number;
  levelProgress?: LevelProgress;
  permissions?: RolePermission;
  unreadPm?: number;
  unreadNotifs?: number;
  pendingFriendReqs?: number;
  followersCount?: number;
  followingCount?: number;
}

export interface Room {
  id: string;
  name: string;
  description: string;
  category: string;
  is_private: number;
  room_code: string;
  banner_url: string;
  avatar_url: string;
  owner_id: string | null;
  is_locked: number;
  slow_mode_seconds: number;
  max_seats: number;
  welcome_message: string;
  onlineCount: number;
}

export interface RoomMessage {
  id: string;
  room_id: string;
  user_id: string;
  content: string;
  media_url: string;
  media_type: 'text' | 'image' | 'audio' | 'video' | 'sticker' | 'gif';
  is_system: number;
  reply_to_id?: string;
  is_deleted?: number;
  mentioned_usernames?: string;
  created_at: number;
  username: string;
  display_name: string;
  avatar_url: string;
  gender: 'male' | 'female';
  role: string;
  role_label: string;
  role_color: string;
  level: number;
  name_color: string;
  font_color: string;
  active_frame: string;
  active_badge: string;
  /** هل الرسالة تذكر المستخدم الحالي (للتمييز الأزرق) */
  isMentionedForMe?: boolean;
  replyPreview?: { id: string; username: string; content: string } | null;
}

export interface PrivateMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  media_url: string;
  media_type: 'text' | 'image' | 'audio' | 'sticker' | 'gif';
  is_read: number;
  reply_to_id?: string;
  is_deleted?: number;
  sticker_id?: string;
  gif_url?: string;
  gif_preview_url?: string;
  created_at: number;
  sender_username?: string;
  sender_display_name?: string;
  sender_avatar?: string;
  replyPreview?: { id: string; content: string; sender_name: string } | null;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  notif_type: string;
  is_read: number;
  actor_id?: string;
  target_type?: string;
  target_id?: string;
  data_json?: string;
  created_at: number;
}

export interface VoiceSeat {
  seatIndex: number;
  userId: string | null;
  username: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  gender: 'male' | 'female';
  role: string;
  activeFrame: string;
  isMuted: boolean;
  isLocked: boolean;
  isSpeaking: boolean;
  isCameraOn?: boolean;
}

export interface GiftItem {
  id: string;
  name_ar: string;
  name_en: string;
  currency: 'gold' | 'gems';
  cost: number;
  bar_power: number;
  icon_emoji: string;
  tier: string;
  effect_class: string;
}

export interface GiftAnimationEvent {
  id: string;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderLevel: number;
  receiverId: string;
  receiverName: string;
  giftId: string;
  giftName: string;
  giftEmoji: string;
  currency: 'gold' | 'gems';
  cost: number;
  barPower: number;
  tier: string;
  effectClass: string;
  createdAt: number;
}

export interface StoreItem {
  id: string;
  name: string;
  description: string;
  item_type: 'name_color' | 'frame' | 'badge' | 'effect';
  currency: 'gold' | 'gems';
  price: number;
  css_value: string;
  icon_name: string;
  min_level: number;
  isOwned: boolean;
  isEquipped: boolean;
}

export interface GuestJoinRequest {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  level: number;
  gender: 'male' | 'female';
  activeFrame: string;
  withCamera: boolean;
  createdAt: number;
}

export interface BattleMvpContributor {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string;
  gender: 'male' | 'female';
  active_frame: string;
  total_power: number;
}

export interface LiveStream {
  id: string;
  host_id: string;
  host_name: string;
  host_username: string;
  host_avatar: string;
  host_level: number;
  host_gender: 'male' | 'female';
  host_frame: string;
  title: string;
  topic: string;
  status: 'active' | 'ended';
  support_bar: number;
  total_taps: number;
  max_seats: number;
  open_stage?: number;
  battle_status: 'Idle' | 'Waiting' | 'Active' | 'Ending' | 'Finished';
  battle_mode: 'Classic' | 'Box' | 'Bear' | 'Triple';
  battle_round?: number;
  battle_started_at?: number;
  battle_duration?: number;
  battle_invite_expires_at?: number;
  battle_opponent_id: string;
  battle_opponent_name: string;
  battle_opponent_avatar?: string;
  battle_opponent_live_id?: string;
  battle_opponent_accepted?: number;
  battle_host_score: number;
  battle_opponent_score: number;
  battle_third_id: string;
  battle_third_name: string;
  battle_third_avatar?: string;
  battle_third_accepted?: number;
  battle_third_score: number;
  battle_ends_at: number;
  battle_punishment_ends_at?: number;
  battle_winner_id: string;
  guest_requests_locked?: number;
  active_multiplier?: number;
  multiplier_ends_at?: number;
  box_active?: number;
  box_progress?: number;
  box_target?: number;
  box_reward_pool?: number;
  stream_level?: number;
  round_rule?: string;
  viewerCount?: number;
  seats?: VoiceSeat[];
  created_at: number;
}
