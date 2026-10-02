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
  EyeOff
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
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
  | 'data';

interface SettingsPageProps {
  onBack: () => void;
  onOpenProfile?: () => void;
}

const SECTIONS: { id: Section; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'account', label: 'الحساب', icon: <User className="w-4 h-4" />, desc: 'الملف والاسم' },
  { id: 'privacy', label: 'الخصوصية', icon: <Lock className="w-4 h-4" />, desc: 'من يراسلك ويرى حالتك' },
  { id: 'notifications', label: 'الإشعارات', icon: <Bell className="w-4 h-4" />, desc: 'رسائل ومنشن وغرف' },
  { id: 'chat', label: 'المحادثات', icon: <MessageSquare className="w-4 h-4" />, desc: 'الوسائط والمظهر' },
  { id: 'appearance', label: 'المظهر', icon: <Palette className="w-4 h-4" />, desc: 'فاتح / داكن' },
  { id: 'security', label: 'الأمان', icon: <Shield className="w-4 h-4" />, desc: 'كلمة المرور والجلسات' },
  { id: 'blockmute', label: 'الحظر والكتم', icon: <Ban className="w-4 h-4" />, desc: 'قوائم المحظورين' },
  { id: 'data', label: 'البيانات والحساب', icon: <Database className="w-4 h-4" />, desc: 'خروج وحذف' }
];

export const SettingsPage: React.FC<SettingsPageProps> = ({ onBack, onOpenProfile }) => {
  const { user, setUser, addToast, logout, theme, toggleTheme } = useApp();
  const [section, setSection] = useState<Section>('menu');
  const [pmPrivacy, setPmPrivacy] = useState(user?.pm_privacy || 'everyone');
  const [callPrivacy, setCallPrivacy] = useState(user?.call_privacy || 'everyone');
  const [hideOnline, setHideOnline] = useState(Boolean(user?.hide_online_status));
  const [allowFollow, setAllowFollow] = useState(user?.allow_follow_requests !== 0);
  const [saving, setSaving] = useState(false);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [ignored, setIgnored] = useState<any[]>([]);
  const [newPassword, setNewPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  useEffect(() => {
    if (section === 'blockmute') {
      apiFetch<{ blocked: any[] }>('/api/users/blocked')
        .then((r) => setBlocked(r.blocked || []))
        .catch(() => setBlocked([]));
      apiFetch<{ friends: any[]; ignored: any[] }>('/api/friends')
        .then((r) => setIgnored(r.ignored || []))
        .catch(() => setIgnored([]));
    }
  }, [section]);

  const savePrivacy = async () => {
    setSaving(true);
    try {
      const res = await apiFetch<{ user: any }>('/api/profile/customize', {
        method: 'POST',
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
      addToast(err.message || 'فشل الحفظ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      addToast('كلمة المرور قصيرة جدًا', 'error');
      return;
    }
    setSaving(true);
    try {
      await apiFetch('/api/profile/customize', {
        method: 'POST',
        body: JSON.stringify({ password: newPassword })
      });
      setNewPassword('');
      addToast('تم تحديث كلمة المرور', 'success');
    } catch (err: any) {
      addToast(err.message || 'فشل التحديث', 'error');
    } finally {
      setSaving(false);
    }
  };

  const title =
    section === 'menu' ? 'الإعدادات' : SECTIONS.find((s) => s.id === section)?.label || 'الإعدادات';

  return (
    <div className="min-h-[100dvh] bg-[#08080F] text-white flex flex-col" dir="rtl">
      <div className="sticky top-0 z-30 bg-[#08080F]/95 backdrop-blur border-b border-white/8 px-3 py-2.5 flex items-center gap-3">
        <button
          type="button"
          onClick={() => (section === 'menu' ? onBack() : setSection('menu'))}
          className="p-2 rounded-xl hover:bg-white/10"
        >
          <ArrowRight className="w-5 h-5" />
        </button>
        <h1 className="text-sm font-extrabold">{title}</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-3 pb-16">
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
                if (confirm('تسجيل الخروج؟')) logout();
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
            <div className="p-4 rounded-2xl bg-[#12121D] border border-white/8 space-y-2 text-sm">
              <div className="text-white/40 text-[11px]">الاسم</div>
              <div className="font-bold">{user?.display_name}</div>
              <div className="text-white/40 text-[11px] pt-2">اسم المستخدم</div>
              <div className="font-mono text-violet-300">@{user?.username}</div>
              <div className="text-white/40 text-[11px] pt-2">المستوى</div>
              <div>{user?.level} · {user?.xp} XP</div>
            </div>
            {onOpenProfile && (
              <button
                type="button"
                onClick={onOpenProfile}
                className="w-full py-3 rounded-2xl bg-violet-600 text-sm font-bold"
              >
                فتح ملفي الشخصي الكامل
              </button>
            )}
          </div>
        )}

        {section === 'privacy' && (
          <div className="max-w-lg mx-auto space-y-4">
            <div className="p-4 rounded-2xl bg-[#12121D] border border-white/8 space-y-3">
              <label className="block text-[11px] text-white/40">من يستطيع مراسلتي؟</label>
              <select
                value={pmPrivacy}
                onChange={(e) => setPmPrivacy(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm"
              >
                <option value="everyone">الجميع</option>
                <option value="followers">المتابعون فقط</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="none">لا أحد</option>
              </select>

              <label className="block text-[11px] text-white/40 pt-2">من يستطيع طلب المكالمة؟</label>
              <select
                value={callPrivacy}
                onChange={(e) => setCallPrivacy(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm"
              >
                <option value="everyone">الجميع</option>
                <option value="friends">الأصدقاء فقط</option>
                <option value="none">لا أحد</option>
              </select>

              <label className="flex items-center justify-between gap-3 pt-2 text-sm">
                <span>إخفاء حالة الاتصال</span>
                <input type="checkbox" checked={hideOnline} onChange={(e) => setHideOnline(e.target.checked)} />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>السماح بطلبات المتابعة</span>
                <input type="checkbox" checked={allowFollow} onChange={(e) => setAllowFollow(e.target.checked)} />
              </label>
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={savePrivacy}
              className="w-full py-3 rounded-2xl bg-violet-600 text-sm font-bold disabled:opacity-50"
            >
              حفظ الخصوصية
            </button>
          </div>
        )}

        {section === 'notifications' && (
          <div className="max-w-lg mx-auto p-4 rounded-2xl bg-[#12121D] border border-white/8 text-sm text-white/70 space-y-2">
            <p>الإشعارات تُنشأ من السيرفر عند:</p>
            <ul className="list-disc pr-5 space-y-1 text-white/50 text-xs">
              <li>رسالة خاصة جديدة</li>
              <li>منشن @username في الغرف</li>
              <li>طلبات الصداقة والمتابعة</li>
              <li>دعوات الغرف والألعاب</li>
            </ul>
            <p className="text-[11px] text-white/30 pt-2">إعدادات تفصيلية لكل نوع يمكن توسيعها لاحقًا من نفس هذه الصفحة.</p>
          </div>
        )}

        {section === 'chat' && (
          <div className="max-w-lg mx-auto p-4 rounded-2xl bg-[#12121D] border border-white/8 text-sm text-white/60 space-y-2">
            <p>• الإيموجي والملصقات وGIF متاحة في الرسائل الخاصة والغرف.</p>
            <p>• الرسائل الصوتية والصور مدعومة.</p>
            <p>• تفريغ المحادثة من رأس الشات يؤثر على حسابك فقط.</p>
          </div>
        )}

        {section === 'appearance' && (
          <div className="max-w-lg mx-auto space-y-3">
            <button
              type="button"
              onClick={toggleTheme}
              className="w-full p-4 rounded-2xl bg-[#12121D] border border-white/8 flex items-center justify-between"
            >
              <span className="text-sm font-bold">الوضع الحالي: {theme === 'dark' ? 'داكن' : 'فاتح'}</span>
              <span className="text-xs text-violet-300 font-bold">تبديل</span>
            </button>
            <p className="text-[11px] text-white/40 px-1">الألوان الأساسية: خلفية #08080F · بطاقات #12121D · بنفسجي #7C3AED</p>
          </div>
        )}

        {section === 'security' && (
          <form onSubmit={savePassword} className="max-w-lg mx-auto space-y-3">
            <div className="p-4 rounded-2xl bg-[#12121D] border border-white/8 space-y-2">
              <label className="text-[11px] text-white/40">كلمة مرور جديدة</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-sm pr-10"
                  placeholder="6 أحرف على الأقل"
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button type="submit" disabled={saving} className="w-full py-3 rounded-2xl bg-violet-600 text-sm font-bold">
              تحديث كلمة المرور
            </button>
          </form>
        )}

        {section === 'blockmute' && (
          <div className="max-w-lg mx-auto space-y-4">
            <div>
              <h3 className="text-xs font-bold text-white/50 mb-2">المحظورون</h3>
              {blocked.length === 0 ? (
                <p className="text-xs text-white/30 p-3">لا يوجد أحد</p>
              ) : (
                blocked.map((b) => (
                  <div key={b.blocked_id} className="flex items-center justify-between p-3 rounded-xl bg-[#12121D] border border-white/8 mb-1.5">
                    <div>
                      <div className="text-sm font-bold">{b.display_name}</div>
                      <div className="text-[10px] text-white/40">@{b.username}</div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/api/users/unblock', {
                          method: 'POST',
                          body: JSON.stringify({ targetUserId: b.blocked_id })
                        });
                        setBlocked((prev) => prev.filter((x) => x.blocked_id !== b.blocked_id));
                        addToast('تم إلغاء الحظر', 'success');
                      }}
                      className="text-[11px] text-violet-300 font-bold"
                    >
                      إلغاء الحظر
                    </button>
                  </div>
                ))
              )}
            </div>
            <div>
              <h3 className="text-xs font-bold text-white/50 mb-2">المكتومون (شخصي)</h3>
              {ignored.length === 0 ? (
                <p className="text-xs text-white/30 p-3">لا يوجد أحد</p>
              ) : (
                ignored.map((ig) => (
                  <div
                    key={ig.ignored_user_id}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#12121D] border border-white/8 mb-1.5"
                  >
                    <div className="text-sm font-bold">{ig.display_name || ig.ignored_user_id}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch('/api/friends/ignore', {
                          method: 'POST',
                          body: JSON.stringify({ targetUserId: ig.ignored_user_id })
                        });
                        setIgnored((prev) => prev.filter((x) => x.ignored_user_id !== ig.ignored_user_id));
                        addToast('تم إلغاء الكتم', 'success');
                      }}
                      className="text-[11px] text-violet-300 font-bold"
                    >
                      إلغاء الكتم
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {section === 'data' && (
          <div className="max-w-lg mx-auto space-y-3">
            <p className="text-xs text-white/50 p-2">
              تفريغ محادثة معينة يتم من داخل الشات (زر تفريغ) ويؤثر على حسابك فقط.
            </p>
            <button
              type="button"
              onClick={() => {
                if (confirm('تسجيل الخروج من هذا الجهاز؟')) logout();
              }}
              className="w-full py-3 rounded-2xl bg-rose-600/20 border border-rose-500/30 text-rose-300 text-sm font-bold flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" /> تسجيل الخروج
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsPage;
