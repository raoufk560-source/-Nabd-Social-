import React, { useState, useMemo } from 'react';

const EMOJI_CATEGORIES: { id: string; label: string; emojis: string[] }[] = [
  {
    id: 'smileys',
    label: '😊',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙',
      '🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬',
      '😮‍💨','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸',
      '😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱',
      '😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻',
      '👽','👾','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'
    ]
  },
  {
    id: 'gestures',
    label: '👋',
    emojis: [
      '👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍',
      '👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂',
      '🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','💋','🩸'
    ]
  },
  {
    id: 'hearts',
    label: '❤️',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','♥️',
      '💌','💤','💢','💣','💥','💦','💨','💫','💬','🗨️','🗯️','💭','🕳️'
    ]
  },
  {
    id: 'animals',
    label: '🐱',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒',
      '🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞',
      '🐜','🪰','🪲','🪳','🦟','🦗','🕷️','🕸️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡',
      '🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫','🦒','🦘'
    ]
  },
  {
    id: 'food',
    label: '🍕',
    emojis: [
      '🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦',
      '🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈',
      '🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘',
      '🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧'
    ]
  },
  {
    id: 'activities',
    label: '⚽',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳',
      '🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️',
      '🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🤽','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️'
    ]
  },
  {
    id: 'objects',
    label: '📱',
    emojis: [
      '⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥',
      '📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','🎛️','🧭','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋',
      '🔌','💡','🔦','🕯️','🪔','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛'
    ]
  },
  {
    id: 'symbols',
    label: '✨',
    emojis: [
      '✨','⭐','🌟','💫','⚡','🔥','💥','☀️','🌤️','⛅','🌥️','☁️','🌦️','🌧️','⛈️','🌩️','🌨️','❄️','☃️','⛄',
      '🌬️','💨','🌪️','🌫️','🌈','☔','💧','💦','🌊','🎵','🎶','🔔','🔕','📣','📢','💬','💭','🗯️','♠️','♥️',
      '♦️','♣️','🃏','🀄','🎴','🎯','🔮','🧿','🪬','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐'
    ]
  },
  {
    id: 'flags',
    label: '🇸🇦',
    emojis: [
      '🇸🇦','🇦🇪','🇰🇼','🇶🇦','🇧🇭','🇴🇲','🇾🇪','🇯🇴','🇱🇧','🇸🇾','🇮🇶','🇪🇬','🇸🇩','🇱🇾','🇹🇳','🇩🇿','🇲🇦','🇲🇷','🇵🇸','🇸🇴',
      '🇩🇯','🇰🇲','🇹🇷','🇮🇷','🇦🇫','🇵🇰','🇮🇳','🇧🇩','🇮🇩','🇲🇾','🇧🇳','🇲🇻','🏳️','🏴','🏁','🚩','🎌','🏴‍☠️'
    ]
  }
];

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose?: () => void;
  className?: string;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose, className = '' }) => {
  const [activeCat, setActiveCat] = useState('smileys');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return EMOJI_CATEGORIES.find((c) => c.id === activeCat)?.emojis || [];
    }
    const q = search.trim();
    return EMOJI_CATEGORIES.flatMap((c) => c.emojis).filter((e) => e.includes(q));
  }, [activeCat, search]);

  return (
    <div
      className={`bg-[#12121D] border border-white/10 rounded-2xl shadow-2xl overflow-hidden w-[min(320px,92vw)] ${className}`}
      dir="rtl"
    >
      <div className="flex items-center gap-2 p-2 border-b border-white/5">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="بحث إيموجي..."
          className="flex-1 bg-white/5 rounded-xl px-3 py-1.5 text-xs text-white outline-none placeholder:text-white/30"
        />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 text-sm flex items-center justify-center"
          >
            ✕
          </button>
        )}
      </div>

      {!search && (
        <div className="flex gap-0.5 px-1.5 py-1.5 overflow-x-auto border-b border-white/5 scrollbar-hide">
          {EMOJI_CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCat(cat.id)}
              className={`w-8 h-8 rounded-lg text-base flex items-center justify-center shrink-0 transition ${
                activeCat === cat.id ? 'bg-violet-600/40 ring-1 ring-violet-500/50' : 'hover:bg-white/5'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-8 gap-0.5 p-2 max-h-48 overflow-y-auto">
        {filtered.map((emoji, i) => (
          <button
            key={`${emoji}-${i}`}
            type="button"
            onClick={() => onSelect(emoji)}
            className="w-9 h-9 rounded-lg text-xl flex items-center justify-center hover:bg-white/10 active:scale-90 transition"
          >
            {emoji}
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="col-span-8 text-center text-xs text-white/40 py-6">لا توجد نتائج</p>
        )}
      </div>
    </div>
  );
};

export default EmojiPicker;
