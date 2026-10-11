import { and, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  users,
  sessions,
  reels,
  follows,
  privateMessages,
  wallPosts,
  stories,
  cloudMediaFiles
} from './schema.ts';

export async function upsertUserInPostgres(payload: {
  id: string;
  uid?: string;
  username: string;
  display_name: string;
  email?: string;
  avatar_url?: string;
  banner_url?: string;
  bio?: string;
  country?: string;
  age?: number;
  gender?: string;
  role?: string;
  xp?: number;
  level?: number;
  gold?: number;
  gems?: number;
  created_at: number;
}) {
  try {
    const values = {
      id: payload.id,
      uid: payload.uid || payload.id,
      username: payload.username,
      displayName: payload.display_name,
      email: payload.email || '',
      avatarUrl: payload.avatar_url || '',
      bannerUrl: payload.banner_url || '',
      bio: payload.bio || '',
      country: payload.country || 'السعودية',
      age: Number(payload.age) || 22,
      gender: payload.gender || 'male',
      role: payload.role || 'Member',
      xp: Number(payload.xp) || 0,
      level: Number(payload.level) || 1,
      gold: Number(payload.gold) || 0,
      gems: Number(payload.gems) || 0,
      createdAt: Number(payload.created_at) || Date.now()
    };

    const result = await db
      .insert(users)
      .values(values)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          displayName: values.displayName,
          avatarUrl: values.avatarUrl,
          bannerUrl: values.bannerUrl,
          bio: values.bio,
          country: values.country,
          age: values.age,
          gender: values.gender,
          role: values.role,
          xp: values.xp,
          level: values.level,
          gold: values.gold,
          gems: values.gems
        }
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database query failed (upsertUserInPostgres):', error);
    throw new Error('Failed to persist user in PostgreSQL database.', { cause: error });
  }
}

export async function upsertSessionInPostgres(payload: {
  token: string;
  userId: string;
  expiresAt: number;
  createdAt: number;
}) {
  try {
    await db
      .insert(sessions)
      .values({
        token: payload.token,
        userId: payload.userId,
        expiresAt: payload.expiresAt,
        createdAt: payload.createdAt
      })
      .onConflictDoUpdate({
        target: sessions.token,
        set: {
          expiresAt: payload.expiresAt
        }
      });
  } catch (error) {
    console.error('Database query failed (upsertSessionInPostgres):', error);
    throw new Error('Failed to persist session in PostgreSQL database.', { cause: error });
  }
}

export async function removeSessionFromPostgres(token: string) {
  try {
    await db.delete(sessions).where(eq(sessions.token, token));
  } catch (error) {
    console.error('Database query failed (removeSessionFromPostgres):', error);
    throw new Error('Failed to delete session from PostgreSQL database.', { cause: error });
  }
}

export async function upsertReelInPostgres(payload: {
  id: string;
  user_id: string;
  video_url: string;
  title: string;
  description?: string;
  likes_count?: number;
  comments_count?: number;
  views_count?: number;
  created_at: number;
}) {
  try {
    await db
      .insert(reels)
      .values({
        id: payload.id,
        userId: payload.user_id,
        videoUrl: payload.video_url,
        title: payload.title,
        description: payload.description || '',
        likesCount: Number(payload.likes_count) || 0,
        commentsCount: Number(payload.comments_count) || 0,
        viewsCount: Number(payload.views_count) || 0,
        createdAt: Number(payload.created_at) || Date.now()
      })
      .onConflictDoUpdate({
        target: reels.id,
        set: {
          title: payload.title,
          description: payload.description || '',
          likesCount: Number(payload.likes_count) || 0,
          commentsCount: Number(payload.comments_count) || 0,
          viewsCount: Number(payload.views_count) || 0
        }
      });
  } catch (error) {
    console.error('Database query failed (upsertReelInPostgres):', error);
    throw new Error('Failed to persist reel in PostgreSQL database.', { cause: error });
  }
}

export async function removeReelFromPostgres(reelId: string) {
  try {
    await db.delete(reels).where(eq(reels.id, reelId));
  } catch (error) {
    console.error('Database query failed (removeReelFromPostgres):', error);
    throw new Error('Failed to delete reel from PostgreSQL database.', { cause: error });
  }
}

export async function upsertFollowInPostgres(
  _docId: string,
  payload: {
    follower_id: string;
    following_id: string;
    created_at: number;
  }
) {
  try {
    await db
      .insert(follows)
      .values({
        followerId: payload.follower_id,
        followingId: payload.following_id,
        createdAt: Number(payload.created_at) || Date.now()
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error('Database query failed (upsertFollowInPostgres):', error);
    throw new Error('Failed to persist follow in PostgreSQL database.', { cause: error });
  }
}

export async function removeFollowFromPostgres(docId: string) {
  try {
    const [followerId, followingId] = docId.split('_');
    if (followerId && followingId) {
      await db
        .delete(follows)
        .where(and(eq(follows.followerId, followerId), eq(follows.followingId, followingId)));
    }
  } catch (error) {
    console.error('Database query failed (removeFollowFromPostgres):', error);
    throw new Error('Failed to delete follow from PostgreSQL database.', { cause: error });
  }
}

export async function upsertPrivateMessageInPostgres(payload: {
  id: string;
  sender_id: string;
  receiver_id: string;
  content?: string;
  media_url?: string;
  media_type?: string;
  is_read?: number;
  created_at: number;
}) {
  try {
    await db
      .insert(privateMessages)
      .values({
        id: payload.id,
        senderId: payload.sender_id,
        receiverId: payload.receiver_id,
        content: payload.content || '',
        mediaUrl: payload.media_url || '',
        mediaType: payload.media_type || 'text',
        isRead: Number(payload.is_read) || 0,
        createdAt: Number(payload.created_at) || Date.now()
      })
      .onConflictDoUpdate({
        target: privateMessages.id,
        set: {
          isRead: Number(payload.is_read) || 0
        }
      });
  } catch (error) {
    console.error('Database query failed (upsertPrivateMessageInPostgres):', error);
    throw new Error('Failed to persist private message in PostgreSQL database.', { cause: error });
  }
}

export async function upsertWallPostInPostgres(payload: {
  id: string;
  user_id: string;
  content?: string;
  media_url?: string;
  likes_count?: number;
  comments_count?: number;
  created_at: number;
}) {
  try {
    await db
      .insert(wallPosts)
      .values({
        id: payload.id,
        userId: payload.user_id,
        content: payload.content || '',
        mediaUrl: payload.media_url || '',
        likesCount: Number(payload.likes_count) || 0,
        commentsCount: Number(payload.comments_count) || 0,
        createdAt: Number(payload.created_at) || Date.now()
      })
      .onConflictDoUpdate({
        target: wallPosts.id,
        set: {
          likesCount: Number(payload.likes_count) || 0,
          commentsCount: Number(payload.comments_count) || 0
        }
      });
  } catch (error) {
    console.error('Database query failed (upsertWallPostInPostgres):', error);
    throw new Error('Failed to persist wall post in PostgreSQL database.', { cause: error });
  }
}

export async function upsertStoryInPostgres(payload: {
  id: string;
  user_id: string;
  media_url?: string;
  media_type?: string;
  caption?: string;
  bg_style?: string;
  expires_at: number;
  created_at: number;
}) {
  try {
    await db
      .insert(stories)
      .values({
        id: payload.id,
        userId: payload.user_id,
        mediaUrl: payload.media_url || '',
        mediaType: payload.media_type || 'text',
        caption: payload.caption || '',
        bgStyle: payload.bg_style || '',
        expiresAt: Number(payload.expires_at),
        createdAt: Number(payload.created_at) || Date.now()
      })
      .onConflictDoNothing();
  } catch (error) {
    console.error('Database query failed (upsertStoryInPostgres):', error);
    throw new Error('Failed to persist story in PostgreSQL database.', { cause: error });
  }
}

export async function saveCloudMediaToPostgres(payload: {
  filename: string;
  mimeType: string;
  size: number;
  firebaseUrl?: string;
  dataBase64?: string;
  createdAt?: number;
}) {
  try {
    await db
      .insert(cloudMediaFiles)
      .values({
        filename: payload.filename,
        mimeType: payload.mimeType,
        size: Number(payload.size) || 0,
        firebaseUrl: payload.firebaseUrl || '',
        dataBase64: payload.dataBase64 || '',
        createdAt: Number(payload.createdAt) || Date.now()
      })
      .onConflictDoUpdate({
        target: cloudMediaFiles.filename,
        set: {
          mimeType: payload.mimeType,
          size: Number(payload.size) || 0,
          firebaseUrl: payload.firebaseUrl || '',
          dataBase64: payload.dataBase64 || ''
        }
      });
  } catch (error) {
    console.error('Database query failed (saveCloudMediaToPostgres):', error);
    throw new Error('Failed to save cloud media file to PostgreSQL.', { cause: error });
  }
}

export async function getCloudMediaFromPostgres(filename: string) {
  try {
    const rows = await db.select().from(cloudMediaFiles).where(eq(cloudMediaFiles.filename, filename));
    return rows[0] || null;
  } catch (error) {
    console.error('Database query failed (getCloudMediaFromPostgres):', error);
    throw new Error('Failed to load cloud media file from PostgreSQL.', { cause: error });
  }
}
