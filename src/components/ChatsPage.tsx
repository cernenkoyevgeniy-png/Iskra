import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  fetchConversations, fetchDirectMessages, sendDirectMessage, markConversationRead,
  deleteDirectMessage, type ConversationRow,
} from '@/lib/messages';
import { getProfile } from '@/lib/profiles';
import type { DirectMessage, Profile } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import {
  Send, ArrowLeft, Loader2, AlertCircle, MessageCircle, Users, Search, Trash2, X,
} from 'lucide-react';
import SparkMark from './SparkMark';
import Avatar from './Avatar';

type Props = {
  initialUserId: string | null;
  onClearInitial: () => void;
  onOpenGroups: () => void;
};

export default function ChatsPage({ initialUserId, onClearInitial, onOpenGroups }: Props) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeUser, setActiveUser] = useState<Profile | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const loadConversations = async () => {
    try {
      setConversations(await fetchConversations());
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadConversations(); /* eslint-disable-next-line */ }, []);

  useEffect(() => {
    if (!initialUserId) return;
    (async () => {
      const p = await getProfile(initialUserId);
      if (p) openConversation(p);
      onClearInitial();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUserId]);

  const openConversation = (p: Profile) => {
    setActiveUser(p);
    setActiveId(p.id);
  };

  if (activeUser && activeId) {
    return (
      <ConversationView
        other={activeUser}
        onBack={() => { setActiveUser(null); setActiveId(null); loadConversations(); }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-2xl font-extrabold tracking-tight">Чаты</h1>
        <button
          onClick={onOpenGroups}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-white/85 transition-colors hover:bg-white/5"
        >
          <Users className="h-4 w-4" /> Группы
        </button>
      </div>

      <div className="mt-6 space-y-2">
        {loading && <p className="text-sm text-white/45">Загрузка...</p>}
        {!loading && conversations.length === 0 && (
          <div className="rounded-3xl border border-white/10 bg-ink-900/50 p-10 text-center">
            <MessageCircle className="mx-auto h-10 w-10 text-white/30" />
            <p className="mt-3 text-sm text-white/55">Пока нет диалогов</p>
            <p className="mt-1 text-xs text-white/40">Найди людей во вкладке «Люди» и напиши первым</p>
          </div>
        )}
        {conversations.map((c) => (
          <button
            key={c.other_user_id}
            onClick={() => {
              setActiveUser({
                id: c.other_user_id,
                nickname: c.other_nickname,
                avatar_url: c.other_avatar,
                bio: '', interests: [], hidden_from_search: false, hidden_from_match: false,
                school: null, grade: null, show_school: false,
                created_at: '', updated_at: '',
              });
              setActiveId(c.other_user_id);
            }}
            className="card-hover flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/50 p-4 text-left"
          >
            <Avatar url={c.other_avatar} name={c.other_nickname} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-base font-bold text-white">{c.other_nickname}</p>
              <p className="truncate text-sm text-white/55">{c.last_body}</p>
            </div>
            {c.unread > 0 && (
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-spark-500 px-1.5 text-xs font-bold text-white">
                {c.unread}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function ConversationView({ other, onBack }: { other: Profile; onBack: () => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await fetchDirectMessages(other.id);
      setMessages(list);
      await markConversationRead(other.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [other.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`dm-${user?.id}-${other.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `recipient_id=eq.${user?.id}`,
        },
        (payload) => {
          const m = payload.new as DirectMessage;
          if (m.sender_id === other.id) {
            setMessages((prev) => (prev.some((x) => x.id === m.id || (x.id === '' && x.body === m.body && x.sender_id === m.sender_id)) ? prev.map((x) => x.id === '' && x.body === m.body ? m : x) : [...prev, m]));
            markConversationRead(other.id);
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'direct_messages',
          filter: `sender_id=eq.${user?.id}`,
        },
        (payload) => {
          const m = payload.new as DirectMessage;
          if (m.recipient_id === other.id) {
            setMessages((prev) => (prev.some((x) => x.id === m.id || (x.id === '' && x.body === m.body && x.sender_id === m.sender_id)) ? prev.map((x) => x.id === '' && x.body === m.body ? m : x) : [...prev, m]));
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'direct_messages',
        },
        (payload) => {
          const m = payload.new as DirectMessage;
          if (
            (m.sender_id === other.id && m.recipient_id === user?.id) ||
            (m.sender_id === user?.id && m.recipient_id === other.id)
          ) {
            setMessages((prev) => prev.map((x) => (x.id === m.id ? m : x)));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other.id, user?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!text.trim()) return;
    const body = text.trim();
    setSending(true);
    setErr(null);
    try {
      const m = await sendDirectMessage(other.id, body);
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id && m.id)) return prev;
        if (prev.some((x) => x.id === '' && x.body === body && x.sender_id === m.sender_id)) {
          return prev.map((x) => x.id === '' && x.body === body ? m : x);
        }
        return [...prev, m];
      });
      setText('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    setErr(null);
    try {
      await deleteDirectMessage(confirmDeleteId);
      setMessages((prev) =>
        prev.map((x) =>
          x.id === confirmDeleteId ? { ...x, body: '', deleted_at: new Date().toISOString() } : x,
        ),
      );
      setConfirmDeleteId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось удалить сообщение');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="relative mx-auto flex h-[calc(100vh-4.5rem)] max-w-3xl flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button onClick={onBack} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <Avatar url={other.avatar_url} name={other.nickname} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-base font-bold">{other.nickname}</p>
        </div>
        <SparkMark className="h-5 w-5" />
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
        {loading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>}
        {err && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4" /> {err}
          </div>
        )}
        {!loading && messages.length === 0 && (
          <div className="py-10 text-center text-sm text-white/45">
            Пока пусто. Напиши первым — поздоровайся!
          </div>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          const deleted = !!m.deleted_at;
          return (
            <div key={m.id} className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`relative max-w-[80%] ${mine ? 'items-end' : 'items-start'}`}>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                    deleted
                      ? 'italic text-white/40 border border-white/10 bg-white/[0.03]'
                      : mine
                        ? 'bg-gradient-to-br from-spark-500 to-rose-500 text-white'
                        : 'bg-white/10 text-white'
                  } ${mine ? 'rounded-tr-sm' : 'rounded-tl-sm'}`}
                >
                  <p className="whitespace-pre-wrap break-words">{deleted ? 'Сообщение удалено' : m.body}</p>
                  <p className={`mt-1 text-[10px] ${deleted ? 'text-white/30' : mine ? 'text-white/70' : 'text-white/45'}`}>
                    {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                {mine && !deleted && (
                  <button
                    onClick={() => setConfirmDeleteId(m.id)}
                    className="absolute -top-2 left-0 hidden h-6 w-6 items-center justify-center rounded-full border border-white/15 bg-ink-800 text-white/55 transition-colors hover:text-rose-300 group-hover:flex"
                    title="Удалить сообщение"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {confirmDeleteId && (
        <div className="absolute inset-0 z-50 flex items-end justify-center bg-black/50 p-4 backdrop-blur-sm sm:items-center" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-ink-900 p-6 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/15">
              <Trash2 className="h-5 w-5 text-rose-300" />
            </div>
            <p className="mt-4 font-display text-lg font-bold">Удалить сообщение?</p>
            <p className="mt-2 text-sm text-white/55">Сообщение исчезнет и станет недоступным для обоих участников переписки.</p>
            <div className="mt-5 flex gap-2">
              <button onClick={() => setConfirmDeleteId(null)} className="flex-1 rounded-full border border-white/15 py-2.5 text-sm text-white/70">Отмена</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-full bg-rose-500/80 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Удалить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
            }}
            rows={1}
            placeholder="Сообщение..."
            className="max-h-32 flex-1 resize-none rounded-2xl border border-white/10 bg-ink-900/60 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
          />
          <button
            onClick={handleSend}
            disabled={sending || !text.trim()}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-spark-500 to-rose-500 text-white transition-transform hover:scale-105 disabled:opacity-50"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
