import React, { useState } from 'react';
import { AppProvider, useApp } from './contexts/AppContext';
import { LandingPage } from './components/LandingPage';
import { ProfileSetupModal } from './components/ProfileSetupModal';
import { ChatRoomView } from './components/ChatRoomView';
import { LiveStreamPage } from './components/LiveStreamPage';
import {
  PrivateMessagesModal,
  StoriesModal,
  ReelsModal,
  WallModal,
  RankingsModal,
  StoreModal,
  UserProfileModal,
  SendGiftModal,
  ReportModal
} from './components/SocialModals';
import { AdminPanelModal } from './components/AdminPanelModal';
import { ProfilePage } from './components/ProfilePage';
import { SettingsPage } from './components/SettingsPage';
import { NewsModal } from './components/NewsModal';
import { GamesHubModal } from './components/GamesHubModal';
import { AvatarWithFrame } from './components/AvatarWithFrame';
import { ImageLightbox } from './components/ImageLightbox';

const MainRouter: React.FC = () => {
  const { user, loadingAuth, activeGiftAnimation, toasts, removeToast, banInfo, clearBanInfo, broadcastAnnouncement, dismissBroadcast } = useApp();
  const [currentView, setCurrentView] = useState<'rooms' | 'live' | 'profile' | 'settings' | 'messages'>('rooms');
  const [activeModal, setActiveModal] = useState<
    'pm' | 'friends' | 'stories' | 'reels' | 'wall' | 'rankings' | 'store' | 'admin' | 'settings' | 'news' | 'game' | null
  >(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  React.useEffect(() => {
    const onLb = (e: Event) => {
      const src = (e as CustomEvent).detail;
      if (typeof src === 'string' && src) setLightboxSrc(src);
    };
    window.addEventListener('nabd-lightbox', onLb);
    return () => window.removeEventListener('nabd-lightbox', onLb);
  }, []);
  const [pmPartnerId, setPmPartnerId] = useState<string | null>(null);
  const [pmInitialTab, setPmInitialTab] = useState<'chats' | 'friends'>('chats');
  const [profileTargetId, setProfileTargetId] = useState<string | null>(null);
  const [giftTarget, setGiftTarget] = useState<{
    receiverId: string;
    receiverName: string;
    contextType: 'room' | 'live';
    contextId: string;
  } | null>(null);
  const [reportTarget, setReportTarget] = useState<{ targetType: string; targetId: string } | null>(null);
  const [currentRoomId, setCurrentRoomId] = useState<string>('room-general');
  const canPublishNews =
    Boolean(user?.permissions?.can_access_admin) ||
    ['Site Owner', 'Owner', 'Super Admin', 'Admin'].includes(user?.role || '');

  if (loadingAuth) {
    return (
      <div className="min-h-[100dvh] bg-[#F8FAFC] dark:bg-[var(--nabd-bg)] text-slate-800 dark:text-slate-200 flex items-center justify-center transition-colors">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-slate-500 dark:text-slate-400">جاري تحميل منصة نبض المجالس...</p>
        </div>
      </div>
    );
  }

  if (banInfo) {
    return (
      <div className="min-h-[100dvh] bg-rose-950 flex items-center justify-center p-6" dir="rtl">
        <div className="max-w-sm w-full text-center space-y-5">
          <div className="mx-auto w-24 h-24 rounded-full bg-rose-600/30 border-2 border-rose-400 flex items-center justify-center">
            <span className="text-5xl" aria-hidden>🚫</span>
          </div>
          <h1 className="text-2xl font-extrabold text-rose-100">تم حظرك</h1>
          <p className="text-sm text-rose-200/90 leading-relaxed">
            تم حظر حسابك من المنصة. لا يمكنك استخدام الموقع حالياً.
          </p>
          <div className="p-4 rounded-2xl bg-rose-900/60 border border-rose-500/40 text-right">
            <div className="text-[11px] text-rose-300/80 mb-1">السبب</div>
            <div className="text-sm font-bold text-white">{banInfo.reason}</div>
          </div>
          <p className="text-[11px] text-rose-300/70 leading-relaxed">
            تواصل مع الإدارة إذا كنت تعتقد أن هذا الحظر تم بالخطأ.
          </p>
        </div>
      </div>
    );
  }



  return (
    <>
      {/* Global Toast Notifications */}
      <div className="fixed top-16 inset-x-3 sm:inset-x-auto sm:left-4 z-[80] flex flex-col gap-1.5 sm:max-w-xs pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => removeToast(t.id)}
            className={`pointer-events-auto px-3 py-2 rounded-xl border text-xs font-bold shadow-lg backdrop-blur-xl cursor-pointer transition-all ${
              t.type === 'error'
                ? 'bg-rose-600 dark:bg-rose-950/90 border-rose-500/40 text-white dark:text-rose-200'
                : t.type === 'reward'
                ? 'bg-amber-500 dark:bg-amber-950/90 border-amber-400/50 text-slate-950 dark:text-amber-200'
                : t.type === 'success'
                ? 'bg-emerald-600 dark:bg-emerald-950/90 border-emerald-500/40 text-white dark:text-emerald-200'
                : 'bg-white/95 dark:bg-slate-900/95 border-slate-200 dark:border-white/15 text-slate-900 dark:text-slate-100'
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>

      {/* Global Gift Animation Overlay (Lightweight GPU transform/opacity) */}
      {activeGiftAnimation && (
        <div className="fixed top-16 inset-x-0 z-[75] flex justify-center pointer-events-none px-3">
          <div
            className={`px-3 py-2 rounded-2xl bg-gradient-to-r ${activeGiftAnimation.effectClass} border backdrop-blur-xl shadow-xl flex items-center gap-2.5 max-w-full`}
          >
            <span className="text-2xl sm:text-3xl">{activeGiftAnimation.giftEmoji}</span>
            <div>
              <div className="text-[11px] sm:text-xs font-extrabold text-white">
                {activeGiftAnimation.senderName} أرسل هدية{' '}
                <span className="text-amber-300">{activeGiftAnimation.giftName}</span> إلى{' '}
                {activeGiftAnimation.receiverName}!
              </div>
              <div className="text-[11px] font-bold text-emerald-300 font-mono-num mt-0.5">
                +{activeGiftAnimation.barPower.toLocaleString()} نقطة دعم في الشريط ⚡
              </div>
            </div>
            <AvatarWithFrame
              avatarUrl={activeGiftAnimation.senderAvatar}
              displayName={activeGiftAnimation.senderName}
              size="sm"
            />
          </div>
        </div>
      )}

      {!user ? (
        <LandingPage />
      ) : (
        <>
          {/* Post-Registration Profile Setup Modal */}
          {user.profile_completed === 0 && (
            <ProfileSetupModal onCompleted={() => {}} />
          )}

          {/* Main Active View */}
          {currentView === 'profile' || currentView === 'settings' || currentView === 'messages' ? null : currentView === 'live' ? (
            <LiveStreamPage
              onBackToRooms={() => setCurrentView('rooms')}
              onOpenProfile={(uid) => { setProfileTargetId(uid); setCurrentView('profile'); }}
            />
          ) : (
            <ChatRoomView
              onRoomChange={setCurrentRoomId}
              onNavigateLive={() => setCurrentView('live')}
              onOpenModal={(modal, extraUid) => {
                if (modal === 'settings') {
                  setCurrentView('settings');
                  return;
                }
                if (modal === 'pm' || modal === 'friends') {
                  setPmPartnerId(extraUid || null);
                  setPmInitialTab(modal === 'friends' ? 'friends' : 'chats');
                  setCurrentView('messages');
                  setActiveModal(null);
                  return;
                }
                setActiveModal(modal);
              }}
              onOpenProfile={(uid) => { setProfileTargetId(uid); setCurrentView('profile'); }}
              onOpenGift={(receiverId, receiverName, roomId) =>
                setGiftTarget({
                  receiverId,
                  receiverName,
                  contextType: 'room',
                  contextId: roomId
                })
              }
              onOpenReport={(targetType, targetId) => setReportTarget({ targetType, targetId })}
            />
          )}

          
          {/* إشعار الإدارة الجماعي — علبة في الوسط */}
          {broadcastAnnouncement && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
              <div className="bg-[var(--nabd-surface)] border border-amber-500/40 rounded-2xl max-w-sm w-full max-h-[70dvh] overflow-y-auto p-4 shadow-2xl space-y-4 text-center" dir="rtl">
                <div className="text-2xl">📢</div>
                <h3 className="text-base font-extrabold text-amber-300">{broadcastAnnouncement.title}</h3>
                <p className="text-sm text-white/90 leading-relaxed whitespace-pre-wrap">{broadcastAnnouncement.body}</p>
                <button
                  type="button"
                  onClick={dismissBroadcast}
                  className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-bold"
                >
                  حسناً
                </button>
              </div>
            </div>
          )}

{/* Modals & Slide-overs */}
          {currentView === 'messages' && (
            <PrivateMessagesModal
              asPage
              initialPartnerId={pmPartnerId}
              initialTab={pmInitialTab}
              onClose={() => {
                setPmPartnerId(null);
                setCurrentView('rooms');
              }}
              onOpenProfile={(uid) => { setProfileTargetId(uid); setCurrentView('profile'); }}
            />
          )}

          {activeModal === 'stories' && <StoriesModal onClose={() => setActiveModal(null)} />}

          {activeModal === 'reels' && (
            <ReelsModal
              onClose={() => setActiveModal(null)}
              onOpenProfile={(uid) => { setProfileTargetId(uid); setCurrentView('profile'); }}
            />
          )}

          {activeModal === 'wall' && (
            <WallModal
              onClose={() => setActiveModal(null)}
              onOpenProfile={(uid) => { setProfileTargetId(uid); setCurrentView('profile'); }}
            />
          )}

          {activeModal === 'rankings' && (
            <RankingsModal
              onClose={() => setActiveModal(null)}
              onOpenProfile={(uid) => { setProfileTargetId(uid); setCurrentView('profile'); }}
            />
          )}

          {activeModal === 'store' && <StoreModal onClose={() => setActiveModal(null)} />}

          {activeModal === 'admin' && <AdminPanelModal onClose={() => setActiveModal(null)} />}
          {activeModal === 'news' && (
            <NewsModal onClose={() => setActiveModal(null)} canPublish={canPublishNews} />
          )}

          {activeModal === 'game' && (
            <GamesHubModal onClose={() => setActiveModal(null)} />
          )}


          {currentView === 'profile' && profileTargetId && (
            <ProfilePage
              targetUserId={profileTargetId}
              onBack={() => {
                setProfileTargetId(null);
                setCurrentView('rooms');
              }}
              onStartPrivateChat={(partnerId) => {
                setProfileTargetId(null);
                setCurrentView('rooms');
                setPmPartnerId(partnerId);
                setPmInitialTab('chats'); setCurrentView('messages');
              }}
              onOpenSendGift={(receiverId, receiverName) => {
                setGiftTarget({
                  receiverId,
                  receiverName,
                  contextType: 'room',
                  contextId: currentRoomId
                });
              }}
              onOpenReport={(targetType, targetId) => {
                setReportTarget({ targetType, targetId });
              }}
            />
          )}

          {currentView === 'settings' && (
            <SettingsPage
              onBack={() => setCurrentView('rooms')}
              onOpenProfile={() => {
                if (user?.id) {
                  setProfileTargetId(user.id);
                  setCurrentView('profile');
                }
              }}
            />
          )}

          {currentView !== 'profile' && currentView !== 'settings' && profileTargetId && (
            <UserProfileModal
              targetUserId={profileTargetId}
              onClose={() => setProfileTargetId(null)}
              onStartPrivateChat={(partnerId) => {
                setProfileTargetId(null);
                setPmPartnerId(partnerId);
                setPmInitialTab('chats'); setCurrentView('messages');
              }}
              onOpenSendGift={(receiverId, receiverName) => {
                setProfileTargetId(null);
                setGiftTarget({
                  receiverId,
                  receiverName,
                  contextType: 'room',
                  contextId: currentRoomId
                });
              }}
              onOpenReport={(targetType, targetId) => {
                setProfileTargetId(null);
                setReportTarget({ targetType, targetId });
              }}
            />
          )}

          {giftTarget && (
            <SendGiftModal
              receiverId={giftTarget.receiverId}
              receiverName={giftTarget.receiverName}
              contextType={giftTarget.contextType}
              contextId={giftTarget.contextId}
              onClose={() => setGiftTarget(null)}
            />
          )}

          {reportTarget && (
            <ReportModal
              targetType={reportTarget.targetType}
              targetId={reportTarget.targetId}
              onClose={() => setReportTarget(null)}
            />
          )}
        </>
      )}
      <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />
    </>
  );
};

export default function App() {
  return (
    <AppProvider>
      <MainRouter />
    </AppProvider>
  );
}
