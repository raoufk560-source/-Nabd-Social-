import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  MessageCircle,
  UserPlus,
  UserMinus,
  Ban,
  Flag,
  VolumeX,
  Pencil,
  MapPin,
  Shield,
  Film,
  Image as ImageIcon,
  Users
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch, uploadMediaFile } from '../services/api';
import { AvatarWithFrame } from './AvatarWithFrame';
import type { User } from '../types';

function formatLastSeen(ts: number): string {
  if (!ts) return 'غير معروف';
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'الآن';
  if (diff < 3600_000) return `منذ ${Math.floor(diff / 60_000)} دقيقة`;
  if (diff < 86400_000) return `منذ ${Math.floor(diff / 3600_000)} ساعة`;
  if (diff < 7 * 86400_000) return `منذ ${Math.floor(diff / 86400_000)} يوم`;
  return new Date(ts).toLocaleDateString('ar-SA', { day: 'numeric', month: 'short' });
}

interface ProfilePageProps {
  targetUserId: string;
  onBack: () => void;
  onStartPrivateChat: (partnerId: string) => void;
  onOpenSendGift?: (receiverId: string, receiverName: string) => void;
  onOpenReport: (targetType: string, targetId: string) => void;
}

export const ProfilePage: React.FC<ProfilePageProps> = ({
  targetUserId,
  onBack,
  onStartPrivateChat,
  onOpenSendGift,
  onOpenReport
}) => {
  const { user, setUser, addToast } = useApp();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'posts' | 'reels' | 'about' | 'friends'>('about');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [identityResult, setIdentityResult] = useState<any>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [showIdentity, setShowIdentity] = useState(false);

  const isMe = user?.id === targetUserId;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch<{ profile: any }>(`/api/users/${targetUserId}/profile`);
      setProfile(res.profile);
      setEditName(res.profile.display_name || '');
      setEditBio(res.profile.bio || '');
      setEditCountry(res.profile.country || '');
    } catch (err: any) {
      setError(err.message || 'تعذر تحميل الملف الشخصي');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [targetUserId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await apiFetch<{ user: User }>('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: editName.trim(),
          bio: editBio.trim(),
          country: editCountry.trim()
        })
      });
      if (res.user) setUser(res.user);
      addToast('تم حفظ الملف الشخصي', 'success');
      setEditing(false);
      load();
    } catch (err: any) {
      addToast(err.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: 'avatarUrl' | 'bannerUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const uploaded = await uploadMediaFile(file);
      await apiFetch('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({ [field]: uploaded.url })
      });
      addToast('تم تحديث الصورة', 'success');
      load();
    } catch (err: any) {
      addToast(err.message || 'فشل الرفع', 'error');
    }
  };

  const handleFollow = async () => {
    try {
      const res = await apiFetch<{ isFollowing: boolean; followersCount?: number; message: string }>(
        '/api/follows/toggle',
        { method: 'POST', body: JSON.stringify({ targetUserId }) }
      );
      setProfile((p: any) =>
        p
          ? {
              ...p,
              isFollowing: res.isFollowing,
              followersCount: res.followersCount ?? p.followersCount
            }
          : p
      );
      addToast(res.message || (res.isFollowing ? 'تمت المتابعة' : 'تم إلغاء المتابعة'), 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleBlock = async () => {
    if (!confirm('هل تريد حظر هذا المستخدم؟ لن تتمكنا من مراسلة بعضكما.')) return;
    try {
      await apiFetch('/api/users/block', {
        method: 'POST',
        body: JSON.stringify({ targetUserId })
      });
      addToast('تم الحظر', 'success');
      onBack();
    } catch (err: any) {
      addToast(err.message || 'فشل الحظر', 'error');
    }
  };

  const handleMute = async () => {
    try {
      await apiFetch('/api/friends/ignore', {
        method: 'POST',
        body: JSON.stringify({ targetUserId, muteType: 'all' })
      });
      addToast('تم كتم المستخدم من إعداداتك', 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  if (loading) {
    return (
      <div className="min-h-[100dvh] bg-[#08080F] flex items-center justify-center" dir="rtl">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-full border-2 border-violet-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-white/50">جاري تحميل الملف الشخصي...</p>
        </div>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="min-h-[100dvh] bg-[#08080F] flex items-center justify-center p-4" dir="rtl">
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-sm text-rose-300 font-bold">{error || 'غير موجود'}</p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={load} className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold">
              إعادة المحاولة
            </button>
            <button type="button" onClick={onBack} className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs font-bold">
              رجوع
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-[#08080F] text-white flex flex-col" dir="rtl">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#08080F]/95 backdrop-blur border-b border-white/8 px-3 py-2.5 flex items-center gap-3">
        <button type="button" onClick={onBack} className="p-2 rounded-xl hover:bg-white/10">
          <ArrowRight className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <div className="text-sm font-extrabold truncate">{profile.display_name}</div>
          <div className="text-[10px] text-white/40">@{profile.username}</div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Cover */}
        <div className="relative h-36 sm:h-48 bg-gradient-to-br from-violet-900/40 via-[#12121D] to-[#08080F]">
          {profile.banner_url && (
            <img src={profile.banner_url} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
          )}
          {isMe && (
            <label className="absolute top-3 left-3 px-3 py-1.5 rounded-xl bg-black/50 text-[11px] font-bold cursor-pointer hover:bg-black/70">
              تغيير الغلاف
              <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e, 'bannerUrl')} />
            </label>
          )}
        </div>

        {/* Avatar + identity */}
        <div className="px-4 -mt-12 relative z-10">
          <div className="flex items-end justify-between gap-3">
            <div className="relative">
              <AvatarWithFrame
                avatarUrl={profile.avatar_url}
                displayName={profile.display_name}
                gender={profile.gender}
                activeFrame={profile.active_frame}
                size="xl"
              />
              {isMe && (
                <label className="absolute bottom-0 left-0 px-2 py-0.5 rounded-full bg-violet-600 text-[10px] font-bold cursor-pointer">
                  صورة
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e, 'avatarUrl')} />
                </label>
              )}
            </div>
            {!isMe && (
              <div className="flex flex-wrap gap-1.5 pb-1 justify-end">
                <button
                  type="button"
                  onClick={() => onStartPrivateChat(profile.id)}
                  className="px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold flex items-center gap-1"
                >
                  <MessageCircle className="w-3.5 h-3.5" /> رسالة
                </button>
                <button
                  type="button"
                  onClick={handleFollow}
                  className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold flex items-center gap-1"
                >
                  {profile.isFollowing ? <UserMinus className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
                  {profile.isFollowing ? 'إلغاء' : 'متابعة'}
                </button>
              </div>
            )}
            {isMe && (
              <button
                type="button"
                onClick={() => setEditing((v) => !v)}
                className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs font-bold flex items-center gap-1 mb-1"
              >
                <Pencil className="w-3.5 h-3.5" /> تعديل
              </button>
            )}
          </div>

          <div className="mt-3 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
                  profile.hide_online_status
                    ? 'bg-white/20'
                    : profile.isOnline
                      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]'
                      : 'bg-rose-500/80'
                }`}
                title={profile.isOnline ? 'نشط' : 'غير نشط'}
              />
              <h1 className="text-xl font-extrabold" style={{ color: profile.name_color || undefined }}>
                {profile.display_name}
              </h1>
              {(profile.active_badge || profile.roleLabel) && (
                <span className="px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-300 text-[10px] font-bold flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  {profile.active_badge || profile.roleLabel}
                </span>
              )}
            </div>
            <div className="text-xs text-white/45">@{profile.username}</div>
            <div className="flex items-center gap-3 text-[11px] text-white/50 flex-wrap">
              {profile.country && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> {profile.country}
                </span>
              )}
              <span className={profile.hide_online_status ? 'text-white/30' : profile.isOnline ? 'text-emerald-400' : 'text-rose-300'}>
                {profile.hide_online_status
                  ? 'الحالة مخفية'
                  : profile.isOnline
                    ? 'نشط الآن'
                    : `آخر ظهور: ${formatLastSeen(profile.lastSeenAt || 0)}`}
              </span>
              <span>المستوى {profile.level}</span>
              <span className="font-mono-num">{profile.xp || 0} XP</span>
            </div>
            {profile.bio && <p className="text-sm text-white/75 leading-relaxed pt-1">{profile.bio}</p>}

            <div className="flex gap-4 pt-2 text-xs">
              <div>
                <span className="font-extrabold text-white font-mono-num">{profile.followersCount || 0}</span>
                <span className="text-white/40 mr-1">متابع</span>
              </div>
              <div>
                <span className="font-extrabold text-white font-mono-num">{profile.followingCount || 0}</span>
                <span className="text-white/40 mr-1">يتابع</span>
              </div>
              <div>
                <span className="font-extrabold text-white font-mono-num">{profile.public_msg_count || 0}</span>
                <span className="text-white/40 mr-1">رسالة</span>
              </div>
            </div>

            {/* XP bar */}
            <div className="pt-2 max-w-md">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-violet-500"
                  style={{ width: `${profile.levelProgress?.progressPercent || 0}%` }}
                />
              </div>
            </div>
            {/* أغنية البروفايل */}
            {(profile.profile_song_url || isMe) && (
              <div className="pt-3 max-w-md space-y-2">
                <div className="text-[11px] text-white/40 font-bold">أغنية البروفايل</div>
                {profile.profile_song_url ? (
                  <audio controls src={profile.profile_song_url} className="w-full h-9 rounded-lg" />
                ) : (
                  <p className="text-[11px] text-white/30">لا توجد أغنية بعد</p>
                )}
                {isMe && (
                  <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-violet-600/20 text-violet-300 text-[11px] font-bold cursor-pointer">
                    {profile.profile_song_url ? 'تغيير الأغنية' : 'رفع أغنية'}
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const uploaded = await uploadMediaFile(file);
                          await apiFetch('/api/profile/customize', {
                            method: 'PUT',
                            body: JSON.stringify({ profileSongUrl: uploaded.url })
                          });
                          addToast('تم تحديث أغنية البروفايل', 'success');
                          load();
                        } catch (err: any) {
                          addToast(err.message || 'فشل رفع الأغنية', 'error');
                        }
                      }}
                    />
                  </label>
                )}
                {isMe && profile.profile_song_url && (
                  <button
                    type="button"
                    className="text-[11px] text-rose-300 font-bold"
                    onClick={async () => {
                      try {
                        await apiFetch('/api/profile/customize', {
                          method: 'PUT',
                          body: JSON.stringify({ profileSongUrl: '' })
                        });
                        addToast('تم حذف الأغنية', 'success');
                        load();
                      } catch (err: any) {
                        addToast(err.message || 'فشل', 'error');
                      }
                    }}
                  >
                    حذف الأغنية
                  </button>
                )}
              </div>
            )}


            {!isMe && (
              <div className="flex flex-wrap gap-2 pt-3">
                {onOpenSendGift && (
                  <button
                    type="button"
                    onClick={() => onOpenSendGift(profile.id, profile.display_name)}
                    className="px-3 py-1.5 rounded-xl bg-amber-500/20 text-amber-300 text-[11px] font-bold"
                  >
                    🎁 هدية
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleMute}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-white/60 text-[11px] font-bold flex items-center gap-1"
                >
                  <VolumeX className="w-3 h-3" /> كتم
                </button>
                <button
                  type="button"
                  onClick={handleBlock}
                  className="px-3 py-1.5 rounded-xl bg-rose-600/15 text-rose-300 text-[11px] font-bold flex items-center gap-1"
                >
                  <Ban className="w-3 h-3" /> حظر
                </button>
                <button
                  type="button"
                  onClick={() => onOpenReport('user', profile.id)}
                  className="px-3 py-1.5 rounded-xl bg-white/5 text-white/60 text-[11px] font-bold flex items-center gap-1"
                >
                  <Flag className="w-3 h-3" /> إبلاغ
                </button>
              </div>
            )}

            {(user?.role === 'Site Owner') && (
              <div className="flex flex-wrap gap-2 pt-3">
                <button
                  type="button"
                  disabled={identityLoading}
                  onClick={async () => {
                    setIdentityLoading(true);
                    setShowIdentity(true);
                    try {
                      const res = await apiFetch(`/api/admin/identity/${profile.id}`);
                      setIdentityResult(res);
                    } catch (err: any) {
                      addToast(err.message || 'فشل كشف الهوية', 'error');
                      setShowIdentity(false);
                    } finally {
                      setIdentityLoading(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-xl bg-amber-600/25 border border-amber-500/40 text-amber-200 text-[11px] font-extrabold"
                >
                  {identityLoading ? 'جاري الفحص...' : '🔍 كشف عن الهوية'}
                </button>
              </div>
            )}

            {showIdentity && identityResult && (
              <div className="mt-3 p-3 rounded-2xl bg-black/50 border border-amber-500/30 space-y-2 text-right" dir="rtl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-extrabold text-amber-300">نتيجة كشف الهوية</span>
                  <button type="button" onClick={() => setShowIdentity(false)} className="text-[10px] text-white/40">إغلاق</button>
                </div>
                <div className="text-[11px] text-white/60">
                  عناوين IP: {identityResult.summary?.unique_ips || 0} · أجهزة: {identityResult.summary?.unique_devices || 0} · حسابات مرتبطة: {identityResult.summary?.linked_count || 0}
                </div>
                {(identityResult.linkedAccounts || []).length === 0 ? (
                  <p className="text-[11px] text-emerald-400">لا توجد حسابات أخرى مرتبطة بنفس الجهاز أو الـ IP حتى الآن.</p>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {identityResult.linkedAccounts.map((a: any) => (
                      <div key={a.id} className="p-2 rounded-xl bg-white/5 border border-white/10 text-[11px]">
                        <div className="font-bold text-white">{a.display_name} <span className="text-white/40">@{a.username}</span></div>
                        <div className="text-amber-200/80">{a.match_reason}</div>
                        <div className="text-white/40">رتبة: {a.role}{a.is_banned ? ' · محظور' : ''}</div>
                      </div>
                    ))}
                  </div>
                )}
                {(identityResult.fingerprints || []).length > 0 && (
                  <details className="text-[10px] text-white/40">
                    <summary className="cursor-pointer">تفاصيل البصمات ({identityResult.fingerprints.length})</summary>
                    <ul className="mt-1 space-y-1 max-h-32 overflow-y-auto">
                      {identityResult.fingerprints.slice(0, 20).map((f: any, i: number) => (
                        <li key={i}>IP: {f.ip_address || '—'} · جهاز: {(f.device_id || '').slice(0, 12)}…</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Edit form */}
        {isMe && editing && (
          <form onSubmit={handleSave} className="mx-4 mt-4 p-4 rounded-2xl bg-[#12121D] border border-white/8 space-y-3">
            <div>
              <label className="text-[11px] text-white/40 block mb-1">الاسم الظاهر</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 block mb-1">النبذة</label>
              <textarea
                value={editBio}
                onChange={(e) => setEditBio(e.target.value)}
                rows={3}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm outline-none focus:border-violet-500 resize-none"
              />
            </div>
            <div>
              <label className="text-[11px] text-white/40 block mb-1">الدولة</label>
              <input
                value={editCountry}
                onChange={(e) => setEditCountry(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm outline-none focus:border-violet-500"
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-bold disabled:opacity-50"
            >
              {saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
            </button>
          </form>
        )}

        {/* Tabs */}
        <div className="mt-5 border-b border-white/8 flex">
          {(
            [
              { id: 'about', label: 'حول', icon: Users },
              { id: 'posts', label: 'منشورات', icon: ImageIcon },
              { id: 'reels', label: 'ريلز', icon: Film },
              { id: 'friends', label: 'أصدقاء', icon: Users }
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-xs font-bold border-b-2 transition ${
                tab === t.id ? 'border-violet-500 text-white' : 'border-transparent text-white/40'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="p-4 pb-20">
          {tab === 'about' && (
            <div className="space-y-3 text-sm text-white/70">
              <div className="p-3 rounded-2xl bg-[#12121D] border border-white/8">
                <div className="text-[11px] text-white/40 mb-1">الدور</div>
                <div className="font-bold text-white">{profile.roleLabel || profile.role || 'عضو'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-[#12121D] border border-white/8 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] text-white/40">الذهب</div>
                  <div className="font-mono-num font-bold text-amber-300">{profile.gold ?? '—'}</div>
                </div>
                <div>
                  <div className="text-[11px] text-white/40">الجواهر</div>
                  <div className="font-mono-num font-bold text-sky-300">{profile.gems ?? '—'}</div>
                </div>
              </div>
              <p className="text-[11px] text-white/30">لا تُعرض معرفات النظام أو البيانات الحساسة للمستخدمين الآخرين.</p>
            </div>
          )}
          {tab === 'posts' && (
            <p className="text-center text-xs text-white/40 py-10">المنشورات تظهر من الجدار عند توفرها لهذا الحساب.</p>
          )}
          {tab === 'reels' && (
            <p className="text-center text-xs text-white/40 py-10">الريلز المرتبطة بهذا الحساب من قسم الريلز.</p>
          )}
          {tab === 'friends' && (
            <p className="text-center text-xs text-white/40 py-10">
              {profile.followersCount || 0} متابع · {profile.followingCount || 0} يتابع
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfilePage;
