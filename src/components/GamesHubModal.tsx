import React, { useState } from 'react';
import { X, Pencil, CircleDot } from 'lucide-react';
import { DrawGameModal } from './DrawGameModal';
import { BilliardsGameModal } from './BilliardsGameModal';

type GameTab = 'hub' | 'draw' | 'billiards';

export const GamesHubModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<GameTab>('hub');

  if (tab === 'draw') {
    return <DrawGameModal onClose={onClose} onBack={() => setTab('hub')} />;
  }
  if (tab === 'billiards') {
    return <BilliardsGameModal onClose={onClose} onBack={() => setTab('hub')} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-3" dir="rtl">
      <div className="bg-[var(--nabd-bg)] border border-white/10 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-white">قسم الألعاب</h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/70">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <button
            type="button"
            onClick={() => setTab('draw')}
            className="w-full p-4 rounded-2xl bg-gradient-to-l from-violet-600/30 to-violet-900/20 border border-violet-500/30 hover:border-violet-400/50 text-right flex items-center gap-3 transition"
          >
            <div className="w-12 h-12 rounded-2xl bg-violet-600/40 flex items-center justify-center shrink-0">
              <Pencil className="w-6 h-6 text-violet-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-white">ارسم وخمّن</div>
              <div className="text-[11px] text-white/50 mt-0.5">غرف متعددة · رسم مباشر · تخمين · مشاهدين</div>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setTab('billiards')}
            className="w-full p-4 rounded-2xl bg-gradient-to-l from-emerald-600/30 to-emerald-900/20 border border-emerald-500/30 hover:border-emerald-400/50 text-right flex items-center gap-3 transition"
          >
            <div className="w-12 h-12 rounded-2xl bg-emerald-600/40 flex items-center justify-center shrink-0">
              <CircleDot className="w-6 h-6 text-emerald-200" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold text-white">بلياردو</div>
              <div className="text-[11px] text-white/50 mt-0.5">طاولة حية · لعب مع الأصدقاء · ضربات متزامنة</div>
            </div>
          </button>

          <p className="text-[10px] text-white/35 text-center pt-2">المزيد من الألعاب قريباً</p>
        </div>
      </div>
    </div>
  );
};
