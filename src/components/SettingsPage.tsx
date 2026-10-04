import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  User,
  Lock,
  Bell,
  MessageSquare,
  Palette,
  Shield,
  Ban,
  Database,
  LogOut,
  ChevronLeft,
  Eye,
  EyeOff,
  Loader2
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { getSoundPreferences, updateSoundPreferences, SoundPreferences } from '../services/soundEffects';
import { apiFetch } from '../services/api';

type Section =
  | 'menu'
  | 'account'
  | 'privacy'
  | 'notifications'
  | 'chat'
  | 'appearance'
  | 'security'
  | 'blockmute'
  | 'data'
  | 'sounds';

interface SettingsPageProps {
  onBack: () => void;
  onOpenProfile?: () => void;
}

const SECTIONS: { id: Exclude<Section, 'menu'>; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'account', label: 'الحساب', icon: <User className="w-4 h-4" />, desc: 'الملف والاسم' },
  { id: 'privacy', label: 'الخصوصية', icon: <Lock className="w-4 h-4" />, desc: 'من يراسلك ويرى حالتك' },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="w-4 h-4" />, desc: 'رسائل ومنشن وغرف' },
  { id: 'chat', label: 'المحادثات', icon: <MessageSquare className="w-4 h-4" />, desc: 'الوسائط والمظهر' },
  { id: 'appearance', label: 'المظهر', icon: <Palette className="w-4 h-4" />, desc: 'فاتح / داكن' },
  { id: 'security', label: 'الأمان', icon: <Shield className="w-4 h-4" />, desc: 'كلمة المرور' },
  { id: 'blockmute', label: 'الحظر والكتم', icon: <Ban className="w-4 h-4" />, desc: 'قوائم المحظورين' },
  { id: 'data', label: 'البيانات والحساب', icon: <Database className="w-4 h-4" />, desc: 'خروج' },
  { id: 'sounds', label: 'الأصوات', icon: <Bell className="w-4 h-4" />, desc: 'رسائل وإشعارات' }
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, onOpenProfile }) => {
  const { user, setUser, addToast, logout, theme, toggleTheme } = useApp();
  const [section, setSection] = useState<Section>('menu');
  const [pmPrivacy, setPmPrivacy] = useState('everyone');
  const [callPrivacy, setCallPrivacy] = useState('everyone');
  const [hideOnline, setHideOnline] = useState(false);
  const [allowFollow, setAllowFollow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [ignored, setIgnored] = useState<any[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [country, setCountry] = useState('');
  const [soundPrefs, setSoundPrefs] = useState<SoundPreferences>(() => getSoundPreferences());

  useEffect(() => {
    if (!user) return;
    setPmPrivacy(user.pm_privacy || 'everyone');
    setCallPrivacy(user.call_privacy || 'everyone');
    setHideOnline(Boolean(user.hide_online_status));
    setAllowFollow(user.allow_follow_requests !== 0);
    setDisplayName(user.display_name || '');
    setBio(user.bio || '');
    setCountry(user.country || '');
  }, [user?.id]);

  useEffect(() => {
    if (section !== 'blockmute') return;
    let cancelled = false;
    setLoadingLists(true);
    (async () => {
      try {
        const [b, f] = await Promise.all([
          apiFetch<{ blocked?: any[] }>('/api/users/blocked').catch(() => ({ blocked: [] })),
          apiFetch<{ ignored?: any[] }>('/api/friends').catch(() => ({ ignored: [] }))
        ]);
        if (!cancelled) {
          setBlocked(b.blocked || []);
          setIgnored(f.ignored || []);
        }
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section]);

  const saveProfile = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ user: any }>('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({
          displayName: displayName.trim(),
          bio: bio.trim(),
          country: country.trim()
        })
      });
      if (res.user) setUser(res.user);
      addToast('تم حفظ الملف الشخصي', 'success');
    } catch (err: any) {
      addToast(err?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePrivacy = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ user: any }>('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({
          pmPrivacy,
          callPrivacy,
          hideOnlineStatus: hideOnline ? 1 : 0,
          allowFollowRequests: allowFollow ? 1 : 0
        })
      });
      if (res.user) setUser(res.user);
      addToast('تم حفظ إعدادات الخصوصية', 'success');
    } catch (err: any) {
      addToast(err?.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      addToast('كلمة المرور يجب ألا تقل عن 6 أحرف', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/profile/customize', {
        method: 'PUT',
        body: JSON.stringify({ newPassword })
      });
      setNewPassword('');
      addToast('تم تحديث كلمة المرور', 'success');
    } catch (err: any) {
      addToast(err?.message || 'فشل التحديث', 'error');
    } finally {
      setSaving(false);
    }
  };

  const title =
    section === 'menu' ? 'الإعدادات' : SECTIONS.find((s) => s.id === section)?.label || 'الإعدادات';

  const card = 'p-4 rounded-2xl bg-[#12121D] border border-white/8 space-y-3';
  const inputCls =
    'w-full px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm text-white outline-none focus:border-violet-500';
  const primaryBtn =
    'w-full py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 text-sm font-bold disabled:opacity-50 transition';

  return (
    <div className="min-h-[100dvh] bg-[#08080F] text-white flex flex-col" dir="rtl">
      <div className="sticky top-0 z-30 bg-[#08080F]/95 backdrop-blur border-b border-white/8 px-3 py-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (section === 'menu' ? onBack() : setSection('menu'))}
          className="p-2 rounded-xl hover:bg-white/10"
          aria-label="رجوع"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-extrabold">{title}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 pb-20">
        {section === 'menu' && (
          <div className="space-y-1.5 max-w-lg mx-auto">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-[#12121D] border border-white/8 hover:border-violet-500/30 text-right transition"
              >
                <span className="w-9 h-9 rounded-xl bg-violet-600/15 text-violet-300 flex items-center justify-center shrink-0">
                  {s.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold">{s.label}</div>
                  <div className="text-[11px] text-white/40">{s.desc}</div>
                </div>
                <ChevronLeft className="w-4 h-4 text-white/30 shrink-0" />
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                if (confirm('تسجيل الخروج من هذا الجهاز؟')) void logout();
              }}
              className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-rose-600/10 border border-rose-500/20 text-rose-300 mt-4"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-sm font-bold">تسجيل الخروج</span>
            </button>
          </div>
        )}

        {section === 'account' && (
          <div className="max-w-lg mx-auto space-y-3">
            <div className={card}>
              <div className="text-[11px] text-white/40">اسم المستخدم</div>
              <div className="font-mono text-violet-300">@{user?.username}</div>
              <div className="text-[11px] text-white/40 pt-2">المستوى</div>
              <div>
                {user?.level} · {user?.xp ?? 0} XP
              </div>
            </div>
            <div className={card}>
              <label className="text-[11px] text-white/40 block mb-1">الاسم الظاهر</label>
              <input className={inputCls} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              <label className="text-[11px] text-white/40 block mb-1 pt-2">النبذة</label>
              <textarea
                className={`${inputCls} resize-none`}
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
              <label className="text-[11px] text-white/40 block mb-1 pt-2">الدولة</label>
              <input className={inputCls} value={country} onChange={(e) => setCountry(e.target.value)} />
            </div>
            <button type="button" disabled={saving} onClick={saveProfile} className={primaryBtn}>
              {saving ? 'جاري الحفظ...' : 'حفظ التعديلات'}
            </button>
            {onOpenProfile && (
              <button type="button" onClick={onOpenProfile} className="w-full py-3 rounded-2xl bg-white/10 text-sm font-bold">
                فتح ملفي الشخصي الكامل
              </button>
            )}
          </div>
        )}

        {section === 'privacy' && (
          <div className="max-w-lg mx-auto space-y-4">
            <div className={card}>
              <label className="block text-[11px] text-white/40">من يستطيع مراسلتي؟</label>
              <select value={pmPrivacy} onChange={(e) => setPmPrivacy(e.target.value)} className={inputCls}>
                <option value="everyone">الجميع</option>
                <option value="followers">المتابعون فقط</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="none">لا أحد</option>
              </select>
              <label className="block text-[11px] text-white/40 pt-2">من يستطيع طلب المكالمة؟</label>
              <select value={callPrivacy} onChange={(e) => setCallPrivacy(e.target.value)} className={inputCls}>
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="none">لا أحد</option>
              </select>
              <label className="flex items-center justify-between gap-3 pt-3 text-sm cursor-pointer">
                <span>إخفاء حالة الاتصال</span>
                <input type="checkbox" checked={hideOnline} onChange={(e) => setHideOnline(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm cursor-pointer">
                <span>السماح بطلبات المتابعة</span>
                <input type="checkbox" checked={allowFollow} onChange={(e) => setAllowFollow(e.target.checked)} />
              </label>
            </div>
            <button type="button" disabled={saving} onClick={savePrivacy} className={primaryBtn}>
              {saving ? 'جاري الحفظ...' : 'حفظ الخصوصية'}
            </button>
          </div>
        )}

        {section === 'notifications' && (
          <div className={`max-w-lg mx-auto ${card} text-sm text-white/70`}>
            <p className="font-bold text-white mb-2">تصل الإشعارات عند:</p>
            <ul className="list-disc pr-5 space-y-1.5 text-white/50 text-xs">
              <li>رسالة خاصة جديدة</li>
              <li>منشن @username في الغرف</li>
              <li>طلبات الصداقة والمتابعة</li>
              <li>دعوات الغرف</li>
            </ul>
            <p className="text-[11px] text-white/30 pt-3">يمكنك كتم محادثة معيّنة من داخل الشات الخاص (زر كتم).</p>
          </div>
        )}

        {section === 'chat' && (
          <div className={`max-w-lg mx-auto ${card} text-sm text-white/60 space-y-2`}>
            <p>• الإيموجي والملصقات وGIF في الرسائل الخاصة والغرف.</p>
            <p>• الرسائل الصوتية والصور مدعومة.</p>
            <p>• تفريغ المحادثة من رأس الشات يؤثر على حسابك فقط.</p>
            <p>• تثبيت المحادثة يظهرها أعلى القائمة.</p>
          </div>
        )}

        {section === 'appearance' && (
          <div className="max-w-lg mx-auto space-y-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full p-4 rounded-2xl bg-[#12121D] border border-white/8 flex items-center justify-between"
            >
              <span className="text-sm font-bold">الوضع: {theme === 'dark' ? 'داكن' : 'فاتح'}</span>
              <span className="text-xs text-violet-300 font-bold px-3 py-1 rounded-full bg-violet-600/20">تبديل</span>
            </button>
            <p className="text-[11px] text-white/40 px-1">الألوان: خلفية #08080F · بطاقات #12121D · بنفسجي #7C3AED</p>
          </div>
        )}

        {section === 'security' && (
          <form onSubmit={savePassword} className="max-w-lg mx-auto space-y-3">
            <div className={card}>
              <label className="text-[11px] text-white/40">كلمة مرور جديدة</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={`${inputCls} pl-10`}
                  placeholder="6 أحرف على الأقل"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 p-1"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={saving} className={primaryBtn}>
              {saving ? 'جاري التحديث...' : 'تحديث كلمة المرور'}
            </button>
          </form>
        )}

        {section === 'blockmute' && (
          <div className="max-w-lg mx-auto space-y-4">
            {loadingLists && (
              <div className="flex justify-center py-6 text-white/40">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
            <div>
              <h3 className="text-xs font-bold text-white/50 mb-2">المحظورون</h3>
              {!loadingLists && blocked.length === 0 && (
                <p className="text-xs text-white/30 p-3 rounded-xl bg-[#12121D] border border-white/8">لا يوجد أحد</p>
              )}
              {blocked.map((b) => (
                <div
                  key={b.blocked_id}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#12121D] border border-white/8 mb-1.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-bold truncate">{b.display_name}</div>
                    <div className="text-[10px] text-white/40">@{b.username}</div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch('/api/users/unblock', {
                          method: 'POST',
                          body: JSON.stringify({ targetUserId: b.blocked_id })
                        });
                        setBlocked((prev) => prev.filter((x) => x.blocked_id !== b.blocked_id));
                        addToast('تم إلغاء الحظر', 'success');
                      } catch (err: any) {
                        addToast(err?.message || 'فشل', 'error');
                      }
                    }}
                    className="text-[11px] text-violet-300 font-bold shrink-0"
                  >
                    إلغاء الحظر
                  </button>
                </div>
              ))}
            </div>
            <div>
              <h3 className="text-xs font-bold text-white/50 mb-2">المكتومون (شخصي)</h3>
              {!loadingLists && ignored.length === 0 && (
                <p className="text-xs text-white/30 p-3 rounded-xl bg-[#12121D] border border-white/8">لا يوجد أحد</p>
              )}
              {ignored.map((ig) => (
                <div
                  key={ig.ignored_user_id}
                  className="flex items-center justify-between p-3 rounded-xl bg-[#12121D] border border-white/8 mb-1.5"
                >
                  <div className="text-sm font-bold truncate">
                    {ig.display_name || ig.username || ig.ignored_user_id}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await apiFetch('/api/friends/ignore', {
                          method: 'POST',
                          body: JSON.stringify({ targetUserId: ig.ignored_user_id })
                        });
                        setIgnored((prev) => prev.filter((x) => x.ignored_user_id !== ig.ignored_user_id));
                        addToast('تم إلغاء الكتم', 'success');
                      } catch (err: any) {
                        addToast(err?.message || 'فشل', 'error');
                      }
                    }}
                    className="text-[11px] text-violet-300 font-bold shrink-0"
                  >
                    إلغاء الكتم
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {section === 'data' && (
          <div className="max-w-lg mx-auto space-y-3">
            <p className="text-xs text-white/50 p-2">
              تفريغ محادثة معيّنة يتم من داخل الشات (زر تفريغ) ويؤثر على حسابك فقط.
            </p>
            <button
              type="button"
              onClick={() => {
                if (confirm('تسجيل الخروج من هذا الجهاز؟')) void logout();
              }}
              className="w-full py-3 rounded-2xl bg-rose-600/20 border border-rose-500/30 text-rose-300 text-sm font-bold flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" /> تسجيل الخروج
            </button>
          </div>
        )}

        {section === 'sounds' && (
          <div className="space-y-3">
            <h3 className="text-sm font-extrabold text-white">إعدادات الأصوات</h3>
            <p className="text-[11px] text-white/40">يمكنك إيقاف أي صوت بشكل منفصل.</p>
            {([
              ['enabled', 'تفعيل كل الأصوات'],
              ['dmSound', 'رسائل خاصة'],
              ['publicChatSound', 'رسائل الغرف العامة'],
              ['chatReplySound', 'الردود والمنشن'],
              ['chatSendSound', 'إرسال رسالة'],
              ['notificationSound', 'الإشعارات'],
              ['roomJoinSound', 'دخول الغرفة'],
              ['giftSound', 'الهدايا']
            ] as const).map(([key, label]) => (
              <label
                key={key}
                className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-white/5 border border-white/10 cursor-pointer"
              >
                <span className="text-xs font-bold text-white/90">{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(soundPrefs[key as keyof SoundPreferences])}
                  onChange={(e) => {
                    const next = updateSoundPreferences({ [key]: e.target.checked });
                    setSoundPrefs({ ...next });
                    addToast('تم حفظ إعداد الصوت', 'success');
                  }}
                  className="w-4 h-4 accent-violet-500"
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
