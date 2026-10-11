import React, { useEffect, useState, useRef } from 'react';
import {
  Menu,
  Bell,
  UserPlus,
  Mail,
  Film,
  Trophy,
  Sparkles,
  Radio,
  ShoppingBag,
  Users,
  Home,
  User as UserIcon,
  RefreshCw,
  Send,
  Mic,
  MicOff,
  Headphones,
  VolumeX,
  Image as ImageIcon,
  Gift,
  ChevronUp,
  ChevronDown,
  Lock,
  Plus,
  Shield,
  Trash2,
  Flag,
  Square,
  Settings,
  MoreHorizontal,
  Newspaper,
  Crown,
  Search,
  X,
  Sun,
  Moon,
  Smile,
  Reply,
  Copy,
  MoreVertical,
  LogOut,
  Volume2,
  Gamepad2,
  Palette
} from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch, uploadMediaFile } from '../services/api';
import { Room, RoomMessage, VoiceSeat } from '../types';
import { AvatarWithFrame } from './AvatarWithFrame';
import { useWebRTCAudio } from '../hooks/useWebRTCAudio';
import { playRoomJoinSound, playChatSendSound, playChatReplySound, playPublicChatSound } from '../services/soundEffects';
import { EmojiPicker } from './EmojiPicker';
import { GifPicker } from './MediaPickers';

interface ChatRoomViewProps {
  onNavigateLive: () => void;
  onOpenModal: (
    modal:
      | 'pm'
      | 'friends'
      | 'stories'
      | 'reels'
      | 'wall'
      | 'rankings'
      | 'store'
      | 'admin'
      | 'settings'
      | 'news'
      | 'game'
      | null,
    extraUserId?: string
  ) => void;
  onRoomChange?: (roomId: string) => void;
  onOpenProfile: (userId: string) => void;
  onOpenGift: (receiverId: string, receiverName: string, roomId: string) => void;
  onOpenReport: (targetType: string, targetId: string) => void;
}

export const ChatRoomView: React.FC<ChatRoomViewProps> = ({
  onRoomChange,
  onNavigateLive,
  onOpenModal,
  onOpenProfile,
  onOpenGift,
  onOpenReport
}) => {
  const { user, socket, rooms, refreshRooms, addToast, theme, toggleTheme, sessionEntryTime } = useApp();
  const [activeRoomId, setActiveRoomId] = useState<string>('room-general');
  const [messages, setMessages] = useState<any[]>([]);
  const hasCleanedInitialMessagesRef = useRef<boolean>(false);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [seats, setSeats] = useState<VoiceSeat[]>([]);
  const [podiums, setPodiums] = useState<{ topStaff: any[]; topMembers: any[] }>({
    topStaff: [],
    topMembers: []
  });

  // UI toggles (On mobile <768px, keep rightUsersOpen closed initially so chat stream is unobstructed)
  const [leftNavOpen, setLeftNavOpen] = useState<boolean>(false);
  const [rightUsersOpen, setRightUsersOpen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [seatsCollapsed, setSeatsCollapsed] = useState<boolean>(false);
  const [isListeningRoomAudio, setIsListeningRoomAudio] = useState<boolean>(true);
  const [userSearch, setUserSearch] = useState('');

  // Context Menu popover when clicking a user
  const [selectedContextUser, setSelectedContextUser] = useState<any | null>(null);

  // Rooms & Private Room Modals
  const [showRoomsModal, setShowRoomsModal] = useState(false);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState(false);
  const [privatePromptRoom, setPrivatePromptRoom] = useState<Room | null>(null);
  const [privateRoomCodeInput, setPrivateRoomCodeInput] = useState('');
  const [privateRoomPwdInput, setPrivateRoomPwdInput] = useState('');

  // Create Room Form
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomDesc, setNewRoomDesc] = useState('');
  const [newRoomIsPrivate, setNewRoomIsPrivate] = useState(false);
  const [newRoomCode, setNewRoomCode] = useState('');
  const [newRoomPassword, setNewRoomPassword] = useState('');

  // Room Settings Edit Modal
  const [showRoomSettings, setShowRoomSettings] = useState(false);
  const [editRoomName, setEditRoomName] = useState('');
  const [editRoomWelcome, setEditRoomWelcome] = useState('');
  const [editRoomLocked, setEditRoomLocked] = useState(false);

  // Notifications popover
  const [showNotifs, setShowNotifs] = useState(false);
  const [showHeaderMore, setShowHeaderMore] = useState(false);
  const [actionMsgId, setActionMsgId] = useState<string | null>(null);
  const [showTour, setShowTour] = useState<boolean>(() => {
    try { return !localStorage.getItem('nabd_tour_done'); } catch { return false; }
  });
  const closeTour = () => {
    setShowTour(false);
    try { localStorage.setItem('nabd_tour_done', '1'); } catch {}
  };
  const [notifsList, setNotifsList] = useState<any[]>([]);

  // Chat Input & Voice Clip Recording
  const [inputText, setInputText] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; username: string; content: string } | null>(null);
  const [msgMenuId, setMsgMenuId] = useState<string | null>(null);
  const [typingUsers, setTypingUsers] = useState<{ userId: string; displayName: string }[]>([]);
  const [pinnedMsg, setPinnedMsg] = useState<any | null>(null);
  const [msgReactions, setMsgReactions] = useState<Record<string, { emoji: string; count: number }[]>>({});
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const QUICK_REPLIES = ['👍', '❤️', '😂', '🔥', '👏', '✨', 'مرحبا', 'تمام', 'ما شاء الله'];
  const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '🔥', '👏'];
  const [recordingClip, setRecordingClip] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const chatStreamEndRef = useRef<HTMLDivElement | null>(null);
  const chatScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  const currentRoom = rooms.find((r) => r.id === activeRoomId) || rooms[0];

  // Helper to ensure white custom colors remain legible in Light Mode
  const resolveLegibleColor = (hexColor?: string, fallbackDark = '#FFFFFF', fallbackLight = '#0F172A') => {
    const normalized = (hexColor || '').trim().toUpperCase();
    if (!normalized || normalized === '#FFFFFF' || normalized === '#FFF' || normalized === '#F1F5F9') {
      return theme === 'light' ? fallbackLight : fallbackDark;
    }
    return hexColor;
  };

  // Real WebRTC Voice Seats Connection
  const { micError } = useWebRTCAudio({
    socket,
    currentUserId: user?.id || '',
    contextType: 'room',
    contextId: activeRoomId,
    seats,
    isListening: isListeningRoomAudio
  });

  // Load Podiums (تفاعل الإدارة & تفاعل الأعضاء)
  const loadPodiums = async () => {
    try {
      const res = await apiFetch<{ topStaff: any[]; topMembers: any[] }>('/api/rankings');
      setPodiums({
        topStaff: res.topStaff || [],
        topMembers: res.topMembers || []
      });
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadPodiums();
  }, [activeRoomId]);

  const handleOpenNotifs = async () => {
    const next = !showNotifs;
    setShowNotifs(next);
    if (next) {
      try {
        const res = await apiFetch<{ notifications: any[] }>('/api/notifications');
        setNotifsList(res.notifications);
      } catch {
        // ignore
      }
    }
  };

  // عند تبديل الغرفة: امسح بيانات الغرفة السابقة فوراً حتى لا تظهر رسائل/مقاعد/متصلين غرفة أخرى
  useEffect(() => {
    onRoomChange?.(activeRoomId);
    setMessages([]);
    setOnlineUsers([]);
    setSeats([]);
    setSelectedContextUser(null);
    setIsUserScrolledUp(false);
  }, [activeRoomId]);

  // Load room messages & join socket room (Public Room Messages are ephemeral per visit)
  useEffect(() => {
    if (!socket || !activeRoomId) return;

    let cancelled = false;

    const loadMessages = () => {
      const freshFlag = !hasCleanedInitialMessagesRef.current ? '&fresh=1' : '';
      hasCleanedInitialMessagesRef.current = true;
      apiFetch<{ messages: RoomMessage[] }>(
        `/api/rooms/${activeRoomId}/messages?since=${sessionEntryTime}${freshFlag}`
      )
        .then((res) => {
          if (!cancelled) setMessages(res.messages);
        })
        .catch(() => {});
    };

    const joinRoom = () => {
      socket.emit('room:join', { roomId: activeRoomId });
    };

    loadMessages();
    joinRoom();

    // بعد انقطاع الشبكة وإعادة الاتصال يفقد الخادم عضويتك في الغرفة، فنعيد الانضمام تلقائياً
    const handleReconnect = () => {
      joinRoom();
      loadMessages();
    };
    socket.io.on('reconnect', handleReconnect);

    const handlePresence = (payload: {
      roomId: string;
      onlineCount: number;
      onlineUsers: any[];
      seats: VoiceSeat[];
    }) => {
      if (payload.roomId !== activeRoomId) return;
      setOnlineUsers(payload.onlineUsers);
      setSeats(payload.seats);
      scheduleRoomsRefresh();
    };

    const handleSeatsUpdate = (payload: { contextType: string; contextId: string; seats: VoiceSeat[] }) => {
      if (payload.contextType === 'room' && payload.contextId === activeRoomId) {
        setSeats(payload.seats);
      }
    };

    const handleNewMessage = (msg: RoomMessage) => {
      if (msg.room_id !== activeRoomId) return;
      if (user && msg.user_id !== user.id) {
        if (
          msg.content &&
          (msg.content.includes(`@${user.display_name}`) ||
            msg.content.includes(`@${user.username}`) ||
            msg.content.includes(`رد على ${user.display_name}`))
        ) {
          playChatReplySound();
        } else if (!msg.is_system) {
          playPublicChatSound();
        }
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev.slice(-100), msg];
      });
    };

    const handleSystemEvent = (ev: any) => {
      if (ev.roomId !== activeRoomId) return;
      if (ev.userId !== user?.id) {
        playRoomJoinSound();
      }
      setMessages((prev) => [
        ...prev.slice(-100),
        {
          id: ev.id,
          room_id: ev.roomId,
          user_id: ev.userId,
          display_name: ev.displayName,
          avatar_url: ev.avatarUrl,
          role_label: ev.badgeText,
          content: ev.text,
          is_system: 1,
          hasRoyalEntry: ev.hasRoyalEntry,
          created_at: ev.createdAt
        }
      ]);
    };

    const handleMessageDeleted = ({ msgId }: { msgId: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
    };

    const handleMessagesCleared = (payload?: { roomId?: string }) => {
      if (!payload?.roomId || payload.roomId === 'all' || payload.roomId === activeRoomId) {
        setMessages([]);
      }
    };

    const handleUserMessagesCleared = ({ userId: clearedUid }: { userId: string }) => {
      setMessages((prev) => prev.filter((m) => m.user_id !== clearedUid));
    };

    const handleRoomError = ({ message }: { message: string }) => {
      addToast(message, 'error');
    };

    const handleKicked = (payload: { roomId: string; actionType: string; reason: string }) => {
      if (payload.roomId === activeRoomId) {
        addToast(`تم إخراجك من الغرفة: ${payload.reason}`, 'error');
        setActiveRoomId('room-general');
      }
    };

    const handleSeatInvited = (payload: { roomId: string; seatIndex: number; invitedBy: string }) => {
      playRoomJoinSound();
      addToast(`🎙️ دعاك ${payload.invitedBy} للصعود إلى المقعد الصوتي رقم ${payload.seatIndex + 1}!`, 'info');
    };

    // تجميع تحديثات قائمة الغرف حتى لا ترسل طلباً مع كل دخول/خروج
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRoomsRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        refreshRooms();
      }, 3000);
    };

    socket.on('room:presence', handlePresence);
    socket.on('voice:seats_update', handleSeatsUpdate);
    socket.on('room:new_message', handleNewMessage);
    socket.on('room:system_event', handleSystemEvent);
    const handleTyping = (p: { userId: string; displayName: string; roomId?: string }) => {
      if (p.userId === user?.id) return;
      if (p.roomId && activeRoomId && p.roomId !== activeRoomId) return;
      setTypingUsers((prev) => {
        if (prev.some((x) => x.userId === p.userId)) return prev;
        return [...prev, { userId: p.userId, displayName: p.displayName }].slice(-5);
      });
      window.setTimeout(() => {
        setTypingUsers((prev) => prev.filter((x) => x.userId !== p.userId));
      }, 2500);
    };
    const handleReact = (p: { messageId: string; reactions: { emoji: string; count: number }[] }) => {
      setMsgReactions((prev) => ({ ...prev, [p.messageId]: p.reactions || [] }));
    };
    const handlePinEvt = (p: { messageId: string | null; pinned: any }) => {
      setPinnedMsg(p.messageId ? p.pinned : null);
    };

    socket.on('room:message_deleted', handleMessageDeleted);
    socket.on('room:messages_cleared', handleMessagesCleared);
    socket.on('room:user_messages_cleared', handleUserMessagesCleared);
    socket.on('room:error', handleRoomError);
    socket.on('room:kicked', handleKicked);
    socket.on('room:seat:invited', handleSeatInvited);
    const handleJoinSummary = (p: any) => {
      if (p?.welcomeMessage) {
        addToast(p.welcomeMessage, 'info');
      }
      if (p?.quietMode) {
        addToast('هذه الغرفة في الوضع الهادئ (دردشة فقط)', 'info');
      }
    };
    socket.on('room:join_summary', handleJoinSummary);
    socket.on('room:typing', handleTyping);
    socket.on('room:react', handleReact);
    socket.on('room:pin', handlePinEvt);

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      socket.io.off('reconnect', handleReconnect);
      socket.off('room:presence', handlePresence);
      socket.off('voice:seats_update', handleSeatsUpdate);
      socket.off('room:new_message', handleNewMessage);
      socket.off('room:system_event', handleSystemEvent);
      socket.off('room:message_deleted', handleMessageDeleted);
      socket.off('room:messages_cleared', handleMessagesCleared);
      socket.off('room:user_messages_cleared', handleUserMessagesCleared);
      socket.off('room:error', handleRoomError);
      socket.off('room:kicked', handleKicked);
      socket.off('room:seat:invited', handleSeatInvited);
      socket.off('room:join_summary', handleJoinSummary);
      socket.off('room:typing', handleTyping);
      socket.off('room:react', handleReact);
      socket.off('room:pin', handlePinEvt);
    };
  }, [socket, activeRoomId, sessionEntryTime, user?.id]);

  useEffect(() => {
    if (!isUserScrolledUp) {
      chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, isUserScrolledUp]);

  const handleChatScroll = () => {
    const el = chatScrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setIsUserScrolledUp(distanceFromBottom > 120);
  };

  const scrollToLatestMessages = () => {
    setIsUserScrolledUp(false);
    chatStreamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !inputText.trim()) return;
    playChatSendSound();
    const payload: any = {
      roomId: activeRoomId,
      content: inputText.trim(),
      mediaType: 'text'
    };
    if (replyTo?.id) {
      payload.replyToId = replyTo.id;
    }
    socket.emit('room:message', payload);
    setInputText('');
    setReplyTo(null);
    setShowEmojiPicker(false);
  };

  const handleCopyMessage = async (content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      addToast('تم نسخ الرسالة', 'success');
    } catch {
      addToast('تعذر النسخ', 'error');
    }
    setMsgMenuId(null);
  };

  const handleDeleteMessage = (msgId: string) => {
    if (!socket) return;
    socket.emit('room:delete_message', { roomId: activeRoomId, msgId });
    setMsgMenuId(null);
  };

  const handleImageAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !socket) return;
    try {
      const uploaded = await uploadMediaFile(file);
      socket.emit('room:message', {
        roomId: activeRoomId,
        content: '',
        mediaUrl: uploaded.url,
        mediaType: uploaded.mimeType.startsWith('video/') ? 'video' : 'image'
      });
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const toggleVoiceClipRecording = async () => {
    if (!socket) return;
    if (recordingClip && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingClip(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      mediaRecorderRef.current = mr;
      audioChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `room_voice_${Date.now()}.webm`, { type: 'audio/webm' });
        try {
          const uploaded = await uploadMediaFile(file);
          socket.emit('room:message', {
            roomId: activeRoomId,
            content: 'رسالة صوتية 🎙️',
            mediaUrl: uploaded.url,
            mediaType: 'audio'
          });
        } catch (err: any) {
          addToast(err.message, 'error');
        }
      };
      mr.start();
      setRecordingClip(true);
    } catch {
      addToast('يرجى السماح بصلاحية الميكروفون لتسجيل مقطع صوتي.', 'error');
    }
  };

  const handleSelectRoom = (room: Room) => {
    if (room.is_private && room.owner_id !== user?.id && user?.role !== 'Owner' && user?.role !== 'Site Owner') {
      setPrivatePromptRoom(room);
      setPrivateRoomCodeInput(room.room_code || room.id);
      setPrivateRoomPwdInput('');
      return;
    }
    setActiveRoomId(room.id);
    setShowRoomsModal(false);
    setLeftNavOpen(false);
  };

  const handleVerifyPrivateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ roomId: string; name: string }>('/api/rooms/verify-private', {
        method: 'POST',
        body: JSON.stringify({
          roomCode: privateRoomCodeInput,
          password: privateRoomPwdInput
        })
      });
      setPrivatePromptRoom(null);
      setShowRoomsModal(false);
      setLeftNavOpen(false);
      setActiveRoomId(res.roomId);
      addToast(`تم الدخول إلى الغرفة الخاصة: ${res.name}`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await apiFetch<{ room: Room }>('/api/rooms', {
        method: 'POST',
        body: JSON.stringify({
          name: newRoomName,
          description: newRoomDesc,
          isPrivate: newRoomIsPrivate,
          roomCode: newRoomCode,
          password: newRoomPassword
        })
      });
      await refreshRooms();
      setShowCreateRoomModal(false);
      setNewRoomName('');
      setNewRoomDesc('');
      setNewRoomPassword('');
      setActiveRoomId(res.room.id);
      addToast(`تم إنشاء الغرفة "${res.room.name}" بنجاح!`, 'success');
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const handleModerateUserInRoom = async (
    targetUserId: string,
    actionType: 'mute' | 'kick' | 'ban' | 'unmute',
    durationMinutes: number = 60
  ) => {
    try {
      const mins = Math.max(0, Number(durationMinutes) || 0);
      await apiFetch(`/api/rooms/${activeRoomId}/moderate`, {
        method: 'POST',
        body: JSON.stringify({
          targetUserId,
          actionType,
          durationMinutes: actionType === 'mute' ? (mins > 0 ? mins : 5) : mins,
          reason: 'مخالفة نظام الغرفة'
        })
      });
      const labels: Record<string, string> = {
        mute: mins > 0 ? `تم كتم العضو لمدة ${mins} دقيقة` : 'تم كتم العضو',
        unmute: 'تم فك كتم العضو في الغرفة',
        kick: 'تم طرد العضو من الغرفة',
        ban: 'تم حظر العضو من الغرفة'
      };
      addToast(labels[actionType] || 'تم تنفيذ الإجراء داخل الغرفة بنجاح', 'success');
      setSelectedContextUser(null);
    } catch (err: any) {
      addToast(err.message, 'error');
    }
  };

  const isRoomModOrOwner =
    Boolean(user?.permissions?.can_moderate_chat) ||
    currentRoom?.owner_id === user?.id ||
    (user?.role === 'Owner' || user?.role === 'Site Owner');

  const canAccessAdmin = Boolean(user?.permissions?.can_access_admin || (user?.role === 'Owner' || user?.role === 'Site Owner'));

  const filteredOnlineUsers = onlineUsers.filter(
    (u) =>
      u.display_name.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.username.toLowerCase().includes(userSearch.toLowerCase())
  );

  // Helper to render Top-3 Podium Card
  const renderPodiumCard = (title: string, list: any[], borderAccent: string) => {
    const first = list[0];
    const second = list[1];
    const third = list[2];
    return (
      <div
        className={`rounded-2xl bg-white dark:bg-slate-900/95 border ${borderAccent} p-3 shadow-sm transition-colors`}
      >
        <div className="text-center text-xs font-extrabold text-amber-600 dark:text-amber-300 mb-2 flex items-center justify-center gap-1">
          <Crown className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
          <span>{title}</span>
        </div>

        {list.length === 0 ? (
          <div className="text-[11px] text-slate-400 dark:text-slate-500 text-center py-3">
            لا توجد بيانات تصنيف بعد
          </div>
        ) : (
          <div className="grid grid-cols-3 items-end gap-1.5 pt-1">
            {/* #2 Silver */}
            <div className="flex flex-col items-center text-center">
              {second ? (
                <div onClick={() => onOpenProfile(second.id)} className="cursor-pointer flex flex-col items-center">
                  <span className="text-[10px] font-bold text-slate-500 dark:text-slate-300 mb-0.5 font-mono-num">
                    🥈 2
                  </span>
                  <AvatarWithFrame
                    avatarUrl={second.avatar_url}
                    displayName={second.display_name}
                    gender={second.gender}
                    size="sm"
                  />
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-[68px] mt-1">
                    {second.display_name}
                  </span>
                </div>
              ) : (
                <div className="h-12" />
              )}
            </div>

            {/* #1 Gold Center */}
            <div className="flex flex-col items-center text-center -mt-2">
              {first && (
                <div onClick={() => onOpenProfile(first.id)} className="cursor-pointer flex flex-col items-center">
                  <span className="text-xs font-extrabold text-amber-500 dark:text-amber-400 mb-0.5">
                    👑 TOP 1
                  </span>
                  <AvatarWithFrame
                    avatarUrl={first.avatar_url}
                    displayName={first.display_name}
                    gender={first.gender}
                    activeFrame="ring-2 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]"
                    size="md"
                  />
                  <span className="text-[11px] font-extrabold text-amber-700 dark:text-amber-200 truncate max-w-[80px] mt-1">
                    {first.display_name}
                  </span>
                </div>
              )}
            </div>

            {/* #3 Bronze */}
            <div className="flex flex-col items-center text-center">
              {third ? (
                <div onClick={() => onOpenProfile(third.id)} className="cursor-pointer flex flex-col items-center">
                  <span className="text-[10px] font-bold text-amber-600 mb-0.5 font-mono-num">🥉 3</span>
                  <AvatarWithFrame
                    avatarUrl={third.avatar_url}
                    displayName={third.display_name}
                    gender={third.gender}
                    size="sm"
                  />
                  <span className="text-[10px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-[68px] mt-1">
                    {third.display_name}
                  </span>
                </div>
              ) : (
                <div className="h-12" />
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-[100dvh] w-full overflow-hidden bg-[#F8FAFC] dark:bg-[var(--nabd-bg)] text-slate-900 dark:text-slate-100 flex flex-col select-none transition-colors duration-200">
      {/* ====================================================================
          1. TOP NAVIGATION BAR (Matched to Video Design in Light & Dark Mode)
         ==================================================================== */}
      <header className="h-14 bg-violet-600 dark:bg-[var(--nabd-surface)] text-white border-b border-violet-700/60 dark:border-white/10 px-2 sm:px-4 flex items-center justify-between gap-2 shrink-0 z-30 shadow-md transition-colors">
        {/* يمين: القائمة + اسم الغرفة */}
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setLeftNavOpen(!leftNavOpen)}
            className="w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-white/10 text-white cursor-pointer shrink-0 flex items-center justify-center"
            title="القائمة"
            aria-label="فتح القائمة"
          >
            <Menu className="w-5 h-5" />
          </button>

          <button
            type="button"
            onClick={() => setShowRoomsModal(true)}
            className="flex items-center gap-1.5 text-sm font-extrabold text-white bg-white/15 hover:bg-white/25 dark:bg-white/10 px-3 h-10 rounded-xl cursor-pointer min-w-0"
            title="تغيير الغرفة"
          >
            {currentRoom?.is_private ? <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" /> : <Home className="w-4 h-4 shrink-0" />}
            <span className="truncate max-w-[110px] sm:max-w-[200px]">{currentRoom?.name || 'الغرفة العامة'}</span>
            <ChevronDown className="w-3.5 h-3.5 opacity-70 shrink-0" />
          </button>
        </div>

        {/* يسار: أهم الأزرار فقط — الباقي داخل القائمة */}
        <div className="flex items-center gap-1.5 shrink-0">
          {canAccessAdmin && (
            <button
              type="button"
              onClick={() => onOpenModal('admin')}
              className="hidden sm:flex h-10 px-3 rounded-xl bg-slate-950/80 border border-amber-400/40 text-amber-300 text-xs font-extrabold items-center gap-1 cursor-pointer"
              title="لوحة الإدارة"
            >
              <Shield className="w-4 h-4" />
              <span>الإدارة</span>
            </button>
          )}

          <button
            type="button"
            onClick={onNavigateLive}
            className="h-10 px-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-extrabold flex items-center gap-1.5 cursor-pointer active:scale-95"
            title="البث المباشر"
          >
            <Radio className="w-4 h-4 animate-pulse" />
            <span className="hidden sm:inline">بث مباشر</span>
            <span className="sm:hidden">LIVE</span>
          </button>

          <button
            type="button"
            onClick={handleOpenNotifs}
            className="relative w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-white/10 text-white flex items-center justify-center cursor-pointer"
            title="الإشعارات"
            aria-label="الإشعارات"
          >
            <Bell className="w-5 h-5" />
            {(user?.unreadNotifs || 0) > 0 && (
              <span className="absolute top-1.5 left-1.5 w-2.5 h-2.5 rounded-full bg-rose-500 ring-2 ring-violet-600 dark:ring-[var(--nabd-surface)]" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenModal('pm')}
            className="relative w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-white/10 text-white flex items-center justify-center cursor-pointer"
            title="الرسائل الخاصة"
            aria-label="الرسائل الخاصة"
          >
            <Mail className="w-5 h-5" />
            {(user?.unreadPm || 0) > 0 && (
              <span className="absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-extrabold flex items-center justify-center font-mono-num">
                {(user?.unreadPm || 0) > 99 ? '99+' : user?.unreadPm}
              </span>
            )}
          </button>

          {/* أزرار إضافية لسطح المكتب فقط */}
          <button
            type="button"
            onClick={() => onOpenModal('friends')}
            className="hidden md:flex relative w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-white/10 text-white items-center justify-center cursor-pointer"
            title="المتابعون والأصدقاء"
          >
            <UserPlus className="w-5 h-5" />
            {(user?.pendingFriendReqs || 0) > 0 && (
              <span className="absolute -top-1 -left-1 w-4 h-4 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center font-mono-num">
                {user?.pendingFriendReqs}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="hidden md:flex w-10 h-10 rounded-xl bg-white/15 hover:bg-white/25 dark:bg-white/10 text-white items-center justify-center cursor-pointer"
            title={theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
          >
            {theme === 'dark' ? <Sun className="w-5 h-5 text-amber-300" /> : <Moon className="w-5 h-5" />}
          </button>

          {user && (
            <div className="shrink-0">
              <AvatarWithFrame
                avatarUrl={user.avatar_url}
                displayName={user.display_name}
                gender={user.gender}
                activeFrame={user.active_frame}
                size="sm"
                showOnline
                onClick={() => onOpenProfile(user.id)}
              />
            </div>
          )}
        </div>
      </header>

            {/* Notifications Dropdown */}
      {showNotifs && (
        <div className="fixed top-16 left-4 right-4 sm:right-auto z-50 sm:w-80 max-h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
          <div className="p-3 bg-slate-100 dark:bg-slate-950 border-b border-slate-200 dark:border-white/10 flex items-center justify-between text-xs font-bold text-slate-900 dark:text-white">
            <span>الإشعارات والتنبيهات</span>
            <button
              type="button"
              onClick={() => setShowNotifs(false)}
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
            >
              إغلاق
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {notifsList.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-6">لا توجد إشعارات جديدة</p>
            ) : (
              notifsList.map((n) => (
                <div
                  key={n.id}
                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/5 text-xs space-y-1"
                >
                  <div className="font-bold text-amber-600 dark:text-amber-300">{n.title}</div>
                  <div className="text-slate-700 dark:text-slate-300">{n.body}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ====================================================================
          2. MAIN WORKSPACE (h-[calc(100vh-120px)] Stable Mobile Flex Layout)
         ==================================================================== */}
      <div className="flex-1 flex min-h-0 relative overflow-hidden">
        {/* Mobile Slide-Over Backdrop Overlay */}
        {leftNavOpen && (
          <div
            onClick={() => setLeftNavOpen(false)}
            className="fixed inset-0 z-30 bg-black/50 backdrop-blur-xs md:hidden"
          />
        )}

        {/* ==================================================================
            COLLAPSIBLE SLIDE-OVER SIDEBAR DRAWER (القائمة الجانبية)
            Contains all secondary actions on mobile + Theme Toggle
           ================================================================== */}
        {leftNavOpen && (
          <aside className="fixed md:relative inset-y-0 right-0 z-40 w-[82vw] max-w-sm md:w-72 bg-white dark:bg-[var(--nabd-surface)] border-l border-slate-200 dark:border-white/10 flex flex-col justify-between p-4 shadow-2xl transition-all">
            <div className="space-y-3.5 overflow-y-auto min-h-0 flex-1 pr-0.5">
              {/* Drawer Top Header (Mobile Close + Theme Switcher) */}
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-white/10">
                <span className="text-xs font-extrabold text-slate-500 dark:text-slate-400">
                  القائمة
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleTheme}
                    className="px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    title="تبديل المظهر"
                  >
                    {theme === 'dark' ? (
                      <>
                        <Sun className="w-3.5 h-3.5 text-amber-400" />
                        <span>الوضع النهاري</span>
                      </>
                    ) : (
                      <>
                        <Moon className="w-3.5 h-3.5 text-indigo-600" />
                        <span>الوضع الليلي</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setLeftNavOpen(false)}
                    className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Current Room Box */}
              <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">الغرفة الحالية</div>
                  <div className="text-sm font-extrabold text-slate-900 dark:text-white truncate">
                    {currentRoom?.name}
                  </div>
                  <div className="text-[10px] text-indigo-600 dark:text-indigo-300 font-mono-num">
                    Code: {currentRoom?.room_code}
                  </div>
                </div>
                {isRoomModOrOwner && (
                  <button
                    type="button"
                    onClick={() => {
                      if (currentRoom) {
                        setEditRoomName(currentRoom.name);
                        setEditRoomWelcome(currentRoom.welcome_message);
                        setEditRoomLocked(Boolean(currentRoom.is_locked));
                        setShowRoomSettings(true);
                        setLeftNavOpen(false);
                      }
                    }}
                    className="p-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/5 cursor-pointer shrink-0"
                    title="إعدادات الغرفة"
                  >
                    <Settings className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* أقسام منظمة: كل ميزة بنقرة واحدة */}
              {(() => {
                const go = (fn: () => void) => () => { setLeftNavOpen(false); fn(); };
                const groups: { title: string; items: { label: string; hint?: string; icon: React.ReactNode; onClick: () => void; badge?: number | string; tone?: string }[] }[] = [
                  {
                    title: 'تواصل',
                    items: [
                      { label: 'الرسائل الخاصة', icon: <Mail className="w-4 h-4 text-sky-500" />, onClick: go(() => onOpenModal('pm')), badge: user?.unreadPm || 0 },
                      { label: 'الأصدقاء والمتابعون', icon: <UserPlus className="w-4 h-4 text-emerald-500" />, onClick: go(() => onOpenModal('friends')), badge: user?.pendingFriendReqs || 0 },
                      { label: 'الإشعارات', icon: <Bell className="w-4 h-4 text-amber-500" />, onClick: go(handleOpenNotifs), badge: (user?.unreadNotifs || 0) > 0 ? 'جديد' : 0 },
                      { label: 'الغرف', hint: 'تنقّل بين الغرف أو أنشئ غرفتك', icon: <Home className="w-4 h-4 text-indigo-500" />, onClick: go(() => setShowRoomsModal(true)) },
                    ],
                  },
                  {
                    title: 'اكتشف',
                    items: [
                      { label: 'البث المباشر', icon: <Radio className="w-4 h-4 text-rose-500" />, onClick: go(onNavigateLive), tone: 'rose' },
                      { label: 'ريلز', icon: <Film className="w-4 h-4 text-sky-500" />, onClick: go(() => onOpenModal('reels')) },
                      { label: 'القصص', icon: <Sparkles className="w-4 h-4 text-pink-500" />, onClick: go(() => onOpenModal('stories')) },
                      { label: 'الحائط', icon: <Users className="w-4 h-4 text-emerald-500" />, onClick: go(() => onOpenModal('wall')) },
                      { label: 'الأخبار', icon: <Newspaper className="w-4 h-4 text-violet-500" />, onClick: go(() => onOpenModal('news')) },
                    ],
                  },
                  {
                    title: 'العب واربح',
                    items: [
                      { label: 'ارسم وخمّن', icon: <Palette className="w-4 h-4 text-fuchsia-500" />, onClick: go(() => onOpenModal('game')) },
                      { label: 'المتصدرون', icon: <Trophy className="w-4 h-4 text-amber-500" />, onClick: go(() => onOpenModal('rankings')) },
                      { label: 'المتجر', icon: <ShoppingBag className="w-4 h-4 text-amber-500" />, onClick: go(() => onOpenModal('store')) },
                    ],
                  },
                  {
                    title: 'حسابي',
                    items: [
                      ...(canAccessAdmin ? [{ label: 'لوحة الإدارة', icon: <Shield className="w-4 h-4 text-amber-500" />, onClick: go(() => onOpenModal('admin')), tone: 'amber' }] : []),
                      { label: 'ملفي الشخصي', icon: <UserIcon className="w-4 h-4 text-violet-500" />, onClick: go(() => user && onOpenProfile(user.id)) },
                      { label: 'الإعدادات', icon: <Settings className="w-4 h-4 text-slate-500" />, onClick: go(() => onOpenModal('settings')) },
                      { label: 'جولة سريعة', hint: 'تعرّف على الموقع', icon: <Sparkles className="w-4 h-4 text-violet-500" />, onClick: go(() => setShowTour(true)) },
                    ],
                  },
                ];
                return (
                  <nav className="space-y-4 text-sm font-bold">
                    {groups.map((g) => (
                      <div key={g.title}>
                        <div className="px-1 pb-1.5 text-[11px] font-extrabold text-slate-400 dark:text-slate-500">{g.title}</div>
                        <div className="space-y-0.5">
                          {g.items.map((it) => (
                            <button
                              key={it.label}
                              type="button"
                              onClick={it.onClick}
                              className={`w-full min-h-[44px] px-3 rounded-xl flex items-center gap-3 cursor-pointer transition-colors text-right ${
                                it.tone === 'rose'
                                  ? 'bg-rose-600/10 hover:bg-rose-600/20 text-rose-700 dark:text-rose-300'
                                  : it.tone === 'amber'
                                  ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300'
                                  : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-200'
                              }`}
                            >
                              <span className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">{it.icon}</span>
                              <span className="flex-1 min-w-0">
                                <span className="block truncate">{it.label}</span>
                                {it.hint && <span className="block text-[11px] font-medium text-slate-400 dark:text-slate-500 truncate">{it.hint}</span>}
                              </span>
                              {it.badge ? (
                                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold flex items-center justify-center font-mono-num">{it.badge}</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </nav>
                );
              })()}
            </div>
            {/* Wallet & XP Summary in Drawer Footer */}
            {user && (
              <div className="p-3.5 rounded-2xl bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 space-y-2 text-xs shrink-0 mt-3">
                <div className="flex items-center justify-between font-mono-num">
                  <span className="text-slate-600 dark:text-slate-400 font-bold">المستوى {user.level}</span>
                  <span className="text-indigo-600 dark:text-indigo-300 font-extrabold">{user.xp} XP</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-300 dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 dark:bg-indigo-500"
                    style={{ width: `${user.levelProgress?.progressPercent || 0}%` }}
                  />
                </div>
                <div className="flex items-center justify-between pt-1 font-mono-num font-extrabold">
                  <span className="text-amber-600 dark:text-amber-300">🪙 {user.gold} Gold</span>
                  <span className="text-cyan-600 dark:text-cyan-300">💎 {user.gems} Gems</span>
                </div>
              </div>
            )}
          </aside>
        )}

        {/* ==================================================================
            CENTER MAIN CHAT ROOM AREA (Floating Voice Seats + Messages + Input)
           ================================================================== */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 relative bg-[#F8FAFC] dark:bg-[var(--nabd-bg)] transition-colors">
          {/* Subtle Room Banner Wallpaper */}
          {currentRoom?.banner_url && (
            <div className="absolute inset-0 pointer-events-none opacity-10">
              <img
                src={currentRoom.banner_url}
                alt=""
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
            </div>
          )}

          {/* FLOATING VOICE SEATS PILL BAR */}
          <div className="relative z-20 flex flex-col items-center pt-2 px-2 sm:px-3 shrink-0">
            {!seatsCollapsed && (
              <div className="px-3 sm:px-4 py-2 rounded-full bg-white/95 dark:bg-slate-900/90 border border-slate-200 dark:border-white/15 backdrop-blur-xl shadow-lg flex items-center gap-1.5 sm:gap-3 max-w-full overflow-x-auto no-scrollbar transition-colors">
                {/* Headphones Listen Toggle */}
                <button
                  type="button"
                  onClick={() => setIsListeningRoomAudio(!isListeningRoomAudio)}
                  className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all cursor-pointer shrink-0 ${
                    isListeningRoomAudio
                      ? 'bg-rose-500/15 border-rose-400 text-rose-600 dark:text-rose-300'
                      : 'bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-white/10 text-slate-500'
                  }`}
                  title={isListeningRoomAudio ? 'كتم الصوت الصادر من المقاعد' : 'تشغيل الاستماع للمقاعد'}
                >
                  {isListeningRoomAudio ? (
                    <Headphones className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>

                {/* 5 Voice Seats */}
                {seats.map((seat) => {
                  const isOccupied = Boolean(seat.userId);
                  const isMine = seat.userId === user?.id;
                  return (
                    <div key={seat.seatIndex} className="relative flex flex-col items-center shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (!socket) return;
                          if (isMine) {
                            socket.emit('room:seat:action', {
                              roomId: activeRoomId,
                              seatIndex: seat.seatIndex,
                              action: 'leave'
                            });
                          } else if (!isOccupied) {
                            socket.emit('room:seat:action', {
                              roomId: activeRoomId,
                              seatIndex: seat.seatIndex,
                              action: 'join'
                            });
                          } else if (seat.userId) {
                            onOpenProfile(seat.userId);
                          }
                        }}
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center border transition-all cursor-pointer relative ${
                          isOccupied
                            ? seat.isSpeaking
                              ? 'border-emerald-500 ring-2 ring-emerald-400/60'
                              : 'border-indigo-500 dark:border-indigo-400'
                            : seat.isLocked
                            ? 'bg-amber-500/10 dark:bg-slate-950 border-amber-500/40 text-amber-600 dark:text-amber-400'
                            : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-950/90 dark:hover:bg-slate-800 border-slate-300 dark:border-white/15 text-slate-700 dark:text-slate-200'
                        }`}
                        title={
                          isOccupied
                            ? `${seat.displayName} (${isMine ? 'اضغط للنزول من المقعد' : 'اضغط لعرض البروفايل'})`
                            : `صعود للمقعد الصوتي ${seat.seatIndex + 1}`
                        }
                      >
                        {isOccupied ? (
                          <AvatarWithFrame
                            avatarUrl={seat.avatarUrl}
                            displayName={seat.displayName}
                            gender={seat.gender}
                            size="sm"
                            isSpeaking={seat.isSpeaking}
                          />
                        ) : seat.isLocked ? (
                          <Lock className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        ) : (
                          <Mic className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                      </button>

                      {isOccupied && (
                        <span className="text-[9px] font-bold text-slate-700 dark:text-slate-200 truncate max-w-[46px] mt-0.5">
                          {seat.displayName}
                        </span>
                      )}

                      {isMine && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            socket?.emit('room:seat:action', {
                              roomId: activeRoomId,
                              seatIndex: seat.seatIndex,
                              action: 'toggle_mute'
                            });
                          }}
                          className={`mt-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold cursor-pointer ${
                            seat.isMuted ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'
                          }`}
                        >
                          {seat.isMuted ? 'مكتوم' : 'نشط'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Collapse/Expand Handle */}
            <button
              type="button"
              onClick={() => setSeatsCollapsed(!seatsCollapsed)}
              className="mt-1 px-3 py-0.5 rounded-b-xl bg-white/90 dark:bg-slate-900/90 border border-t-0 border-slate-200 dark:border-white/15 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs cursor-pointer transition-colors"
            >
              {seatsCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </button>
          </div>

          {micError && (
            <div className="mx-3 mt-1.5 p-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-700 dark:text-rose-200 text-xs text-center z-20 shrink-0">
              {micError}
            </div>
          )}

          {/* Room Welcome Banner */}
          {currentRoom?.welcome_message && (
            <div className="mx-3 mt-1.5 px-3.5 py-2 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-slate-200 dark:border-white/5 text-xs text-indigo-700 dark:text-indigo-200 flex items-center justify-between gap-2 z-10 shrink-0 transition-colors">
              <span className="truncate">📣 {currentRoom.welcome_message}</span>
              {currentRoom.is_locked ? (
                <span className="text-rose-600 dark:text-rose-400 font-bold flex items-center gap-1 shrink-0">
                  <Lock className="w-3.5 h-3.5" /> الغرفة مقفلة
                </span>
              ) : null}
            </div>
          )}

          {/* CHAT MESSAGES STREAM (Stable Flex-1 Scrollable Area with Native Mobile Touch Momentum) */}
          <div
            ref={chatScrollContainerRef}
            onScroll={handleChatScroll}
            className="flex-1 min-h-0 overflow-y-auto touch-pan-y overscroll-contain p-2.5 sm:p-3 space-y-2 z-10 select-text"
          >
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 text-xs space-y-1 text-center px-4">
                <p>لا توجد رسائل في هذه الغرفة بعد.</p>
                <p>ابدأ الحديث الآن واحصل على نقاط XP وعملات ذهبية مع تفاعلك!</p>
              </div>
            ) : (
              messages.map((msg) => {
                if (msg.is_system) {
                  return (
                    <div
                      key={msg.id}
                      className={`px-2.5 py-1.5 rounded-xl border flex items-center justify-between gap-2 text-xs ${
                        msg.hasRoyalEntry
                          ? 'bg-gradient-to-r from-amber-500/20 via-purple-500/15 to-white dark:to-slate-900 border-amber-400/50 text-amber-800 dark:text-amber-200'
                          : 'bg-white/90 dark:bg-slate-900/70 border-slate-200 dark:border-white/5 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <AvatarWithFrame
                          avatarUrl={msg.avatar_url}
                          displayName={msg.display_name}
                          size="xs"
                          onClick={() => onOpenProfile(msg.user_id)}
                        />
                        <span className="font-extrabold text-slate-900 dark:text-white shrink-0">
                          {msg.display_name} :
                        </span>
                        <span className="font-semibold truncate">{msg.content}</span>
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono-num shrink-0">
                        {new Date(msg.created_at).toLocaleTimeString('ar-SA', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  );
                }

                const isMentionedForMe =
                  Boolean(user) &&
                  !msg.is_system &&
                  Boolean(msg.content) &&
                  (msg.content.includes(`@${user!.username}`) ||
                    msg.content.includes(`@${user!.display_name}`) ||
                    (msg.mentioned_usernames || '')
                      .split(',')
                      .map((s) => s.trim().toLowerCase())
                      .includes((user!.username || '').toLowerCase()));
                const isDeleted = Boolean(msg.is_deleted);

                return (
                  <div
                    key={msg.id}
                    onClick={() => setActionMsgId((cur) => (cur === msg.id ? null : msg.id))}
                    className={`group chat-msg-row px-2.5 py-1.5 rounded-xl border transition-colors cursor-pointer ${
                      isDeleted
                        ? 'msg-deleted bg-slate-100/80 dark:bg-slate-900/50 border-slate-200/50 dark:border-white/5'
                        : isMentionedForMe
                          ? 'msg-mention-me bg-blue-50/90 dark:bg-blue-950/30 border-blue-300/40 dark:border-blue-500/30'
                          : 'bg-white hover:bg-slate-50/90 dark:bg-slate-900/85 dark:hover:bg-slate-900 border-slate-200/80 dark:border-white/5'
                    }`}
                  >
                    <div className="chat-msg-main flex items-start gap-2">
                      <AvatarWithFrame
                        avatarUrl={msg.avatar_url}
                        displayName={msg.display_name}
                        gender={msg.gender}
                        activeFrame={msg.active_frame}
                        size="sm"
                        onClick={() => setSelectedContextUser(msg)}
                      />

                      <div className="min-w-0 flex-1">
                        {/* User Header Row: Role / VIP Badge + Name + Level */}
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0 mb-0.5">
                          {(msg.active_badge || msg.role_label) && (
                            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-300">
                              {msg.active_badge || msg.role_label}
                            </span>
                          )}
                          <span aria-hidden="true" className="text-slate-400 dark:text-slate-600">
                            ·
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedContextUser(msg)}
                            className="text-[13px] font-extrabold hover:underline cursor-pointer"
                            onClickCapture={(e) => e.stopPropagation()}
                            style={{
                              color: resolveLegibleColor(msg.name_color, '#FFFFFF', '#0F172A')
                            }}
                          >
                            {msg.display_name}
                          </button>
                          <span className="text-[10px] text-slate-500 dark:text-slate-400 font-mono-num">
                            Lv.{msg.level}
                          </span>
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono-num mr-auto">
                            {new Date(msg.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {/* Reply preview */}
                        {msg.reply_to_id && msg.replyPreview && (
                          <div className="mb-1.5 px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-black/30 border-r-2 border-violet-500 text-[11px] text-slate-500 dark:text-slate-400">
                            <span className="font-bold text-violet-600 dark:text-violet-400">↩️ {msg.replyPreview.username}</span>
                            <span className="mr-1 truncate">{msg.replyPreview.content}</span>
                          </div>
                        )}
                        {/* Message Body */}
                        {isDeleted ? (
                          <p className="text-sm text-slate-400 italic">تم حذف هذه الرسالة</p>
                        ) : (
                          msg.content && (
                            <p
                              className="chat-msg-text font-medium"
                              style={{
                                color: resolveLegibleColor(msg.font_color, '#F1F5F9', '#1E293B')
                              }}
                            >
                              {msg.content}
                            </p>
                          )
                        )}
                        {isMentionedForMe && !isDeleted && (
                          <span className="inline-block mt-1 text-[10px] font-bold text-blue-500 dark:text-blue-400">🔵 تم ذكرك</span>
                        )}

                        {(msgReactions[msg.id] || []).length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {msgReactions[msg.id].map((r) => (
                              <button
                                key={r.emoji}
                                type="button"
                                onClick={() => socket?.emit('room:react', { roomId: activeRoomId, messageId: msg.id, emoji: r.emoji })}
                                className="px-1.5 py-0.5 rounded-full bg-white/10 text-[11px]"
                              >
                                {r.emoji} {r.count}
                              </button>
                            ))}
                          </div>
                        )}
                        {msg.media_url && msg.media_type === 'gif' && (
                          <img
                            src={msg.media_url}
                            alt="GIF"
                            className="mt-1.5 max-h-40 max-w-full rounded-lg object-contain border border-slate-200 dark:border-white/10"
                            loading="lazy"
                          />
                        )}
                        {msg.media_url && msg.media_type === 'image' && (
                          <img
                            src={msg.media_url}
                            alt="صورة مرفقة"
                            referrerPolicy="no-referrer"
                            className="mt-1.5 max-h-48 max-w-full rounded-lg object-cover border border-slate-200 dark:border-white/10 cursor-zoom-in"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.dispatchEvent(new CustomEvent('nabd-lightbox', { detail: msg.media_url }));
                            }}
                          />
                        )}

                        {msg.media_url && msg.media_type === 'video' && (
                          <video src={msg.media_url} controls className="mt-1.5 max-h-48 max-w-full rounded-lg" />
                        )}

                        {msg.media_url && msg.media_type === 'audio' && (
                          <audio src={msg.media_url} controls className="mt-2 h-9 w-56 max-w-full" />
                        )}
                      </div>
                    </div>

                    {/* أدوات الرسالة: تظهر بالضغط على الرسالة */}
                    <div className={`chat-msg-actions w-full ${actionMsgId === msg.id ? 'block' : 'hidden sm:group-hover:block'}`} onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center gap-1.5 pt-1.5 mt-1 border-t border-slate-200/70 dark:border-white/5 nabd-sheet-in">
                        <button
                          type="button"
                          onClick={() => {
                            setReplyTo({
                              id: msg.id,
                              username: msg.display_name || msg.username,
                              content: (msg.content || '').slice(0, 80)
                            });
                            setInputText((prev) =>
                              prev.includes(`@${msg.display_name}`)
                                ? prev
                                : `@${msg.display_name} ${prev}`
                            );
                          }}
                          className="px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-600 hover:text-white text-[10px] font-bold cursor-pointer flex items-center gap-0.5"
                          title="رد على الرسالة"
                        >
                          <Reply className="w-3 h-3" /> رد
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.content || '')}
                          className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-500 cursor-pointer"
                          title="نسخ"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        {isRoomModOrOwner && (
                          <button
                            type="button"
                            onClick={() => socket?.emit('room:pin', { roomId: activeRoomId, messageId: msg.id })}
                            className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[10px] font-bold cursor-pointer"
                            title="تثبيت"
                          >
                            📌
                          </button>
                        )}
                        <div className="flex items-center gap-0.5">
                          {REACTION_EMOJIS.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => socket?.emit('room:react', { roomId: activeRoomId, messageId: msg.id, emoji: em })}
                              className="text-xs opacity-70 hover:opacity-100 cursor-pointer"
                              title="تفاعل"
                            >
                              {em}
                            </button>
                          ))}
                        </div>
                        {isRoomModOrOwner && (
                          <button
                            type="button"
                            onClick={() =>
                              apiFetch(`/api/rooms/${activeRoomId}/messages/${msg.id}`, {
                                method: 'DELETE'
                              })
                            }
                            className="p-1 rounded bg-rose-600/15 text-rose-600 dark:text-rose-300 hover:bg-rose-600 hover:text-white cursor-pointer"
                            title="حذف الرسالة"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onOpenReport('message', msg.id)}
                          className="p-1 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-rose-500 cursor-pointer"
                          title="إبلاغ عن الرسالة"
                        >
                          <Flag className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={chatStreamEndRef} />
          </div>

          {isUserScrolledUp && (
            <button
              type="button"
              onClick={scrollToLatestMessages}
              className="absolute bottom-16 left-1/2 -translate-x-1/2 z-30 px-3.5 py-1.5 rounded-full bg-indigo-600/95 hover:bg-indigo-500 text-white text-xs font-extrabold shadow-lg flex items-center gap-1.5 cursor-pointer"
            >
              <ChevronDown className="w-4 h-4" />
              <span>النزول لأحدث الرسائل</span>
            </button>
          )}

          {/* BOTTOM CHAT INPUT BAR */}
          <div className="relative z-20 shrink-0 safe-bottom">
            {typingUsers.length > 0 && (
              <div className="px-3 py-1 text-[11px] text-violet-300/90 font-medium">
                {typingUsers.map((u) => u.displayName).join('، ')} يكتب...
              </div>
            )}
            {mentionQuery !== null && onlineUsers.length > 0 && (
              <div className="mx-2 mb-1 max-h-32 overflow-y-auto rounded-xl bg-[var(--nabd-surface)] border border-white/10 shadow-lg z-30">
                {onlineUsers
                  .filter((u: any) =>
                    (u.username || '').toLowerCase().includes(mentionQuery.toLowerCase()) ||
                    (u.display_name || '').toLowerCase().includes(mentionQuery.toLowerCase())
                  )
                  .slice(0, 6)
                  .map((u: any) => (
                    <button
                      key={u.id}
                      type="button"
                      className="w-full text-right px-3 py-1.5 text-xs hover:bg-violet-600/30 text-white"
                      onClick={() => {
                        setInputText((prev) => prev.replace(/@[\w\u0600-\u06FF]*$/, `@${u.username} `));
                        setMentionQuery(null);
                      }}
                    >
                      <span className="font-bold">{u.display_name}</span>
                      <span className="text-white/40 mr-2">@{u.username}</span>
                    </button>
                  ))}
              </div>
            )}
            <div className="px-2 pb-1 flex gap-1 overflow-x-auto no-scrollbar">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    if (q.length <= 2) {
                      // emoji quick: append
                      setInputText((prev) => prev + q);
                    } else if (socket && activeRoomId) {
                      socket.emit('room:message', { roomId: activeRoomId, content: q, mediaType: 'text' });
                    }
                  }}
                  className="shrink-0 px-2 py-0.5 rounded-full bg-white/5 hover:bg-violet-600/30 text-[11px] text-white/70 border border-white/5"
                >
                  {q}
                </button>
              ))}
            </div>
            {showEmojiPicker && (
              <div className="absolute bottom-full left-2 right-2 mb-1 z-40">
                <EmojiPicker
                  onSelect={(emoji) => {
                    setInputText((prev) => prev + emoji);
                  }}
                  onClose={() => setShowEmojiPicker(false)}
                />
              </div>
            )}
            {showGifPicker && (
              <div className="absolute bottom-full left-2 right-2 mb-1 z-40">
                <GifPicker
                  onSelect={(g) => {
                    if (!socket) return;
                    socket.emit('room:message', {
                      roomId: activeRoomId,
                      content: g.title || 'GIF',
                      mediaUrl: g.url,
                      mediaType: 'gif'
                    });
                    setShowGifPicker(false);
                  }}
                  onClose={() => setShowGifPicker(false)}
                />
              </div>
            )}
            {replyTo && (
              <div className="mx-2 mb-1 px-3 py-2 rounded-xl bg-violet-500/10 border border-violet-500/30 flex items-center justify-between gap-2">
                <div className="min-w-0 text-xs">
                  <span className="font-bold text-violet-500">الرد على @{replyTo.username}</span>
                  <p className="text-slate-500 dark:text-slate-400 truncate">{replyTo.content}</p>
                </div>
                <button type="button" onClick={() => setReplyTo(null)} className="text-slate-400 hover:text-white shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            <form
              onSubmit={handleSendMessage}
              className="p-2 sm:p-3 bg-white dark:bg-[var(--nabd-surface)] border-t border-slate-200 dark:border-white/10 flex items-center gap-1.5 sm:gap-2 transition-colors"
            >
              <button
                type="submit"
                className="w-10 h-10 rounded-full bg-violet-600 hover:bg-violet-500 text-white flex items-center justify-center shrink-0 shadow-md cursor-pointer"
                title="إرسال"
              >
                <Send className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => { setShowEmojiPicker((v) => !v); setShowGifPicker(false); }}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                  showEmojiPicker
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-500'
                }`}
                title="إيموجي"
              >
                <Smile className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => { setShowGifPicker((v) => !v); setShowEmojiPicker(false); }}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer text-[10px] font-extrabold transition-colors ${
                  showGifPicker
                    ? 'bg-violet-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sky-500'
                }`}
                title="GIF"
              >
                GIF
              </button>

              <button
                type="button"
                onClick={toggleVoiceClipRecording}
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 cursor-pointer transition-colors ${
                  recordingClip
                    ? 'bg-rose-600 text-white animate-pulse'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400'
                }`}
                title="تسجيل رسالة صوتية"
              >
                {recordingClip ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>

              <label
                className="w-10 h-10 rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
                title="إرفاق صورة أو فيديو"
              >
                <ImageIcon className="w-4 h-4" />
                <input type="file" accept="image/*,video/*" onChange={handleImageAttachment} className="hidden" />
              </label>

              <input
                type="text"
                value={inputText}
                onChange={(e) => {
                  const v = e.target.value;
                  setInputText(v);
                  // منشن
                  const at = v.match(/@([\w\u0600-\u06FF]*)$/);
                  setMentionQuery(at ? at[1] : null);
                  // يكتب الآن
                  if (socket && activeRoomId) {
                    socket.emit('room:typing', { roomId: activeRoomId });
                  }
                }}
                placeholder={replyTo ? `رد على @${replyTo.username}...` : 'اكتب رسالتك هنا...'}
                className="flex-1 min-w-0 px-4 py-2.5 rounded-full bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-500 transition-colors"
              />
            </form>
          </div>
        </main>

        {/* ==================================================================
            ONLINE USERS & TOP PODIUMS SIDEBAR
           ================================================================== */}
        {rightUsersOpen && (
          <>
            <div
              onClick={() => setRightUsersOpen(false)}
              className="fixed inset-0 z-20 bg-black/40 backdrop-blur-xs md:hidden"
            />
            <aside className="fixed md:relative inset-y-0 left-0 z-30 w-72 sm:w-80 bg-slate-50 dark:bg-[var(--nabd-surface)] border-r border-slate-200 dark:border-white/10 flex flex-col shadow-2xl transition-colors">
              {/* Search & Filter Header */}
              <div className="p-2.5 border-b border-slate-200 dark:border-white/10 flex items-center gap-2 bg-white dark:bg-slate-950/60">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 absolute right-3 top-2.5" />
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="بحث في المتصلين..."
                    className="w-full pr-8 pl-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white placeholder-slate-400"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setRightUsersOpen(false)}
                  className="md:hidden p-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y overscroll-contain p-3 space-y-3">
                {/* Top 3 Podium Cards: تفاعل الإدارة & تفاعل الأعضاء */}
                {renderPodiumCard('تفاعل الإدارة 👑', podiums.topStaff, 'border-amber-500/30')}
                {renderPodiumCard('تفاعل الأعضاء 🏆', podiums.topMembers, 'border-indigo-500/30')}

                {/* Online Users Count Header */}
                <div className="flex items-center justify-between px-1 pt-2">
                  <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                    المتصلين الآن في الغرفة
                  </span>
                  <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/40 text-sky-700 dark:text-sky-300 text-xs font-extrabold font-mono-num">
                    {onlineUsers.length}
                  </span>
                </div>

                {/* Online Users List */}
                <div className="space-y-1.5">
                  {filteredOnlineUsers.map((u) => (
                    <div
                      key={u.id}
                      onClick={() => setSelectedContextUser(u)}
                      className="p-2.5 rounded-2xl bg-white hover:bg-slate-100 dark:bg-slate-900/90 dark:hover:bg-slate-800 border border-slate-200/80 dark:border-white/5 flex items-center justify-between cursor-pointer transition-colors shadow-2xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <AvatarWithFrame
                          avatarUrl={u.avatar_url}
                          displayName={u.display_name}
                          gender={u.gender}
                          activeFrame={u.active_frame}
                          size="sm"
                          showOnline
                        />
                        <div className="min-w-0">
                          <div
                            className="text-xs font-extrabold truncate"
                            style={{
                              color: resolveLegibleColor(u.name_color, '#FFFFFF', '#0F172A')
                            }}
                          >
                            {u.display_name}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                            {u.active_badge || u.roleLabel} · Lv.{u.level}
                          </div>
                        </div>
                      </div>

                      <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                        {u.country}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </>
        )}
      </div>

      {/* ====================================================================
          3. BOTTOM ACTION BAR (Firmly Docked: المتجر | تحديث | بروفايل | الغرف | أعضاء)
         ==================================================================== */}
      <footer className="bg-white dark:bg-[var(--nabd-surface)] border-t border-slate-200 dark:border-white/10 px-2 pt-1.5 flex items-stretch justify-around gap-1 shrink-0 z-30 transition-colors pb-safe">
        {[
          { label: 'الغرف', icon: <Home className="w-5 h-5" />, onClick: () => setShowRoomsModal(true), active: false },
          { label: `المتصلون ${onlineUsers.length}`, icon: <Users className="w-5 h-5" />, onClick: () => setRightUsersOpen(!rightUsersOpen), active: rightUsersOpen },
          { label: 'المتجر', icon: <ShoppingBag className="w-5 h-5" />, onClick: () => onOpenModal('store'), active: false },
          { label: 'حسابي', icon: <UserIcon className="w-5 h-5" />, onClick: () => user && onOpenProfile(user.id), active: false },
          {
            label: 'تحديث',
            icon: <RefreshCw className="w-5 h-5" />,
            onClick: () => {
              refreshRooms();
              loadPodiums();
              addToast('تم التحديث', 'info');
            },
            active: false
          }
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.onClick}
            className={`flex-1 min-h-[52px] rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer transition-colors ${
              b.active
                ? 'text-violet-600 dark:text-violet-300 bg-violet-500/10'
                : 'text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-300'
            }`}
          >
            {b.icon}
            <span className="text-[11px] font-bold leading-none">{b.label}</span>
          </button>
        ))}
      </footer>

      {showTour && (
        <div className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={closeTour}>
          <div onClick={(e) => e.stopPropagation()} className="nabd-sheet-in w-full max-w-sm rounded-3xl bg-white dark:bg-[var(--nabd-surface)] border border-slate-200 dark:border-white/10 p-5 space-y-4 shadow-2xl" dir="rtl">
            <div className="text-center space-y-1">
              <div className="text-3xl">👋</div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">أهلاً بك في نبض المجالس</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">ثلاث خطوات تكفي للبدء</p>
            </div>
            <ul className="space-y-2.5 text-sm">
              {[
                ['💬', 'اكتب في الأسفل', 'شارك في الدردشة. اضغط على أي رسالة لترد أو تتفاعل.'],
                ['🎙️', 'اصعد إلى مقعد', 'اضغط الميكروفون في الأعلى لتتحدث صوتياً مع الغرفة.'],
                ['☰', 'كل شيء في القائمة', 'الرسائل، البث، الريلز، الألعاب والمتجر في القائمة الجانبية.']
              ].map(([ic, t, d]) => (
                <li key={t} className="flex gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-white/5">
                  <span className="text-xl shrink-0">{ic}</span>
                  <div>
                    <div className="font-extrabold text-slate-900 dark:text-white text-[13px]">{t}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{d}</div>
                  </div>
                </li>
              ))}
            </ul>
            <button type="button" onClick={closeTour} className="w-full min-h-[46px] rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-extrabold cursor-pointer">
              ابدأ الآن
            </button>
          </div>
        </div>
      )}

      {/* ====================================================================
          USER CONTEXT MENU POPOVER
         ==================================================================== */}
      {selectedContextUser && (
        <div
          onClick={() => setSelectedContextUser(null)}
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl w-full max-w-sm max-h-[90dvh] overflow-y-auto shadow-2xl"
          >
            <div className="p-4 bg-slate-50 dark:bg-slate-950 flex items-center justify-between border-b border-slate-200 dark:border-white/10">
              <div className="flex items-center gap-2.5">
                <AvatarWithFrame
                  avatarUrl={selectedContextUser.avatar_url}
                  displayName={selectedContextUser.display_name}
                  gender={selectedContextUser.gender}
                  size="md"
                />
                <div>
                  <div className="text-sm font-bold text-slate-900 dark:text-white">
                    {selectedContextUser.display_name}
                  </div>
                  <div className="text-[11px] text-amber-600 dark:text-amber-300">
                    المستوى {selectedContextUser.level}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedContextUser(null)}
                className="p-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 space-y-1 text-xs font-bold">
              <button
                type="button"
                onClick={() => {
                  const uid = selectedContextUser.user_id || selectedContextUser.id;
                  setSelectedContextUser(null);
                  onOpenProfile(uid);
                }}
                className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer"
              >
                <span>عرض الملف الشخصي ومعلومات المستوى</span>
                <UserIcon className="w-4 h-4 text-sky-500 dark:text-sky-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  const uid = selectedContextUser.user_id || selectedContextUser.id;
                  setSelectedContextUser(null);
                  onOpenModal('pm', uid);
                }}
                className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 flex items-center justify-between cursor-pointer"
              >
                <span>محادثة خاصة</span>
                <Mail className="w-4 h-4 text-emerald-500 dark:text-emerald-400" />
              </button>

              <button
                type="button"
                onClick={() => {
                  const uid = selectedContextUser.user_id || selectedContextUser.id;
                  const uname = selectedContextUser.display_name;
                  setSelectedContextUser(null);
                  onOpenGift(uid, uname, activeRoomId);
                }}
                className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-amber-600 dark:text-amber-300 flex items-center justify-between cursor-pointer"
              >
                <span>إهداء هدية</span>
                <Gift className="w-4 h-4 text-amber-500 dark:text-amber-400" />
              </button>

              {(selectedContextUser.user_id || selectedContextUser.id) !== user?.id && (
                <button
                  type="button"
                  onClick={async () => {
                    const uid = selectedContextUser.user_id || selectedContextUser.id;
                    try {
                      const res = await apiFetch<{ isFollowing: boolean; message: string }>('/api/follows/toggle', {
                        method: 'POST',
                        body: JSON.stringify({ targetUserId: uid })
                      });
                      addToast(res.message, 'success');
                      setSelectedContextUser(null);
                    } catch (err: any) {
                      addToast(err.message, 'error');
                    }
                  }}
                  className="w-full p-2.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-rose-600 dark:text-rose-400 flex items-center justify-between cursor-pointer"
                >
                  <span>متابعة العضو / رد المتابعة</span>
                  <UserPlus className="w-4 h-4 text-rose-500 dark:text-rose-400" />
                </button>
              )}

              {isRoomModOrOwner && (selectedContextUser.user_id || selectedContextUser.id) !== user?.id && (
                <div className="pt-2 mt-2 border-t border-slate-200 dark:border-white/10 space-y-1">
                  <div className="px-2 text-[10px] text-slate-400 dark:text-slate-500">أدوات إشراف الغرفة</div>
                  <div className="px-2 py-1.5 text-[10px] font-bold text-amber-600/80 dark:text-amber-300/80">كتم في الغرفة</div>
                  <div className="grid grid-cols-3 gap-1 px-2 pb-2">
                    {[
                      { m: 1, l: '1د' },
                      { m: 5, l: '5د' },
                      { m: 15, l: '15د' },
                      { m: 30, l: '30د' },
                      { m: 60, l: '1س' },
                      { m: 1440, l: '24س' }
                    ].map((d) => (
                      <button
                        key={d.m}
                        type="button"
                        onClick={() => {
                          handleModerateUserInRoom(
                            selectedContextUser.user_id || selectedContextUser.id,
                            'mute',
                            d.m
                          );
                          setSelectedContextUser(null);
                        }}
                        className="py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-700 dark:text-amber-200 text-[11px] font-bold"
                      >
                        {d.l}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleModerateUserInRoom(
                        selectedContextUser.user_id || selectedContextUser.id,
                        'unmute'
                      )
                    }
                    className="w-full p-2 rounded-xl hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 flex items-center justify-between cursor-pointer"
                  >
                    <span>فك الكتم في الغرفة</span>
                    <Volume2 className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleModerateUserInRoom(selectedContextUser.user_id || selectedContextUser.id, 'kick')
                    }
                    className="w-full p-2 rounded-xl hover:bg-rose-500/20 text-rose-600 dark:text-rose-300 flex items-center justify-between cursor-pointer"
                  >
                    <span>طرد من الغرفة</span>
                    <X className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleModerateUserInRoom(selectedContextUser.user_id || selectedContextUser.id, 'ban')
                    }
                    className="w-full p-2 rounded-xl hover:bg-rose-600 text-rose-600 dark:text-rose-400 hover:text-white flex items-center justify-between cursor-pointer"
                  >
                    <span>حظر من الغرفة</span>
                    <Shield className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ====================================================================
          ROOMS DIRECTORY & PRIVATE ROOM ACCESS MODAL
         ==================================================================== */}
      {showRoomsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-white/10 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">قائمة الغرف العامة والخاصة</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRoomsModal(false);
                    setShowCreateRoomModal(true);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إنشاء غرفة جديدة</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRoomsModal(false)}
                  className="p-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Direct Join Private Room by Room ID + Password */}
            <form
              onSubmit={handleVerifyPrivateRoom}
              className="p-4 bg-slate-100/70 dark:bg-slate-950/60 border-b border-slate-200 dark:border-white/10 flex flex-wrap items-center gap-2"
            >
              <span className="text-xs font-bold text-amber-700 dark:text-amber-300 w-full mb-1">
                🔒 دخول سريع لغرفة خاصة بواسطة المعرّف (Room ID) وكلمة المرور:
              </span>
              <input
                type="text"
                required
                value={privateRoomCodeInput}
                onChange={(e) => setPrivateRoomCodeInput(e.target.value)}
                placeholder="معرّف الغرفة (Room ID)"
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white w-full sm:w-40"
              />
              <input
                type="password"
                required
                value={privateRoomPwdInput}
                onChange={(e) => setPrivateRoomPwdInput(e.target.value)}
                placeholder="كلمة مرور الغرفة"
                className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white flex-1 min-w-[140px]"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold cursor-pointer"
              >
                دخول الغرفة الخاصة
              </button>
            </form>

            {/* Rooms List */}
            <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {rooms.map((r) => (
                <div
                  key={r.id}
                  onClick={() => handleSelectRoom(r)}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between gap-2 ${
                    r.id === activeRoomId
                      ? 'bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 dark:border-indigo-400'
                      : 'bg-slate-50 dark:bg-slate-950/80 hover:bg-slate-100 dark:hover:bg-slate-800/80 border-slate-200 dark:border-white/10'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                        <span>{r.name}</span>
                        {r.is_private ? <Lock className="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" /> : null}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                        {r.description}
                      </p>
                    </div>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-bold font-mono-num shrink-0">
                      {r.onlineCount || 0} متصل
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-500 pt-2 border-t border-slate-200 dark:border-white/5 font-mono-num">
                    <span>Room ID: {r.room_code}</span>
                    <span>{r.is_private ? 'غرفة خاصة محمية' : 'غرفة عامة'}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PRIVATE ROOM PASSWORD PROMPT */}
      {privatePromptRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleVerifyPrivateRoom}
            className="bg-white dark:bg-slate-900 border border-amber-500/30 rounded-3xl max-w-sm w-full p-6 space-y-4"
          >
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              🔒 الغرفة "{privatePromptRoom.name}" محمية بكلمة مرور
            </h3>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                معرّف الغرفة (Room ID)
              </label>
              <input
                type="text"
                required
                value={privateRoomCodeInput}
                onChange={(e) => setPrivateRoomCodeInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">كلمة المرور</label>
              <input
                type="password"
                required
                value={privateRoomPwdInput}
                onChange={(e) => setPrivateRoomPwdInput(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-950 text-xs font-extrabold cursor-pointer"
              >
                تحقق ودخول
              </button>
              <button
                type="button"
                onClick={() => setPrivatePromptRoom(null)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* CREATE ROOM MODAL */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateRoom}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">إنشاء غرفة دردشة جديدة</h3>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">اسم الغرفة</label>
              <input
                type="text"
                required
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                placeholder="مثال: ديوانية الأصدقاء"
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">وصف الغرفة</label>
              <input
                type="text"
                value={newRoomDesc}
                onChange={(e) => setNewRoomDesc(e.target.value)}
                placeholder="وصف مختصر للغرفة..."
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-300 cursor-pointer">
              <input
                type="checkbox"
                checked={newRoomIsPrivate}
                onChange={(e) => setNewRoomIsPrivate(e.target.checked)}
              />
              <span>جعل الغرفة خاصة (محمية بـ Room ID وكلمة مرور)</span>
            </label>
            {newRoomIsPrivate && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">Room ID مخصص</label>
                  <input
                    type="text"
                    required
                    value={newRoomCode}
                    onChange={(e) => setNewRoomCode(e.target.value)}
                    placeholder="مثال: VIP-777"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">كلمة مرور الغرفة</label>
                  <input
                    type="password"
                    required
                    value={newRoomPassword}
                    onChange={(e) => setNewRoomPassword(e.target.value)}
                    placeholder="كلمة المرور"
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold cursor-pointer"
              >
                إنشاء الغرفة
              </button>
              <button
                type="button"
                onClick={() => setShowCreateRoomModal(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                إلغاء
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ROOM SETTINGS MODAL */}
      {showRoomSettings && currentRoom && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await apiFetch(`/api/rooms/${currentRoom.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    name: editRoomName,
                    welcomeMessage: editRoomWelcome,
                    isLocked: editRoomLocked
                  })
                });
                await refreshRooms();
                setShowRoomSettings(false);
                addToast('تم حفظ إعدادات الغرفة بنجاح', 'success');
              } catch (err: any) {
                addToast(err.message, 'error');
              }
            }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/15 rounded-3xl max-w-md w-full p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              إدارة إعدادات الغرفة ({currentRoom.name})
            </h3>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">اسم الغرفة</label>
              <input
                type="text"
                value={editRoomName}
                onChange={(e) => setEditRoomName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                رسالة الترحيب التلقائية
              </label>
              <input
                type="text"
                value={editRoomWelcome}
                onChange={(e) => setEditRoomWelcome(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 text-xs text-slate-900 dark:text-white"
              />
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-300 cursor-pointer">
              <input
                type="checkbox"
                checked={editRoomLocked}
                onChange={(e) => setEditRoomLocked(e.target.checked)}
              />
              <span>قفل الدردشة العامة في الغرفة (للمشرفين فقط)</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-xs font-bold cursor-pointer"
              >
                حفظ التغييرات
              </button>
              <button
                type="button"
                onClick={() => setShowRoomSettings(false)}
                className="px-4 py-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                إغلاق
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
