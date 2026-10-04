import React, { useState, useCallback } from 'react';

/** حزم ملصقات بسيطة قابلة للتوسعة */
export const STICKER_PACKS: {
  id: string;
  name: string;
  stickers: { id: string; emoji: string; label: string }[];
}[] = [
  {
    id: 'emotions',
    name: 'مشاعر',
    stickers: [
      { id: 's1', emoji: '😭', label: 'أبكي' },
      { id: 's2', emoji: '😂', label: 'أضحك' },
      { id: 's3', emoji: '❤️', label: 'أحب' },
      { id: 's4', emoji: '🔥', label: 'نار' },
      { id: 's5', emoji: '👏', label: 'تصفيق' },
      { id: 's6', emoji: '🙏', label: 'دعاء' },
      { id: 's7', emoji: '💪', label: 'قوة' },
      { id: 's8', emoji: '🎉', label: 'احتفال' },
      { id: 's9', emoji: '😴', label: 'نوم' },
      { id: 's10', emoji: '🤔', label: 'أفكر' },
      { id: 's11', emoji: '😎', label: 'كول' },
      { id: 's12', emoji: '🥳', label: 'حفلة' }
    ]
  },
  {
    id: 'arabic',
    name: 'عربي',
    stickers: [
      { id: 'a1', emoji: '🇸🇦', label: 'سعودية' },
      { id: 'a2', emoji: '☕', label: 'قهوة' },
      { id: 'a3', emoji: '🌙', label: 'رمضان' },
      { id: 'a4', emoji: '🕌', label: 'مسجد' },
      { id: 'a5', emoji: '⭐', label: 'نجمة' },
      { id: 'a6', emoji: '🌹', label: 'وردة' },
      { id: 'a7', emoji: '🎂', label: 'عيد ميلاد' },
      { id: 'a8', emoji: '🎁', label: 'هدية' }
    ]
  }
  ,
  {
    id: 'reactions',
    name: 'تفاعل',
    stickers: [
      { id: 'r1', emoji: '😂', label: 'ضحك' },
      { id: 'r2', emoji: '😍', label: 'حب' },
      { id: 'r3', emoji: '🔥', label: 'نار' },
      { id: 'r4', emoji: '👏', label: 'تصفيق' },
      { id: 'r5', emoji: '💯', label: 'مية' },
      { id: 'r6', emoji: '🥺', label: 'توسل' },
      { id: 'r7', emoji: '😎', label: 'كول' },
      { id: 'r8', emoji: '🤝', label: 'اتفاق' },
      { id: 'r9', emoji: '💪', label: 'قوة' },
      { id: 'r10', emoji: '🎉', label: 'احتفال' },
      { id: 'r11', emoji: '💔', label: 'قلب مكسور' },
      { id: 'r12', emoji: '😴', label: 'نوم' }
    ]
  },
  {
    id: 'animals',
    name: 'حيوانات',
    stickers: [
      { id: 'an1', emoji: '🐱', label: 'قط' },
      { id: 'an2', emoji: '🐶', label: 'كلب' },
      { id: 'an3', emoji: '🦁', label: 'أسد' },
      { id: 'an4', emoji: '🐼', label: 'باندا' },
      { id: 'an5', emoji: '🦊', label: 'ثعلب' },
      { id: 'an6', emoji: '🦄', label: 'يونيكورن' },
      { id: 'an7', emoji: '🐝', label: 'نحلة' },
      { id: 'an8', emoji: '🦋', label: 'فراشة' }
    ]
  }
];

interface StickerPickerProps {
  onSelect: (sticker: { id: string; emoji: string; label: string }) => void;
  onClose?: () => void;
}

export const StickerPicker: React.FC<StickerPickerProps> = ({ onSelect, onClose }) => {
  const [packId, setPackId] = useState(STICKER_PACKS[0].id);
  const [customStickers, setCustomStickers] = useState<{ id: string; emoji: string; label: string }[]>(() => {
    try {
      const raw = localStorage.getItem('nabd_custom_stickers');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [newEmoji, setNewEmoji] = useState('');
  const packs = [
    ...STICKER_PACKS,
    { id: 'mine', name: 'ملصقاتي', stickers: customStickers }
  ];
  const pack = packs.find((p) => p.id === packId) || packs[0];
  const saveCustoms = (next: any[]) => {
    setCustomStickers(next);
    try {
      localStorage.setItem('nabd_custom_stickers', JSON.stringify(next));
    } catch {}
  };
  const addCustom = () => {
    const emoji = newEmoji.trim();
    if (!emoji) return;
    const item = { id: 'c' + Date.now(), emoji, label: 'خاص' };
    saveCustoms([item, ...customStickers].slice(0, 40));
    setNewEmoji('');
  };
  const addCustomImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      const item = { id: 'c' + Date.now(), emoji: '🖼️', label: 'صورة', imageUrl: dataUrl };
      saveCustoms([item, ...customStickers].slice(0, 40));
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="bg-[#12121D] border border-white/10 rounded-2xl shadow-2xl w-[min(300px,92vw)] overflow-hidden" dir="rtl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-xs font-bold text-white/80">الملصقات</span>
        {onClose && (
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white text-sm">
            ✕
          </button>
        )}
      </div>
      <div className="flex gap-1 px-2 py-1.5 overflow-x-auto border-b border-white/5">
        {packs.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPackId(p.id)}
            className={`px-3 py-1 rounded-lg text-[11px] font-bold shrink-0 transition ${
              packId === p.id ? 'bg-violet-600 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
      {packId === 'mine' && (
        <div className="flex flex-col gap-2 px-3 py-2 border-b border-white/5">
          <div className="flex gap-2">
            <input
              type="text"
              value={newEmoji}
              onChange={(e) => setNewEmoji(e.target.value)}
              placeholder="إيموجي ملصق"
              className="flex-1 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
              maxLength={8}
            />
            <button type="button" onClick={addCustom} className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-[11px] font-bold">
              إضافة
            </button>
          </div>
          <label className="flex items-center justify-center gap-2 py-2 rounded-xl bg-white/5 border border-dashed border-white/15 text-[11px] text-white/70 cursor-pointer hover:bg-white/10">
            📷 رفع صورة كملصق خاص
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) addCustomImage(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2 p-3 max-h-52 overflow-y-auto">
        {pack.stickers.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className="flex flex-col items-center gap-1 p-2 rounded-xl hover:bg-white/10 active:scale-95 transition"
            title={s.label}
          >
            {(s as any).imageUrl ? (
              <img src={(s as any).imageUrl} alt="" className="w-12 h-12 object-contain rounded-lg" />
            ) : (
              <span className="text-3xl">{s.emoji}</span>
            )}
            <span className="text-[9px] text-white/40 truncate w-full text-center">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

/** طبقة GIF قابلة للتبديل لاحقًا (Tenor / Giphy عبر env) */
export interface GifItem {
  id: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
  title: string;
}

/** مزود محلي بسيط بدون API key — يمكن استبداله بـ Tenor لاحقًا */
const LOCAL_GIFS: GifItem[] = [
  { id: 'g1', url: 'https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/giphy.gif', previewUrl: 'https://media.giphy.com/media/3o7aCTPPm4OHfRLSH6/200w.gif', width: 200, height: 200, title: 'تصفيق' },
  { id: 'g2', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', previewUrl: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif', width: 200, height: 150, title: 'ضحك' },
  { id: 'g3', url: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/giphy.gif', previewUrl: 'https://media.giphy.com/media/26u4cqiYI30juCOGY/200w.gif', width: 200, height: 200, title: 'قلب' },
  { id: 'g4', url: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif', previewUrl: 'https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/200w.gif', width: 200, height: 150, title: 'موافق' },
  { id: 'g5', url: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif', previewUrl: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/200w.gif', width: 200, height: 200, title: 'حماس' },
  { id: 'g6', url: 'https://media.giphy.com/media/26tPplGWjN0xLybiU/giphy.gif', previewUrl: 'https://media.giphy.com/media/26tPplGWjN0xLybiU/200w.gif', width: 200, height: 150, title: 'وداع' },
  { id: 'g7', url: 'https://media.giphy.com/media/xT9IgG50Fy7i0voRpC/giphy.gif', previewUrl: 'https://media.giphy.com/media/xT9IgG50Fy7i0voRpC/200w.gif', width: 200, height: 150, title: 'رقص' },
  { id: 'g8', url: 'https://media.giphy.com/media/IcGkqdUmYLFGE/giphy.gif', previewUrl: 'https://media.giphy.com/media/IcGkqdUmYLFGE/200w.gif', width: 200, height: 150, title: 'بكاء' },
  { id: 'g9', url: 'https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif', previewUrl: 'https://media.giphy.com/media/13HgwGsXF0aiGY/200w.gif', width: 200, height: 150, title: 'ذهول' },
  { id: 'g10', url: 'https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif', previewUrl: 'https://media.giphy.com/media/5GoVLqeAOo6PK/200w.gif', width: 200, height: 150, title: 'فرحة' },
  { id: 'g11', url: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif', previewUrl: 'https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/200w.gif', width: 200, height: 150, title: 'قهقهة' },
  { id: 'g12', url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif', previewUrl: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/200w.gif', width: 200, height: 150, title: 'تشجيع' },
  { id: 'g13', url: 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/giphy.gif', previewUrl: 'https://media.giphy.com/media/3o6Zt6ML6BklcajjsA/200w.gif', width: 200, height: 150, title: 'سلام' },
  { id: 'g14', url: 'https://media.giphy.com/media/26BRv0ThflsHCqHrA/giphy.gif', previewUrl: 'https://media.giphy.com/media/26BRv0ThflsHCqHrA/200w.gif', width: 200, height: 150, title: 'نوبة ضحك' },
  { id: 'g15', url: 'https://media.giphy.com/media/l4FGuhL4U2WyjdkaY/giphy.gif', previewUrl: 'https://media.giphy.com/media/l4FGuhL4U2WyjdkaY/200w.gif', width: 200, height: 150, title: 'رائع' }
];

interface GifPickerProps {
  onSelect: (gif: GifItem) => void;
  onClose?: () => void;
}

export const GifPicker: React.FC<GifPickerProps> = ({ onSelect, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GifItem[]>(LOCAL_GIFS);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (q: string) => {
    setQuery(q);
    if (!q.trim()) {
      setResults(LOCAL_GIFS);
      return;
    }
    setLoading(true);
    try {
      // إذا وُجد TENOR_API_KEY في env من الخادم يمكن استدعاؤه عبر /api/gifs/search
      // حاليًا نفلتر المحلي
      const filtered = LOCAL_GIFS.filter(
        (g) => g.title.includes(q) || g.id.includes(q)
      );
      setResults(filtered.length ? filtered : LOCAL_GIFS);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="bg-[#12121D] border border-white/10 rounded-2xl shadow-2xl w-[min(320px,92vw)] overflow-hidden" dir="rtl">
      <div className="flex items-center gap-2 p-2 border-b border-white/5">
        <input
          type="text"
          value={query}
          onChange={(e) => search(e.target.value)}
          placeholder="ابحث عن GIF..."
          className="flex-1 bg-white/5 rounded-xl px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/30"
        />
        {onClose && (
          <button type="button" onClick={onClose} className="text-white/50 hover:text-white text-sm w-7 h-7">
            ✕
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 max-h-56 overflow-y-auto">
        {loading && <p className="col-span-2 text-center text-xs text-white/40 py-4">جاري البحث...</p>}
        {!loading &&
          results.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g)}
              className="rounded-xl overflow-hidden border border-white/5 hover:border-violet-500/50 transition aspect-square bg-black/30"
            >
              <img src={g.previewUrl} alt={g.title} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        {!loading && results.length === 0 && (
          <p className="col-span-2 text-center text-xs text-white/40 py-6">لا توجد نتائج</p>
        )}
      </div>
      <p className="text-[9px] text-white/25 text-center pb-2">يمكن ربط Tenor لاحقًا عبر TENOR_API_KEY</p>
    </div>
  );
};
