import React, { useState } from 'react';
import { LogIn, UserPlus, UserCheck, ShieldCheck, Mic, Radio, Sparkles, Compass, Trophy, Gift, Crown, Flame } from 'lucide-react';
import { apiFetch, setStoredToken } from '../services/api';
import { signInWithFirebaseGoogle } from '../firebase';
import { useApp } from '../contexts/AppContext';
import { User } from '../types';

export const LandingPage: React.FC = () => {
  const { setUser, addToast, showBanScreen } = useApp();
  const [mode, setMode] = useState<'login' | 'register' | 'guest'>('login');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [guestNickname, setGuestNickname] = useState('');
  const [guestGender, setGuestGender] = useState<'male' | 'female'>('male');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      if (mode === 'register') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({ displayName, username, password })
        });
        setStoredToken(res.token);
        setUser(res.user);
        addToast('تم إنشاء حسابك بنجاح! أكمل إعداد ملفك الشخصي.', 'success');
      } else if (mode === 'login') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username, password })
        });
        setStoredToken(res.token);
        setUser(res.user);
        addToast(`أهلاً بعودتك ${res.user.display_name}!`, 'success');
      } else if (mode === 'guest') {
        const res = await apiFetch<{ token: string; user: User }>('/api/auth/guest', {
          method: 'POST',
          body: JSON.stringify({ nickname: guestNickname, gender: guestGender })
        });
        setStoredToken(res.token);
        setUser(res.user);
        addToast('تم الدخول كضيف بنجاح.', 'info');
      }
    } catch (err: any) {
      const msg = err.message || 'حدث خطأ أثناء المتابعة';
      if (err?.isBanned || /محظور|حظر/.test(msg)) {
        showBanScreen(msg.replace(/^هذا الحساب محظور\.?\s*السبب:\s*/i, '').replace(/^حسابك محظور حالياً\.?\s*السبب:\s*/i, '') || msg);
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const fbUser = await signInWithFirebaseGoogle();
      const res = await apiFetch<{ token: string; user: User }>('/api/auth/firebase', {
        method: 'POST',
        body: JSON.stringify({
                idToken: await fbUser.getIdToken(),
                displayName: fbUser.displayName,
                photoURL: fbUser.photoURL
              })
      });
      setStoredToken(res.token);
      setUser(res.user);
      addToast(`أهلاً بك ${res.user.display_name}!`, 'success');
    } catch (err: any) {
      const msg = err?.message || 'تعذر تسجيل الدخول عبر حساب Google حالياً.';
      if (err?.isBanned || /محظور|حظر/.test(msg)) {
        showBanScreen(msg);
      } else {
        setErrorMsg(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-[#07070F] text-slate-100 flex flex-col justify-between relative overflow-x-hidden overflow-y-auto touch-pan-y">
      {/* الخلفية الحية: شفق متحرك + شبكة + صورة المجلس */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-aurora animate-aurora" />
        <div className="absolute inset-0 bg-grid-overlay" />
        <img
          src="/images/landing_hero_lounge_1790452745506.jpg"
          alt="خلفية نبض المجالس"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-[0.13] scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-[#07070F]/80 via-[#07070F]/70 to-[#07070F]" />
        {/* كرات ضوئية عائمة */}
        <div className="absolute top-24 right-[12%] w-72 h-72 bg-violet-600/25 rounded-full blur-3xl animate-nabd-glow" />
        <div className="absolute top-64 left-[8%] w-80 h-80 bg-fuchsia-600/15 rounded-full blur-3xl animate-nabd-glow stagger-3" />
        <div className="absolute bottom-24 right-1/3 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl animate-nabd-float-slow" />
      </div>

      {/* شريط علوي */}
      <header className="relative z-10 max-w-7xl w-full mx-auto px-6 py-5 flex items-center justify-between border-b border-white/5 animate-nabd-fade-up">
        <a href="#top" className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-white font-display">
          <span className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 shadow-lg shadow-violet-600/40">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-pulse" />
          </span>
          <span>نبض المجالس</span>
        </a>

        <nav className="hidden md:flex items-center gap-8 text-sm text-slate-300">
          <a href="#features" className="hover:text-white transition-colors">الغرف الصوتية</a>
          <a href="#live" className="hover:text-white transition-colors">البث المباشر</a>
          <a href="#economy" className="hover:text-white transition-colors">نظام المستويات</a>
          <a href="#security" className="hover:text-white transition-colors">الحماية والرتب</a>
        </nav>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setMode('register');
              setErrorMsg(null);
            }}
            className="btn-hero px-5 py-2.5 text-xs font-bold text-white rounded-xl whitespace-nowrap cursor-pointer"
          >
            انضم الآن
          </button>
        </div>
      </header>

      {/* المحتوى الرئيسي */}
      <main className="relative z-10 max-w-7xl w-full mx-auto px-6 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-12 items-center flex-1">
        {/* العمود الأيمن: العرض الترحيبي */}
        <div className="lg:col-span-7 space-y-7">
          {/* شارة حالة حية */}
          <div className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full glass-card text-xs text-emerald-300 font-bold animate-nabd-fade-up">
            <span className="live-dot" />
            <span>المجالس مفتوحة الآن — انضم للمنافسة</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-white leading-[1.25] font-display animate-nabd-fade-up stagger-1">
            حيث ينبض الحوار العربي…
            <br />
            <span className="text-gradient">مجالس صوتية، بث مباشر، وسباق نحو القمة</span>
          </h1>

          <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl animate-nabd-fade-up stagger-2">
            اجتمع مع أصدقائك في غرف عامة وخاصة، اصعد للمقاعد الصوتية المباشرة بتقنية WebRTC، شارك يومياتك عبر القصص والريلز، وتنافس في جولات البث ونظام المستويات الحقيقي — كل دقيقة تقضيها هنا ترفع رتبتك.
          </p>

          {/* شريط التنافس: ميزات حقيقية في المنصة */}
          <div className="flex flex-wrap gap-3 animate-nabd-fade-up stagger-3">
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl glass-card glass-card-hover text-xs font-bold text-amber-300">
              <Trophy className="w-4 h-4" />
              <span>ترتيب أسبوعي وإطارات للأبطال</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl glass-card glass-card-hover text-xs font-bold text-fuchsia-300">
              <Flame className="w-4 h-4" />
              <span>نقاط XP عن كل دقيقة تواجد</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl glass-card glass-card-hover text-xs font-bold text-cyan-300">
              <Gift className="w-4 h-4" />
              <span>هدايا ذهبية وماسية بتأثيرات حية</span>
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl glass-card glass-card-hover text-xs font-bold text-violet-300">
              <Crown className="w-4 h-4" />
              <span>رتب وأوسمة تُظهر مكانتك</span>
            </div>
          </div>

          {/* المزايا الأساسية */}
          <div id="features" className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            <div className="glass-card glass-card-hover p-4 rounded-2xl animate-nabd-fade-up stagger-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/25 to-indigo-500/5 text-indigo-300 flex items-center justify-center mb-3 border border-indigo-400/20">
                <Mic className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">غرف ومقاعد صوتية</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                غرف عامة وخاصة محمية بكلمة مرور مع 5 مقاعد صوتية حقيقية وإدارة متكاملة.
              </p>
            </div>

            <div id="live" className="glass-card glass-card-hover p-4 rounded-2xl animate-nabd-fade-up stagger-4">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500/25 to-rose-500/5 text-rose-300 flex items-center justify-center mb-3 border border-rose-400/20">
                <Radio className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">بث مباشر وجولات</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                بثوث صوتية تفاعلية، شريط دعم متحرك، نقرات، وهدايا ذهبية وماسية بتأثيرات حية.
              </p>
            </div>

            <div id="economy" className="glass-card glass-card-hover p-4 rounded-2xl animate-nabd-fade-up stagger-5">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/25 to-amber-500/5 text-amber-300 flex items-center justify-center mb-3 border border-amber-400/20">
                <Sparkles className="w-5 h-5" />
              </div>
              <h3 className="text-sm font-bold text-white mb-1">اقتصاد ومستويات عادلة</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                نظام XP لكل دقيقة تواجد، عملات ذهبية، وجواهر نادرة مع متجر أوسمة وإطارات.
              </p>
            </div>
          </div>
        </div>

        {/* العمود الأيسر: بطاقة الدخول الزجاجية */}
        <div className="lg:col-span-5 animate-nabd-fade-up stagger-2">
          <div className="glass-card border-gradient-animated shimmer-overlay rounded-3xl p-6 sm:p-8 shadow-2xl relative">
            {/* أزرار التبديل بين الأوضاع */}
            <div className="grid grid-cols-3 gap-1.5 p-1.5 bg-slate-950/70 rounded-2xl mb-6 border border-white/5">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'login'
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-violet-700/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>تسجيل الدخول</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'register'
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-violet-700/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>إنشاء حساب</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('guest');
                  setErrorMsg(null);
                }}
                className={`py-2.5 px-3 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer flex items-center justify-center gap-1.5 ${
                  mode === 'guest'
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg shadow-violet-700/30'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <UserCheck className="w-3.5 h-3.5" />
                <span>دخول كضيف</span>
              </button>
            </div>

            {errorMsg && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs leading-relaxed animate-nabd-fade-in">
                {errorMsg}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    الاسم المعروض
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="مثال: صقر العرب"
                    className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                  />
                </div>
              )}

              {mode !== 'guest' ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      اسم المستخدم (Username)
                    </label>
                    <input
                      type="text"
                      required
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="بدون مسافات، مثال: saqr_99"
                      dir="ltr"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500 text-right"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      كلمة المرور
                    </label>
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="6 أحرف على الأقل"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      اللقب المؤقت (اختياري)
                    </label>
                    <input
                      type="text"
                      value={guestNickname}
                      onChange={(e) => setGuestNickname(e.target.value)}
                      placeholder="اتركه فارغاً لتوليد لقب تلقائي"
                      className="w-full px-4 py-3 rounded-xl bg-slate-950/80 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-violet-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      الجنس (لتخصيص الهوية البصرية)
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setGuestGender('male')}
                        className={`py-2.5 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          guestGender === 'male'
                            ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-lg shadow-sky-500/20'
                            : 'bg-slate-950/60 border-white/10 text-slate-400 hover:border-sky-400/40'
                        }`}
                      >
                        ذكر (هوية زرقاء)
                      </button>
                      <button
                        type="button"
                        onClick={() => setGuestGender('female')}
                        className={`py-2.5 px-4 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                          guestGender === 'female'
                            ? 'bg-pink-500/20 border-pink-400 text-pink-200 shadow-lg shadow-pink-500/20'
                            : 'bg-slate-950/60 border-white/10 text-slate-400 hover:border-pink-400/40'
                        }`}
                      >
                        أنثى (هوية وردية)
                      </button>
                    </div>
                  </div>
                </>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="btn-hero w-full py-3.5 px-6 rounded-xl text-white font-bold text-sm disabled:opacity-50 disabled:transform-none cursor-pointer"
              >
                {submitting
                  ? 'جاري المعالجة...'
                  : mode === 'register'
                  ? 'إنشاء حساب جديد'
                  : mode === 'login'
                  ? 'دخول إلى المنصة'
                  : 'الدخول السريع كضيف'}
              </button>
            </form>

            {/* فاصل */}
            <div className="my-5 flex items-center gap-3">
              <div className="h-px bg-white/10 flex-1" />
              <span className="text-xs text-slate-500">أو المتابعة عبر</span>
              <div className="h-px bg-white/10 flex-1" />
            </div>

            {/* زر Google */}
            <button
              type="button"
              onClick={handleGoogleLogin}
              className="w-full py-3 px-4 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-white/10 text-slate-200 text-xs font-semibold flex items-center justify-center gap-2.5 transition-colors cursor-pointer"
            >
              <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/>
                <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"/>
              </svg>
              <span>تسجيل الدخول بواسطة Google</span>
            </button>

            <p id="security" className="mt-5 text-[11px] text-slate-400 text-center leading-relaxed flex items-center justify-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>جميع كلمات المرور مشفرة، وأول حساب مسجل يحصل تلقائياً على رتبة المالك (Owner).</span>
            </p>
          </div>
        </div>
      </main>

      {/* تذييل */}
      <footer className="relative z-10 max-w-7xl w-full mx-auto px-6 py-4 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
        <span>منصة نبض المجالس — جميع الحقوق محفوظة © {new Date().getFullYear()}</span>
        <span className="flex items-center gap-1.5">
          <Compass className="w-3.5 h-3.5 text-violet-400" />
          واجهة عربية متكاملة · غرف صوتية · بث مباشر
        </span>
      </footer>
    </div>
  );
};
