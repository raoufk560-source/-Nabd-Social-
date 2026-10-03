import React, { useEffect, useState } from 'react';
import { X, Newspaper, Pin, Trash2, Image as ImageIcon, Mic, Send, Loader2 } from 'lucide-react';
import { useApp } from '../contexts/AppContext';
import { apiFetch, uploadMediaFile } from '../services/api';

interface NewsItem {
  id: string;
  title: string;
  body: string;
  media_url: string;
  media_type: string;
  audio_url: string;
  author_name: string;
  is_pinned: number;
  created_at: number;
}

export const NewsModal: React.FC<{ onClose: () => void; canPublish?: boolean }> = ({
  onClose,
  canPublish = false
}) => {
  const { addToast } = useApp();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('text');
  const [audioUrl, setAudioUrl] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await apiFetch<{ news: NewsItem[] }>('/api/news');
      setItems(r.news || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadMediaFile(file);
      setMediaUrl(up.url);
      setMediaType(file.type.startsWith('video/') ? 'video' : 'image');
      addToast('تم رفع الوسائط', 'success');
    } catch (err: any) {
      addToast(err?.message || 'فشل الرفع', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleUploadAudio = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const up = await uploadMediaFile(file);
      setAudioUrl(up.url);
      addToast('تم رفع الصوت', 'success');
    } catch (err: any) {
      addToast(err?.message || 'فشل الرفع', 'error');
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!title.trim() && !body.trim() && !mediaUrl && !audioUrl) {
      addToast('أضف محتوى للخبر', 'error');
      return;
    }
    setPublishing(true);
    try {
      await apiFetch('/api/news', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          mediaUrl,
          mediaType,
          audioUrl,
          isPinned
        })
      });
      addToast('تم نشر الخبر', 'success');
      setTitle('');
      setBody('');
      setMediaUrl('');
      setAudioUrl('');
      setIsPinned(false);
      setShowComposer(false);
      load();
    } catch (err: any) {
      addToast(err?.message || 'فشل النشر', 'error');
    } finally {
      setPublishing(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm('حذف هذا الخبر؟')) return;
    try {
      await apiFetch(`/api/news/${id}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((x) => x.id !== id));
      addToast('تم الحذف', 'success');
    } catch (err: any) {
      addToast(err?.message || 'فشل الحذف', 'error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" dir="rtl">
      <div className="bg-[#0B0D13] border border-white/10 rounded-t-3xl sm:rounded-3xl w-full max-w-lg max-h-[92dvh] flex flex-col shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-violet-600/20 flex items-center justify-center">
              <Newspaper className="w-4 h-4 text-violet-300" />
            </div>
            <div>
              <h2 className="text-sm font-extrabold text-white">الأخبار والتحديثات</h2>
              <p className="text-[10px] text-white/40">إعلانات الإدارة</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {canPublish && (
              <button
                type="button"
                onClick={() => setShowComposer((v) => !v)}
                className="px-3 py-1.5 rounded-xl bg-violet-600 text-white text-[11px] font-bold"
              >
                {showComposer ? 'إلغاء' : 'نشر خبر'}
              </button>
            )}
            <button type="button" onClick={onClose} className="p-2 rounded-xl hover:bg-white/10 text-white/70">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showComposer && canPublish && (
          <div className="p-3 border-b border-white/10 space-y-2 bg-[#12121D] shrink-0">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="عنوان الخبر (مثال: تحديث الموقع)"
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-white outline-none focus:border-violet-500"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              placeholder="نص الخبر..."
              className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-sm text-white outline-none focus:border-violet-500 resize-none"
            />
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-[11px] text-white/70 cursor-pointer">
                <ImageIcon className="w-3.5 h-3.5" />
                {uploading ? 'رفع...' : 'صورة/فيديو'}
                <input type="file" accept="image/*,video/*" className="hidden" onChange={handleUploadImage} disabled={uploading} />
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 text-[11px] text-white/70 cursor-pointer">
                <Mic className="w-3.5 h-3.5" />
                صوت
                <input type="file" accept="audio/*" className="hidden" onChange={handleUploadAudio} disabled={uploading} />
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-white/70 cursor-pointer">
                <input type="checkbox" checked={isPinned} onChange={(e) => setIsPinned(e.target.checked)} />
                تثبيت أعلى القائمة
              </label>
            </div>
            {(mediaUrl || audioUrl) && (
              <div className="text-[10px] text-emerald-400 space-y-1">
                {mediaUrl && <div>وسائط: تم الإرفاق</div>}
                {audioUrl && <div>صوت: تم الإرفاق</div>}
              </div>
            )}
            <button
              type="button"
              disabled={publishing}
              onClick={publish}
              className="w-full py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              نشر للجميع
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading && (
            <div className="flex justify-center py-10 text-white/40">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="text-center py-12 text-white/40 text-sm">لا توجد أخبار بعد</div>
          )}
          {items.map((n) => (
            <article
              key={n.id}
              className="rounded-2xl bg-[#12121D] border border-white/8 overflow-hidden"
            >
              <div className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      {Boolean(n.is_pinned) && <Pin className="w-3 h-3 text-amber-400 shrink-0" />}
                      <h3 className="text-sm font-extrabold text-white truncate">{n.title || 'خبر'}</h3>
                    </div>
                    <div className="text-[10px] text-white/40 mt-0.5">
                      {n.author_name} ·{' '}
                      {new Date(n.created_at).toLocaleString('ar-SA', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                  </div>
                  {canPublish && (
                    <button type="button" onClick={() => remove(n.id)} className="p-1.5 text-rose-400/80 hover:text-rose-300">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {n.body && <p className="chat-msg-text text-sm text-white/80 leading-relaxed">{n.body}</p>}
                {n.media_url && n.media_type === 'image' && (
                  <img src={n.media_url} alt="" className="w-full max-h-64 object-cover rounded-xl" />
                )}
                {n.media_url && n.media_type === 'video' && (
                  <video src={n.media_url} controls className="w-full max-h-64 rounded-xl" />
                )}
                {n.audio_url && <audio src={n.audio_url} controls className="w-full h-10 mt-1" />}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NewsModal;
