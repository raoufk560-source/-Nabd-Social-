import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Users, Play, Eraser, Pencil, Lock, Trash2, Eye, Clock, LogOut } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../services/api';

type Stroke = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  size: number;
  userId?: string;
};

const WORDS = [
  'قطة', 'شمس', 'قمر', 'بيت', 'سيارة', 'شجرة', 'كتاب', 'قلم', 'بحر', 'جبل',
  'تفاحة', 'موزة', 'كرة', 'هاتف', 'حاسوب', 'نجمة', 'وردة', 'طائر', 'سمكة', 'كأس',
  'طائرة', 'قطار', 'دراجة', 'مطعم', 'مدرسة', 'مستشفى', 'مسجد', 'كنيسة', 'حديقة', 'ملعب',
  'أسد', 'فيل', 'زرافة', 'دب', 'ثعلب', 'أرنب', 'فراشة', 'نحلة', 'سلحفاة', 'تمساح',
  'قهوة', 'شاي', 'خبز', 'بيتزا', 'برغر', 'آيسكريم', 'شوكولاتة', 'برتقالة', 'عنب', 'بطيخ',
  'ساعة', 'نظارة', 'حقيبة', 'حذاء', 'قبعة', 'مظلة', 'مصباح', 'كرسي', 'طاولة', 'سرير',
  'مطر', 'ثلج', 'ريح', 'سحابة', 'قوس قزح', 'بركان', 'صحراء', 'غابة', 'نهر', 'شلال'
];

function wordHint(word: string): string {
  if (!word) return '';
  return word
    .split('')
    .map((ch) => (ch === ' ' ? '  ' : '_'))
    .join(' ');
}

export const DrawGameModal: React.FC<{ onClose: () => void; onBack?: () => void }> = ({
  onClose,
  onBack
}) => {
  const { user, socket, addToast } = useApp();
  const [rooms, setRooms] = useState<any[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [guess, setGuess] = useState('');
  const [chat, setChat] = useState<{ text: string; kind?: string }[]>([]);
  const [color, setColor] = useState('#ffffff');
  const [size, setSize] = useState(4);
  const [createName, setCreateName] = useState('');
  const [createPrivate, setCreatePrivate] = useState(false);
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const isDrawer = room?.drawer_id === user?.id;
  const isHost = room?.host_id === user?.id;
  const playing = room?.status === 'playing';

  const loadRooms = useCallback(async () => {
    try {
      const r = await apiFetch<{ rooms: any[] }>('/api/games');
      setRooms(r.rooms || []);
    } catch {
      setRooms([]);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    const t = setInterval(loadRooms, 8000);
    return () => clearInterval(t);
  }, [loadRooms]);

  const paintStroke = useCallback((s: Stroke) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = s.color || '#fff';
    ctx.lineWidth = s.size || 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  }, []);

  const clearCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0b0b12';
    ctx.fillRect(0, 0, c.width, c.height);
  }, []);

  useEffect(() => {
    if (!socket || !gameId) return;
    socket.emit('game:join', { gameId });

    const onSync = (p: { gameId: string; strokes: Stroke[] }) => {
      if (p.gameId !== gameId) return;
      clearCanvas();
      (p.strokes || []).forEach(paintStroke);
    };
    const onDraw = (p: { gameId: string; stroke: Stroke }) => {
      if (p.gameId !== gameId || p.stroke?.userId === user?.id) return;
      paintStroke(p.stroke);
    };
    const onClear = (p: { gameId: string }) => {
      if (p.gameId !== gameId) return;
      clearCanvas();
    };
    const onState = (p: { gameId: string; room: any; players: any[] }) => {
      if (p.gameId !== gameId) return;
      setRoom(p.room);
      setPlayers(p.players || []);
    };
    const onCorrect = (p: { displayName: string; points: number; word: string }) => {
      setChat((c) => [...c.slice(-40), { text: `✅ ${p.displayName} خمّن صح! (+${p.points})`, kind: 'ok' }]);
      addToast(`${p.displayName} خمّن الكلمة!`, 'success');
    };
    const onGuessChat = (p: { displayName: string; guess: string }) => {
      setChat((c) => [...c.slice(-40), { text: `${p.displayName}: ${p.guess}` }]);
    };
    const onRound = (p: { round: number; endsAt: number; wordLen: number }) => {
      setChat((c) => [...c.slice(-40), { text: `🎯 الجولة ${p.round} — الكلمة ${p.wordLen} أحرف`, kind: 'sys' }]);
      if (p.endsAt) {
        setSecondsLeft(Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000)));
      }
    };
    const onEnded = (p: { gameId: string; reason?: string }) => {
      if (p.gameId !== gameId) return;
      setChat((c) => [...c.slice(-40), { text: p.reason || 'انتهت اللعبة', kind: 'sys' }]);
      addToast('انتهت غرفة اللعب', 'info');
    };

    socket.on('game:strokes_sync', onSync);
    socket.on('game:draw', onDraw);
    socket.on('game:clear', onClear);
    socket.on('game:state', onState);
    socket.on('game:correct', onCorrect);
    socket.on('game:guess_chat', onGuessChat);
    socket.on('game:round_start', onRound);
    socket.on('game:ended', onEnded);

    return () => {
      socket.emit('game:leave', { gameId });
      socket.off('game:strokes_sync', onSync);
      socket.off('game:draw', onDraw);
      socket.off('game:clear', onClear);
      socket.off('game:state', onState);
      socket.off('game:correct', onCorrect);
      socket.off('game:guess_chat', onGuessChat);
      socket.off('game:round_start', onRound);
      socket.off('game:ended', onEnded);
    };
  }, [socket, gameId, user?.id, paintStroke, clearCanvas, addToast]);

  useEffect(() => {
    if (!playing || !room?.round_ends_at) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      setSecondsLeft(Math.max(0, Math.ceil((room.round_ends_at - Date.now()) / 1000)));
    };
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [playing, room?.round_ends_at, room?.current_round]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const resize = () => {
      const parent = c.parentElement;
      if (!parent) return;
      const w = Math.min(parent.clientWidth, 640);
      const h = Math.round(w * 0.65);
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        clearCanvas();
        if (socket && gameId) socket.emit('game:join', { gameId });
      }
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [gameId, clearCanvas, socket]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawer || !playing) return;
    drawing.current = true;
    last.current = pos(e);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current || !socket || !gameId) return;
    const p = pos(e);
    const stroke: Stroke = {
      x0: last.current.x,
      y0: last.current.y,
      x1: p.x,
      y1: p.y,
      color,
      size
    };
    paintStroke(stroke);
    socket.emit('game:draw', { gameId, stroke });
    last.current = p;
  };

  const onPointerUp = () => {
    drawing.current = false;
    last.current = null;
  };

  const createRoom = async () => {
    try {
      if (createPrivate && createPassword.trim().length < 3) {
        addToast('كلمة المرور يجب أن تكون 3 أحرف على الأقل', 'error');
        return;
      }
      const r = await apiFetch<{ room: any }>('/api/games', {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim() || `رسم ${user?.display_name || ''}`,
          totalRounds: 5,
          maxPlayers: 8,
          isPrivate: createPrivate ? 1 : 0,
          password: createPrivate ? createPassword.trim() : '',
          announce: !createPrivate
        })
      });
      setGameId(r.room.id);
      setRoom(r.room);
      setPlayers([]);
      setChat([{ text: 'تم إنشاء الغرفة — انتظر اللاعبين ثم ابدأ الجولة', kind: 'sys' }]);
      addToast('تم إنشاء غرفة الرسم', 'success');
      loadRooms();
      setCreateName('');
      setCreatePassword('');
      setCreatePrivate(false);
    } catch (err: any) {
      addToast(err.message || 'فشل الإنشاء', 'error');
    }
  };

  const joinRoom = async (id: string, spectator = false, password = '') => {
    try {
      const r = await apiFetch<{ room: any; players: any[] }>(`/api/games/${id}/join`, {
        method: 'POST',
        body: JSON.stringify({ spectator, password })
      });
      setGameId(id);
      setRoom(r.room);
      setPlayers(r.players || []);
      setJoinTarget(null);
      setJoinPassword('');
      setChat([{ text: spectator ? 'انضممت كمشاهد' : 'انضممت للغرفة', kind: 'sys' }]);
    } catch (err: any) {
      addToast(err.message || 'فشل الانضمام', 'error');
    }
  };

  const deleteRoom = async () => {
    if (!gameId || !isHost) return;
    if (!confirm('حذف الغرفة؟')) return;
    try {
      await apiFetch(`/api/games/${gameId}`, { method: 'DELETE' });
      setGameId(null);
      setRoom(null);
      setPlayers([]);
      addToast('تم حذف الغرفة', 'success');
      loadRooms();
    } catch (err: any) {
      addToast(err.message || 'فشل الحذف', 'error');
    }
  };

  const startRound = () => {
    if (!socket || !gameId) return;
    const word = WORDS[Math.floor(Math.random() * WORDS.length)];
    socket.emit('game:start-round', { gameId, word });
    addToast(`أنت ترسم: ${word}`, 'info');
  };

  const sendGuess = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !gameId || !guess.trim() || isDrawer) return;
    socket.emit('game:guess', { gameId, guess: guess.trim() });
    setGuess('');
  };

  const leaveGame = () => {
    if (socket && gameId) socket.emit('game:leave', { gameId });
    setGameId(null);
    setRoom(null);
    setPlayers([]);
    setChat([]);
    loadRooms();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3" dir="rtl">
      <div className="bg-[var(--nabd-bg)] border border-white/10 rounded-3xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            {onBack && (
              <button type="button" onClick={onBack} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 text-xs font-bold">
                ← الألعاب
              </button>
            )}
            <Pencil className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-extrabold text-white">ارسم وخمّن</h3>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!gameId ? (
          <div className="p-4 space-y-4 overflow-y-auto">
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 space-y-2">
              <div className="text-xs font-extrabold text-white/80">إنشاء غرفة</div>
              <input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="اسم الغرفة (اختياري)"
                className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white"
              />
              <label className="flex items-center gap-2 text-xs text-white/70 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createPrivate}
                  onChange={(e) => setCreatePrivate(e.target.checked)}
                  className="rounded"
                />
                <Lock className="w-3.5 h-3.5" />
                غرفة خاصة بكلمة مرور
              </label>
              {createPrivate && (
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="كلمة المرور (3+)"
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white"
                />
              )}
              <button
                type="button"
                onClick={createRoom}
                className="w-full py-3 rounded-2xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-extrabold"
              >
                + إنشاء غرفة جديدة
              </button>
              {!createPrivate && (
                <p className="text-[10px] text-white/40">الغرف العامة تُعلن في الدردشة العامة تلقائياً</p>
              )}
            </div>

            <div className="text-xs text-white/50 font-bold">غرف نشطة</div>
            {rooms.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-8">لا توجد غرف — أنشئ واحدة!</p>
            ) : (
              rooms.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate flex items-center gap-1">
                      {Number(r.is_private) === 1 && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                      {r.name}
                    </div>
                    <div className="text-[10px] text-white/40">
                      {r.host_name} · {r.player_count || 0}/{r.max_players || 8} · {r.status === 'playing' ? 'يلعبون' : 'انتظار'}
                      {r.room_code ? ` · ${r.room_code}` : ''}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {joinTarget === r.id && Number(r.is_private) === 1 ? (
                      <div className="flex gap-1 items-center">
                        <input
                          type="password"
                          value={joinPassword}
                          onChange={(e) => setJoinPassword(e.target.value)}
                          placeholder="كلمة المرور"
                          className="w-24 px-2 py-1 rounded-lg bg-black/40 border border-white/10 text-[10px] text-white"
                        />
                        <button
                          type="button"
                          onClick={() => joinRoom(r.id, false, joinPassword)}
                          className="px-2 py-1 rounded-lg bg-violet-600 text-white text-[10px] font-bold"
                        >
                          دخول
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            if (Number(r.is_private) === 1) setJoinTarget(r.id);
                            else joinRoom(r.id, false);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-[11px] font-bold"
                        >
                          انضم
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (Number(r.is_private) === 1) setJoinTarget(r.id);
                            else joinRoom(r.id, true);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-white/10 text-white/70 text-[11px] font-bold flex items-center gap-0.5"
                        >
                          <Eye className="w-3 h-3" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between gap-2 text-[11px]">
              <span className="text-white/80 font-bold truncate">
                جولة {room?.current_round || 0}/{room?.total_rounds || 3}
                {playing && isDrawer && room?.word ? ` · الكلمة: ${room.word}` : ''}
                {playing && !isDrawer ? ` · ${wordHint(room?.word || '')}` : ''}
              </span>
              <div className="flex items-center gap-2 shrink-0">
                {playing && secondsLeft > 0 && (
                  <span className={`flex items-center gap-0.5 font-mono ${secondsLeft <= 15 ? 'text-rose-400' : 'text-amber-300'}`}>
                    <Clock className="w-3 h-3" />
                    {secondsLeft}ث
                  </span>
                )}
                <Users className="w-3.5 h-3.5 text-white/40" />
                <span className="text-white/50">{players.length}</span>
                {isHost && (
                  <button type="button" onClick={deleteRoom} className="p-1 rounded-lg hover:bg-rose-500/20 text-rose-400" title="حذف الغرفة">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={leaveGame} className="p-1 rounded-lg hover:bg-white/10 text-white/50" title="مغادرة">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-0">
              <div className="relative bg-black/40 flex items-center justify-center p-2">
                <canvas
                  ref={canvasRef}
                  className={`rounded-xl border border-white/10 touch-none max-w-full ${
                    isDrawer && playing ? 'cursor-crosshair' : 'cursor-default'
                  }`}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                />
              </div>
              <div className="border-t sm:border-t-0 sm:border-r border-white/10 p-2 overflow-y-auto space-y-1.5 max-h-40 sm:max-h-none">
                <div className="text-[10px] font-bold text-white/40 mb-1">اللاعبون</div>
                {players.map((p) => (
                  <div key={p.user_id} className="flex items-center justify-between text-[11px]">
                    <span className={`truncate ${p.user_id === room?.drawer_id ? 'text-violet-300 font-bold' : 'text-white/80'}`}>
                      {p.display_name}
                      {p.user_id === room?.host_id ? ' 👑' : ''}
                      {p.is_spectator ? ' 👁' : ''}
                    </span>
                    <span className="font-mono text-amber-300">{p.score || 0}</span>
                  </div>
                ))}
              </div>
            </div>

            {isDrawer && playing && (
              <div className="px-3 py-2 border-t border-white/10 flex items-center gap-2">
                {['#ffffff', '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7', '#000000'].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full border-2 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                    style={{ background: c }}
                  />
                ))}
                <input
                  type="range"
                  min={2}
                  max={20}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => socket?.emit('game:clear', { gameId })}
                  className="p-1.5 rounded-lg bg-white/10 text-white/70"
                  title="مسح"
                >
                  <Eraser className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="px-3 py-2 border-t border-white/10 max-h-24 overflow-y-auto space-y-0.5">
              {chat.map((c, i) => (
                <div
                  key={i}
                  className={`text-[11px] ${c.kind === 'ok' ? 'text-emerald-400' : c.kind === 'sys' ? 'text-violet-300' : 'text-white/60'}`}
                >
                  {c.text}
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-white/10 flex gap-2">
              {isHost && !playing && (
                <button
                  type="button"
                  onClick={startRound}
                  className="px-4 py-2 rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center gap-1"
                >
                  <Play className="w-3.5 h-3.5" /> بدء جولة
                </button>
              )}
              {isHost && playing && (
                <button
                  type="button"
                  onClick={startRound}
                  className="px-3 py-2 rounded-xl bg-amber-600/80 text-white text-xs font-bold"
                >
                  جولة تالية
                </button>
              )}
              {!isDrawer && playing && (
                <form onSubmit={sendGuess} className="flex-1 flex gap-2">
                  <input
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    placeholder="خمّن الكلمة..."
                    className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs text-white"
                    autoFocus
                  />
                  <button type="submit" className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold">
                    تخمين
                  </button>
                </form>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
