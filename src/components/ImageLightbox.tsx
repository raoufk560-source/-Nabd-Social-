import React, { useEffect } from 'react';
import { X, ZoomIn } from 'lucide-react';

/** نافذة تكبير الصور عند الضغط — للعامة والخاص */
export const ImageLightbox: React.FC<{
  src: string | null;
  onClose: () => void;
}> = ({ src, onClose }) => {
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [src, onClose]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[200] bg-black/92 backdrop-blur-md flex items-center justify-center p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      dir="rtl"
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 left-4 p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white z-10"
        aria-label="إغلاق"
      >
        <X className="w-5 h-5" />
      </button>
      <div className="absolute top-4 right-4 flex items-center gap-1.5 text-white/50 text-xs font-bold">
        <ZoomIn className="w-3.5 h-3.5" />
        اضغط للخروج
      </div>
      <img
        src={src}
        alt="صورة مكبرة"
        referrerPolicy="no-referrer"
        className="max-w-full max-h-[90dvh] object-contain rounded-xl shadow-2xl select-none"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  );
};

/** صورة قابلة للضغط للتكبير */
export const ZoomableImage: React.FC<{
  src: string;
  alt?: string;
  className?: string;
  onOpen?: (src: string) => void;
}> = ({ src, alt = 'صورة', className = '', onOpen }) => {
  return (
    <button
      type="button"
      className="block p-0 border-0 bg-transparent cursor-zoom-in max-w-full"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.(src);
      }}
      title="اضغط للتكبير"
    >
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        className={className}
      />
    </button>
  );
};
