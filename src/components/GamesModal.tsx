import React, { useEffect, useState, useRef, useCallback } from 'react';
import { X, Users, Plus, Play, Eye, Trophy, Copy } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../services/api';

interface GameRoom {
  id: string;
  name: string;
  host_id: string;
  status: string;
  max_players: number;
  current_round: number;
  total_rounds: number;
  player_count?: number;
  host_name?: string;
  room_code?: string;
}

const ARABIC_WORDS = [
  'قطة', 'شمس', 'قمر', 'كتاب', 'قلم', 'سيارة', 'طائرة', 'سمكة', 'نجمة', 'بيت',
  'شجرة', 'زهرة', 'جبل', 'بحر', 'سحابة', 'هاتف', 'حاسوب', 'كرة', 'باب', 'نافذة',
  'قهوة', 'شاي', 'تفاح', 'موز', 'أسد', 'نمر', 'فيل', 'طائر', 'سفينة', 'جسر'
];

export const GamesModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, addToast, socket } = useApp();
  const [tab, setTab] = useState<'list' | 'play'>('list');
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [activeGame, setActiveGame] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [guess, setGuess] = useState('');
  const [chatLog, setChatLog] = useState<{ user: string; text: string; correct?: boolean }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  const loadRooms = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ rooms: GameRoom[] }>('/api/games');
      setRooms(res.rooms || []);
    } catch {
      setRooms([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomName.trim()) return;
    setCreating(true);
    try {
      const res = await apiFetch<{ room: any }>('/api/games', {
        method: 'POST',
        body: JSON.stringify({ name: roomName.trim(), totalRounds: 3, maxPlayers: 8 })
      });
      setRoomName('');
      setActiveGame(res.room);
      setTab('play');
      setPlayers([{ user_id: user?.id, display_name: user?.display_name, score: 0 }]);
      addToast('تم إنشاء غرفة اللعب', 'success');
    } catch (err: any) {
      addToast(err.message || 'فشل إنشاء الغرفة', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (gameId: string, asSpectator = false) => {
    try {
      const res = await apiFetch<{ room: any; players: any[] }>(`/api/games/${gameId}/join`, {
        method: 'POST',
        body: JSON.stringify({ spectator: asSpectator })
      });
      setActiveGame(res.room);
      setPlayers(res.players || []);
      setTab('play');
    } catch (err: any) {
      addToast(err.message || 'تعذر الانضمام', 'error');
    }
  };

  // Canvas drawing
  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height
    };
  };

  const startDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!isDrawing) return;
    drawing.current = true;
    lastPos.current = getPos(e);
  };

  const moveDraw = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current || !isDrawing) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const pos = getPos(e);
    if (!ctx || !pos || !lastPos.current) return;
    ctx.strokeStyle = '#7C3AED';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    // بث بسيط عبر السوكيت إن وُجد
    socket?.emit('game:draw', { gameId: activeGame?.id, from: lastPos.current, to: pos });
  };

  const endDraw = () => {
    drawing.current = false;
    lastPos.current = null;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.fillStyle = '#12121D';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  };

  const handleGuess = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guess.trim() || !activeGame) return;
    const word = (activeGame.word || '').trim();
    const correct = word && guess.trim() === word;
    setChatLog((prev) => [
      ...prev,
      { user: user?.display_name || 'أنت', text: guess.trim(), correct }
    ]);
    if (correct) {
      addToast('إجابة صحيحة! 🎉', 'success');
      socket?.emit('game:correct', { gameId: activeGame.id });
    }
    setGuess('');
  };

  const startRound = async () => {
    if (!activeGame || activeGame.host_id !== user?.id) return;
    const word = ARABIC_WORDS[Math.floor(Math.random() * ARABIC_WORDS.length)];
    try {
      const res = await apiFetch<{ room: any }>(`/api/games/${activeGame.id}/start-round`, {
        method: 'POST',
        body: JSON.stringify({ word })
      });
      setActiveGame(res.room);
      setIsDrawing(true);
      clearCanvas();
      setChatLog((prev) => [...prev, { user: 'النظام', text: 'بدأت جولة جديدة! ارسم الكلمة.' }]);
    } catch (err: any) {
      addToast(err.message || 'تعذر بدء الجولة', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-lg max-h-[92dvh] bg-[#12121D] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between bg-[#08080F]">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎨</span>
            <h2 className="text-sm font-extrabold text-white">ارسم وخمّن</h2>
            <span className="text-[10px] text-violet-400 font-bold">شبيه Gartic</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60">
            <X className="w-4 h-4" />
          </button>
        </div>

        {tab === 'list' ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <form onSubmit={handleCreate} className="flex gap-2">
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                placeholder="اسم الغرفة..."
                className="flex-1 px-3 py-2.5 rounded-xl bg-black/40 border border-white/10 text-xs text-white outline-none focus:border-violet-500"
              />
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold flex items-center gap-1 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" /> إنشاء
              </button>
            </form>

            {loading ? (
              <p className="text-center text-xs text-white/40 py-8">جاري التحميل...</p>
            ) : rooms.length === 0 ? (
              <div className="text-center py-10 space-y-2">
                <p className="text-3xl">🎮</p>
                <p className="text-xs text-white/50">لا توجد غرف لعب حاليًا</p>
                <p className="text-[11px] text-white/30">أنشئ غرفة وادعُ أصدقاءك</p>
              </div>
            ) : (
              <div className="space-y-2">
                {rooms.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">{r.name}</div>
                      <div className="text-[10px] text-white/40 flex items-center gap-2 mt-0.5">
                        <Users className="w-3 h-3" />
                        {r.player_count || 0}/{r.max_players}
                        <span>·</span>
                        {r.status === 'playing' ? 'جارية' : 'انتظار'}
                        {r.host_name && <span>· المضيف: {r.host_name}</span>}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleJoin(r.id, true)}
                        className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60"
                        title="مشاهدة"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleJoin(r.id, false)}
                        className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-[11px] font-bold flex items-center gap-1"
                      >
                        <Play className="w-3 h-3" /> انضم
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-white/8 flex items-center justify-between text-[11px]">
              <button type="button" onClick={() => setTab('list')} className="text-violet-400 hover:underline">
                ← الغرف
              </button>
              <span className="text-white/70 font-bold truncate">{activeGame?.name}</span>
              <span className="text-white/40 font-mono">
                جولة {(activeGame?.current_round || 0) + 1}/{activeGame?.total_rounds || 3}
              </span>
            </div>

            <div className="flex-1 min-h-0 flex flex-col p-2 gap-2">
              <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-[#08080F]">
                <canvas
                  ref={canvasRef}
                  width={400}
                  height={280}
                  className="w-full h-auto touch-none cursor-crosshair"
                  onMouseDown={startDraw}
                  onMouseMove={moveDraw}
                  onMouseUp={endDraw}
                  onMouseLeave={endDraw}
                  onTouchStart={startDraw}
                  onTouchMove={moveDraw}
                  onTouchEnd={endDraw}
                />
                {isDrawing && activeGame?.word && (
                  <div className="absolute top-2 right-2 px-2 py-1 rounded-lg bg-black/70 text-[11px] text-violet-300 font-bold">
                    الكلمة: {activeGame.word}
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                {activeGame?.host_id === user?.id && (
                  <button
                    type="button"
                    onClick={startRound}
                    className="flex-1 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold"
                  >
                    بدء جولة جديدة
                  </button>
                )}
                <button
                  type="button"
                  onClick={clearCanvas}
                  className="px-3 py-2 rounded-xl bg-white/5 text-white/60 text-xs"
                >
                  مسح
                </button>
              </div>

              <div className="h-24 overflow-y-auto rounded-xl bg-black/30 p-2 space-y-1 text-[11px]">
                {chatLog.map((c, i) => (
                  <div key={i} className={c.correct ? 'text-emerald-400 font-bold' : 'text-white/70'}>
                    <span className="text-violet-400">{c.user}:</span> {c.text}
                    {c.correct && ' ✓'}
                  </div>
                ))}
              </div>

              {!isDrawing && (
                <form onSubmit={handleGuess} className="flex gap-2">
                  <input
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    placeholder="خمّن الكلمة..."
                    className="flex-1 px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-xs text-white outline-none"
                  />
                  <button type="submit" className="px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-bold">
                    تخمين
                  </button>
                </form>
              )}

              <div className="flex flex-wrap gap-1.5">
                {players.map((p) => (
                  <span
                    key={p.user_id}
                    className="px-2 py-1 rounded-lg bg-white/5 text-[10px] text-white/80 flex items-center gap-1"
                  >
                    <Trophy className="w-3 h-3 text-amber-400" />
                    {p.display_name || p.user_id} · {p.score || 0}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GamesModal;
