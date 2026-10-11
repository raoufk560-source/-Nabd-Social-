import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Users, Play, LogOut, Trash2, Lock } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch } from '../services/api';

type Ball = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  radius: number;
  pocketed: boolean;
};

const TABLE_W = 800;
const TABLE_H = 400;
const BALL_R = 12;
const FRICTION = 0.988;
const MIN_V = 0.05;

function makeBalls(): Ball[] {
  const colors = [
    '#ffffff',
    '#eab308',
    '#3b82f6',
    '#ef4444',
    '#a855f7',
    '#f97316',
    '#22c55e',
    '#1e293b',
    '#f43f5e',
    '#06b6d4',
    '#84cc16',
    '#c026d3',
    '#78716c',
    '#facc15',
    '#2563eb',
    '#dc2626'
  ];
  const balls: Ball[] = [
    { id: 0, x: 200, y: TABLE_H / 2, vx: 0, vy: 0, color: colors[0], radius: BALL_R, pocketed: false }
  ];
  let n = 1;
  const startX = 560;
  const startY = TABLE_H / 2;
  for (let row = 0; row < 5; row++) {
    for (let i = 0; i <= row; i++) {
      if (n >= 16) break;
      balls.push({
        id: n,
        x: startX + row * (BALL_R * 2 * 0.92),
        y: startY + (i - row / 2) * (BALL_R * 2.05),
        vx: 0,
        vy: 0,
        color: colors[n] || '#fff',
        radius: BALL_R,
        pocketed: false
      });
      n++;
    }
  }
  return balls;
}

const POCKETS = [
  { x: 18, y: 18 },
  { x: TABLE_W / 2, y: 10 },
  { x: TABLE_W - 18, y: 18 },
  { x: 18, y: TABLE_H - 18 },
  { x: TABLE_W / 2, y: TABLE_H - 10 },
  { x: TABLE_W - 18, y: TABLE_H - 18 }
];

export const BilliardsGameModal: React.FC<{ onClose: () => void; onBack?: () => void }> = ({
  onClose,
  onBack
}) => {
  const { user, socket, addToast } = useApp();
  const [rooms, setRooms] = useState<any[]>([]);
  const [gameId, setGameId] = useState<string | null>(null);
  const [room, setRoom] = useState<any>(null);
  const [players, setPlayers] = useState<any[]>([]);
  const [balls, setBalls] = useState<Ball[]>(() => makeBalls());
  const [myTurn, setMyTurn] = useState(false);
  const [aiming, setAiming] = useState(false);
  const [aim, setAim] = useState<{ x: number; y: number } | null>(null);
  const [createPrivate, setCreatePrivate] = useState(false);
  const [createPassword, setCreatePassword] = useState('');
  const [joinPassword, setJoinPassword] = useState('');
  const [joinTarget, setJoinTarget] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef(balls);
  const animRef = useRef<number>(0);
  const movingRef = useRef(false);

  ballsRef.current = balls;
  const isHost = room?.host_id === user?.id;

  const loadRooms = useCallback(async () => {
    try {
      const r = await apiFetch<{ rooms: any[] }>('/api/games?type=billiards');
      setRooms((r.rooms || []).filter((x) => x.game_type === 'billiards' || !x.game_type));
      // fallback: show all if type filter not supported
      if (!(r.rooms || []).length) {
        const all = await apiFetch<{ rooms: any[] }>('/api/games');
        setRooms((all.rooms || []).filter((x: any) => (x.game_type || 'draw') === 'billiards'));
      }
    } catch {
      setRooms([]);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    const t = setInterval(loadRooms, 8000);
    return () => clearInterval(t);
  }, [loadRooms]);

  const drawTable = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, bls: Ball[]) => {
    const sx = w / TABLE_W;
    const sy = h / TABLE_H;
    ctx.fillStyle = '#0a5c36';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#5c3a1e';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, w - 14, h - 14);
    // pockets
    ctx.fillStyle = '#050508';
    for (const p of POCKETS) {
      ctx.beginPath();
      ctx.arc(p.x * sx, p.y * sy, 16 * Math.min(sx, sy), 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of bls) {
      if (b.pocketed) continue;
      const gx = b.x * sx;
      const gy = b.y * sy;
      const gr = b.radius * Math.min(sx, sy);
      const grd = ctx.createRadialGradient(gx - gr * 0.3, gy - gr * 0.3, gr * 0.1, gx, gy, gr);
      grd.addColorStop(0, '#ffffff88');
      grd.addColorStop(0.4, b.color);
      grd.addColorStop(1, '#00000055');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(gx, gy, gr, 0, Math.PI * 2);
      ctx.fill();
      if (b.id === 0) {
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(gx, gy, gr * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, []);

  const render = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    drawTable(ctx, c.width, c.height, ballsRef.current);
    if (aiming && aim && myTurn) {
      const cue = ballsRef.current.find((b) => b.id === 0 && !b.pocketed);
      if (cue) {
        const sx = c.width / TABLE_W;
        const sy = c.height / TABLE_H;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(cue.x * sx, cue.y * sy);
        ctx.lineTo(aim.x * sx, aim.y * sy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }, [aim, aiming, myTurn, drawTable]);

  useEffect(() => {
    render();
  }, [balls, render]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const parent = c.parentElement;
    if (!parent) return;
    const w = Math.min(parent.clientWidth - 8, 720);
    const h = Math.round(w * (TABLE_H / TABLE_W));
    c.width = w;
    c.height = h;
    render();
  }, [gameId, render]);

  const stepPhysics = useCallback(() => {
    const bls = ballsRef.current.map((b) => ({ ...b }));
    let moving = false;
    for (const b of bls) {
      if (b.pocketed) continue;
      b.x += b.vx;
      b.y += b.vy;
      b.vx *= FRICTION;
      b.vy *= FRICTION;
      if (Math.abs(b.vx) < MIN_V) b.vx = 0;
      if (Math.abs(b.vy) < MIN_V) b.vy = 0;
      if (b.vx || b.vy) moving = true;
      // walls
      if (b.x < b.radius + 16) {
        b.x = b.radius + 16;
        b.vx *= -0.85;
      }
      if (b.x > TABLE_W - b.radius - 16) {
        b.x = TABLE_W - b.radius - 16;
        b.vx *= -0.85;
      }
      if (b.y < b.radius + 16) {
        b.y = b.radius + 16;
        b.vy *= -0.85;
      }
      if (b.y > TABLE_H - b.radius - 16) {
        b.y = TABLE_H - b.radius - 16;
        b.vy *= -0.85;
      }
      // pockets
      for (const p of POCKETS) {
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        if (dx * dx + dy * dy < 22 * 22) {
          b.pocketed = true;
          b.vx = 0;
          b.vy = 0;
          if (b.id === 0) {
            // respawn cue
            b.pocketed = false;
            b.x = 200;
            b.y = TABLE_H / 2;
          }
        }
      }
    }
    // collisions
    for (let i = 0; i < bls.length; i++) {
      for (let j = i + 1; j < bls.length; j++) {
        const a = bls[i];
        const b = bls[j];
        if (a.pocketed || b.pocketed) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.001;
        const minD = a.radius + b.radius;
        if (dist < minD) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minD - dist;
          a.x -= nx * overlap * 0.5;
          a.y -= ny * overlap * 0.5;
          b.x += nx * overlap * 0.5;
          b.y += ny * overlap * 0.5;
          const dvx = a.vx - b.vx;
          const dvy = a.vy - b.vy;
          const impact = dvx * nx + dvy * ny;
          if (impact > 0) {
            a.vx -= impact * nx;
            a.vy -= impact * ny;
            b.vx += impact * nx;
            b.vy += impact * ny;
          }
        }
      }
    }
    ballsRef.current = bls;
    setBalls(bls);
    movingRef.current = moving;
    return moving;
  }, []);

  const runSim = useCallback(() => {
    const loop = () => {
      const moving = stepPhysics();
      render();
      if (moving) {
        animRef.current = requestAnimationFrame(loop);
      } else {
        movingRef.current = false;
        if (socket && gameId) {
          socket.emit('billiards:sync', {
            gameId,
            balls: ballsRef.current.map((b) => ({
              id: b.id,
              x: b.x,
              y: b.y,
              vx: 0,
              vy: 0,
              pocketed: b.pocketed
            }))
          });
          socket.emit('billiards:turn-end', { gameId });
        }
      }
    };
    cancelAnimationFrame(animRef.current);
    animRef.current = requestAnimationFrame(loop);
  }, [stepPhysics, render, socket, gameId]);

  useEffect(() => {
    if (!socket || !gameId) return;
    socket.emit('game:join', { gameId });

    const onState = (p: { gameId: string; room: any; players: any[] }) => {
      if (p.gameId !== gameId) return;
      setRoom(p.room);
      setPlayers(p.players || []);
      const turnUser = p.room?.drawer_id || p.players?.[0]?.user_id;
      setMyTurn(turnUser === user?.id && p.room?.status === 'playing');
    };
    const onSync = (p: { gameId: string; balls: any[]; turnUserId?: string }) => {
      if (p.gameId !== gameId) return;
      if (p.balls?.length) {
        const next = makeBalls().map((b) => {
          const s = p.balls.find((x: any) => x.id === b.id);
          return s
            ? { ...b, x: s.x, y: s.y, vx: s.vx || 0, vy: s.vy || 0, pocketed: !!s.pocketed }
            : b;
        });
        ballsRef.current = next;
        setBalls(next);
        render();
      }
      if (p.turnUserId) setMyTurn(p.turnUserId === user?.id);
    };
    const onShot = (p: { gameId: string; vx: number; vy: number; fromUserId: string }) => {
      if (p.gameId !== gameId || p.fromUserId === user?.id) return;
      const bls = ballsRef.current.map((b) =>
        b.id === 0 && !b.pocketed ? { ...b, vx: p.vx, vy: p.vy } : { ...b }
      );
      ballsRef.current = bls;
      setBalls(bls);
      movingRef.current = true;
      runSim();
    };

    socket.on('game:state', onState);
    socket.on('billiards:sync', onSync);
    socket.on('billiards:shot', onShot);

    return () => {
      socket.emit('game:leave', { gameId });
      socket.off('game:state', onState);
      socket.off('billiards:sync', onSync);
      socket.off('billiards:shot', onShot);
      cancelAnimationFrame(animRef.current);
    };
  }, [socket, gameId, user?.id, render, runSim]);

  const canvasPos = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * TABLE_W,
      y: ((e.clientY - r.top) / r.height) * TABLE_H
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!myTurn || movingRef.current || room?.status !== 'playing') return;
    const cue = ballsRef.current.find((b) => b.id === 0 && !b.pocketed);
    if (!cue) return;
    setAiming(true);
    setAim(canvasPos(e));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!aiming) return;
    setAim(canvasPos(e));
  };
  const onPointerUp = () => {
    if (!aiming || !aim || !socket || !gameId) {
      setAiming(false);
      return;
    }
    const cue = ballsRef.current.find((b) => b.id === 0 && !b.pocketed);
    if (!cue) {
      setAiming(false);
      return;
    }
    const dx = aim.x - cue.x;
    const dy = aim.y - cue.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const power = Math.min(18, dist / 12);
    const vx = (dx / dist) * power;
    const vy = (dy / dist) * power;
    const bls = ballsRef.current.map((b) => (b.id === 0 ? { ...b, vx, vy } : { ...b }));
    ballsRef.current = bls;
    setBalls(bls);
    setAiming(false);
    setAim(null);
    setMyTurn(false);
    socket.emit('billiards:shot', { gameId, vx, vy });
    movingRef.current = true;
    runSim();
  };

  const createRoom = async () => {
    try {
      if (createPrivate && createPassword.trim().length < 3) {
        addToast('كلمة المرور 3 أحرف على الأقل', 'error');
        return;
      }
      const r = await apiFetch<{ room: any }>('/api/games', {
        method: 'POST',
        body: JSON.stringify({
          name: `بلياردو ${user?.display_name || ''}`,
          totalRounds: 1,
          maxPlayers: 4,
          isPrivate: createPrivate ? 1 : 0,
          password: createPrivate ? createPassword.trim() : '',
          gameType: 'billiards',
          announce: !createPrivate
        })
      });
      setGameId(r.room.id);
      setRoom(r.room);
      setBalls(makeBalls());
      addToast('تم إنشاء طاولة البلياردو', 'success');
      loadRooms();
    } catch (err: any) {
      addToast(err.message || 'فشل الإنشاء', 'error');
    }
  };

  const joinRoom = async (id: string, password = '') => {
    try {
      const r = await apiFetch<{ room: any; players: any[] }>(`/api/games/${id}/join`, {
        method: 'POST',
        body: JSON.stringify({ spectator: false, password })
      });
      setGameId(id);
      setRoom(r.room);
      setPlayers(r.players || []);
      setJoinTarget(null);
      setJoinPassword('');
    } catch (err: any) {
      addToast(err.message || 'فشل الانضمام', 'error');
    }
  };

  const startGame = () => {
    if (!socket || !gameId) return;
    socket.emit('game:start-round', { gameId, word: 'billiards' });
    socket.emit('billiards:sync', {
      gameId,
      balls: makeBalls().map((b) => ({ id: b.id, x: b.x, y: b.y, vx: 0, vy: 0, pocketed: false })),
      turnUserId: user?.id
    });
    setMyTurn(true);
    setBalls(makeBalls());
    addToast('بدأت اللعبة — دورك للضرب', 'success');
  };

  const deleteRoom = async () => {
    if (!gameId || !isHost) return;
    if (!confirm('حذف الطاولة؟')) return;
    try {
      await apiFetch(`/api/games/${gameId}`, { method: 'DELETE' });
      setGameId(null);
      setRoom(null);
      loadRooms();
    } catch (err: any) {
      addToast(err.message || 'فشل الحذف', 'error');
    }
  };

  const leave = () => {
    if (socket && gameId) socket.emit('game:leave', { gameId });
    setGameId(null);
    setRoom(null);
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
            <span className="text-sm font-extrabold text-white">🎱 بلياردو</span>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!gameId ? (
          <div className="p-4 space-y-3 overflow-y-auto">
            <div className="p-3 rounded-2xl bg-white/5 border border-white/10 space-y-2">
              <label className="flex items-center gap-2 text-xs text-white/70">
                <input type="checkbox" checked={createPrivate} onChange={(e) => setCreatePrivate(e.target.checked)} />
                <Lock className="w-3.5 h-3.5" /> خاصة بكلمة مرور
              </label>
              {createPrivate && (
                <input
                  type="password"
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="كلمة المرور"
                  className="w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-xs text-white"
                />
              )}
              <button type="button" onClick={createRoom} className="w-full py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold">
                + إنشاء طاولة
              </button>
            </div>
            <div className="text-xs text-white/50 font-bold">طاولات نشطة</div>
            {rooms.length === 0 ? (
              <p className="text-xs text-white/40 text-center py-8">لا توجد طاولات</p>
            ) : (
              rooms.map((r) => (
                <div key={r.id} className="p-3 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white truncate">{r.name}</div>
                    <div className="text-[10px] text-white/40">
                      {r.host_name} · {r.player_count || 0} · {r.status}
                    </div>
                  </div>
                  {joinTarget === r.id && Number(r.is_private) === 1 ? (
                    <div className="flex gap-1">
                      <input
                        type="password"
                        value={joinPassword}
                        onChange={(e) => setJoinPassword(e.target.value)}
                        className="w-20 px-2 py-1 rounded-lg bg-black/40 border border-white/10 text-[10px] text-white"
                        placeholder="مرور"
                      />
                      <button type="button" onClick={() => joinRoom(r.id, joinPassword)} className="px-2 py-1 rounded-lg bg-emerald-600 text-white text-[10px] font-bold">
                        دخول
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (Number(r.is_private) === 1) setJoinTarget(r.id);
                        else joinRoom(r.id);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 text-white text-[11px] font-bold"
                    >
                      انضم
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between text-[11px]">
              <span className="text-white/80 font-bold">
                {room?.status === 'playing' ? (myTurn ? 'دورك — اسحب للتوجيه واضغط للضرب' : 'دور الخصم...') : 'في الانتظار'}
              </span>
              <div className="flex items-center gap-2">
                <Users className="w-3.5 h-3.5 text-white/40" />
                <span className="text-white/50">{players.length}</span>
                {isHost && (
                  <button type="button" onClick={deleteRoom} className="p-1 text-rose-400">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button type="button" onClick={leave} className="p-1 text-white/50">
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-2 flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex items-center justify-center bg-black/30 rounded-xl">
                <canvas
                  ref={canvasRef}
                  className="rounded-lg touch-none max-w-full cursor-crosshair"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={() => setAiming(false)}
                />
              </div>
              <div className="w-full sm:w-36 p-2 space-y-1 overflow-y-auto border-t sm:border-t-0 sm:border-r border-white/10">
                <div className="text-[10px] font-bold text-white/40">اللاعبون</div>
                {players.map((p) => (
                  <div key={p.user_id} className="text-[11px] text-white/80 truncate">
                    {p.display_name}
                    {p.user_id === room?.host_id ? ' 👑' : ''}
                    {p.user_id === room?.drawer_id && room?.status === 'playing' ? ' 🎯' : ''}
                  </div>
                ))}
              </div>
            </div>
            {isHost && room?.status !== 'playing' && (
              <div className="p-3 border-t border-white/10">
                <button type="button" onClick={startGame} className="w-full py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center gap-1">
                  <Play className="w-3.5 h-3.5" /> بدء اللعب
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
