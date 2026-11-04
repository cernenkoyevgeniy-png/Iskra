import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  listMyGroups, createGroup, getGroup, listGroupMembers, addGroupMember,
  removeGroupMember, setGroupAdmin, leaveGroup, fetchGroupMessages, sendGroupMessage,
  searchPublicGroups, joinGroup, type PublicGroup,
  listMyInvitations, acceptInvitation, declineInvitation, type GroupInvitation,
} from '@/lib/groups';
import { searchProfiles } from '@/lib/profiles';
import type { Group, GroupMessage, Profile } from '@/lib/types';
import { supabase } from '@/lib/supabase';
import {
  Send, ArrowLeft, Loader2, AlertCircle, Users, Plus, X, Search, Crown,
  UserMinus, Shield, LogOut, Check, Globe, Lock, UserPlus, Mail,
} from 'lucide-react';
import Avatar from './Avatar';

type GroupMemberLite = { user_id: string; is_admin: boolean };

type View = 'my' | 'discover' | 'invites';

export default function GroupsPage({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>('my');
  const [groups, setGroups] = useState<(Group & { member_count: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeGroup, setActiveGroup] = useState<Group | null>(null);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [groupsData, invData] = await Promise.all([listMyGroups(), listMyInvitations()]);
      setGroups(groupsData);
      setInvitations(invData);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setErr(null);
    try {
      await createGroup(name, desc, isPublic);
      setName(''); setDesc(''); setIsPublic(true); setCreating(false);
      setView('my');
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось создать');
    }
  };

  if (activeGroup) {
    return <GroupChatView group={activeGroup} onBack={() => { setActiveGroup(null); load(); }} />;
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onBack} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-2xl font-extrabold tracking-tight">Группы</h1>
        </div>
        <button
          onClick={() => setCreating((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-spark-500 to-rose-500 px-4 py-2 text-sm font-semibold text-white transition-transform hover:scale-105"
        >
          <Plus className="h-4 w-4" /> Создать
        </button>
      </div>

      {creating && (
        <div className="mt-5 rounded-3xl border border-white/10 bg-ink-900/50 p-5">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Название группы"
            className="w-full rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={2}
            placeholder="Описание (необязательно)"
            className="mt-3 w-full resize-none rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
          />
          {/* Тип группы */}
          <div className="mt-4">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/55">Тип группы</span>
            <div className="flex gap-2">
              <button
                onClick={() => setIsPublic(true)}
                className={`flex flex-1 items-center gap-2 rounded-xl border px-3.5 py-3 text-sm transition-all ${
                  isPublic
                    ? 'border-spark-500/60 bg-spark-500/15 text-white'
                    : 'border-white/10 bg-white/[0.03] text-white/70 hover:text-white'
                }`}
              >
                <Globe className="h-4 w-4 shrink-0" />
                <div className="text-left">
                  <p className="font-semibold">Публичная</p>
                  <p className="text-[11px] text-white/45">Любой может найти и вступить</p>
                </div>
              </button>
              <button
                onClick={() => setIsPublic(false)}
                className={`flex flex-1 items-center gap-2 rounded-xl border px-3.5 py-3 text-sm transition-all ${
                  !isPublic
                    ? 'border-spark-500/60 bg-spark-500/15 text-white'
                    : 'border-white/10 bg-white/[0.03] text-white/70 hover:text-white'
                }`}
              >
                <Lock className="h-4 w-4 shrink-0" />
                <div className="text-left">
                  <p className="font-semibold">Частная</p>
                  <p className="text-[11px] text-white/45">Только по приглашению</p>
                </div>
              </button>
            </div>
          </div>
          {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => setCreating(false)} className="flex-1 rounded-full border border-white/15 py-2.5 text-sm text-white/70">Отмена</button>
            <button onClick={handleCreate} className="flex-1 rounded-full bg-gradient-to-r from-spark-500 to-rose-500 py-2.5 text-sm font-semibold text-white">Создать</button>
          </div>
        </div>
      )}

      {/* Вкладки */}
      {!creating && (
        <div className="mt-5 inline-flex rounded-full border border-white/10 bg-ink-900/60 p-1">
          <button
            onClick={() => setView('my')}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
              view === 'my' ? 'bg-gradient-to-r from-spark-500 to-rose-500 text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            <Users className="h-4 w-4" /> Мои группы
          </button>
          <button
            onClick={() => setView('discover')}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
              view === 'discover' ? 'bg-gradient-to-r from-spark-500 to-rose-500 text-white' : 'text-white/60 hover:text-white'
            }`}
          >
            <Search className="h-4 w-4" /> Поиск
          </button>
          {invitations.length > 0 && (
            <button
              onClick={() => setView('invites')}
              className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                view === 'invites' ? 'bg-gradient-to-r from-spark-500 to-rose-500 text-white' : 'text-white/60 hover:text-white'
              }`}
            >
              <Mail className="h-4 w-4" /> Приглашения
              <span className="rounded-full bg-spark-500 px-1.5 text-[10px] font-bold text-white">{invitations.length}</span>
            </button>
          )}
        </div>
      )}

      {view === 'my' && (
        <div className="mt-6 space-y-2">
          {loading && <p className="text-sm text-white/45">Загрузка...</p>}
          {!loading && groups.length === 0 && (
            <div className="rounded-3xl border border-white/10 bg-ink-900/50 p-10 text-center">
              <Users className="mx-auto h-10 w-10 text-white/30" />
              <p className="mt-3 text-sm text-white/55">Пока нет групп</p>
              <p className="mt-1 text-xs text-white/40">Создай свою или найди публичную во вкладке «Поиск»</p>
            </div>
          )}
          {groups.map((g) => (
            <button
              key={g.id}
              onClick={async () => {
                const full = await getGroup(g.id);
                if (full) setActiveGroup(full);
              }}
              className="card-hover flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/50 p-4 text-left"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-spark-500/40 to-rose-500/30">
                <Users className="h-6 w-6 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-display text-base font-bold text-white">{g.name}</p>
                  {g.is_public ? (
                    <Globe className="h-3.5 w-3.5 shrink-0 text-spark-300" />
                  ) : (
                    <Lock className="h-3.5 w-3.5 shrink-0 text-white/40" />
                  )}
                </div>
                {g.description && <p className="truncate text-sm text-white/55">{g.description}</p>}
              </div>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70">{g.member_count}</span>
            </button>
          ))}
        </div>
      )}

      {view === 'discover' && <DiscoverView onJoined={load} />}

      {view === 'invites' && (
        <InvitationsView
          invitations={invitations}
          onRespond={load}
        />
      )}
    </div>
  );
}

function DiscoverView({ onJoined }: { onJoined: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PublicGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    setLoading(true);
    setErr(null);
    try {
      const list = await searchPublicGroups(query, 30);
      setResults(list);
      setSearched(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка поиска');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  const handleJoin = async (groupId: string) => {
    setJoining(groupId);
    setErr(null);
    try {
      await joinGroup(groupId);
      setResults((prev) => prev.map((g) => g.id === groupId ? { ...g, is_member: true, member_count: g.member_count + 1 } : g));
      onJoined();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось вступить');
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="mt-6">
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Поиск публичных групп по названию..."
          className="w-full rounded-xl border border-white/10 bg-ink-900/60 py-3 pl-10 pr-3.5 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
        />
      </div>

      {err && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}

      <div className="mt-4 space-y-2">
        {loading && <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>}
        {!loading && searched && results.length === 0 && (
          <div className="rounded-3xl border border-white/10 bg-ink-900/50 p-10 text-center">
            <Search className="mx-auto h-10 w-10 text-white/30" />
            <p className="mt-3 text-sm text-white/55">Ничего не найдено</p>
            <p className="mt-1 text-xs text-white/40">Попробуй другой запрос или создай свою группу</p>
          </div>
        )}
        {results.map((g) => (
          <div
            key={g.id}
            className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/50 p-4"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-spark-500/40 to-rose-500/30">
              <Users className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate font-display text-base font-bold text-white">{g.name}</p>
                <Globe className="h-3.5 w-3.5 shrink-0 text-spark-300" />
              </div>
              {g.description && <p className="truncate text-sm text-white/55">{g.description}</p>}
              <p className="mt-0.5 text-[11px] text-white/40">{g.member_count} участников</p>
            </div>
            {g.is_member ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-spark-500/20 px-3 py-1.5 text-xs font-semibold text-spark-200">
                <Check className="h-3.5 w-3.5" /> Состою
              </span>
            ) : (
              <button
                onClick={() => handleJoin(g.id)}
                disabled={joining === g.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-spark-500 to-rose-500 px-4 py-2 text-xs font-semibold text-white transition-transform hover:scale-105 disabled:opacity-50"
              >
                {joining === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                Вступить
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GroupChatView({ group, onBack }: { group: Group; onBack: () => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<(GroupMessage & { sender_nickname: string })[]>([]);
  const [members, setMembers] = useState<(GroupMemberLite & { nickname: string; avatar_url: string | null })[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showMembers, setShowMembers] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const me = members.find((m) => m.user_id === user?.id);
  const isAdmin = !!me?.is_admin;

  const load = async () => {
    setLoading(true);
    try {
      const [msgs, mems] = await Promise.all([fetchGroupMessages(group.id), listGroupMembers(group.id)]);
      const memMap = new Map(mems.map((m) => [m.user_id, m.nickname]));
      setMessages(msgs.map((m) => ({ ...m, sender_nickname: memMap.get(m.sender_id) ?? '...' })));
      setMembers(mems.map((m) => ({ user_id: m.user_id, is_admin: m.is_admin, nickname: m.nickname, avatar_url: m.avatar_url })));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [group.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`group-${group.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'group_messages', filter: `group_id=eq.${group.id}` },
        async (payload) => {
          const m = payload.new as GroupMessage;
          const mems = await listGroupMembers(group.id);
          const mem = mems.find((x) => x.user_id === m.sender_id);
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, { ...m, sender_nickname: mem?.nickname ?? '...' }]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSend = async () => {
    if (!text.trim()) return;
    setSending(true);
    setErr(null);
    try {
      const m = await sendGroupMessage(group.id, text);
      setMessages((prev) => [...prev, { ...m, sender_nickname: 'ты' }]);
      setText('');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось отправить');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-4.5rem)] max-w-3xl flex-col">
      <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
        <button onClick={onBack} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-spark-500/40 to-rose-500/30">
          <Users className="h-5 w-5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate font-display text-base font-bold">{group.name}</p>
            {group.is_public ? (
              <Globe className="h-3.5 w-3.5 shrink-0 text-spark-300" />
            ) : (
              <Lock className="h-3.5 w-3.5 shrink-0 text-white/40" />
            )}
          </div>
          <p className="text-xs text-white/45">{members.length} участников</p>
        </div>
        <button onClick={() => setShowMembers((v) => !v)} className="rounded-full p-1.5 text-white/70 hover:bg-white/10 hover:text-white">
          <Users className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="space-y-2.5">
          {loading && <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-white/40" /></div>}
          {err && <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200"><AlertCircle className="h-4 w-4" /> {err}</div>}
          {!loading && messages.length === 0 && <p className="py-10 text-center text-sm text-white/45">Напиши первым в группе</p>}
          {messages.map((m) => {
            const mine = m.sender_id === user?.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm ${mine ? 'rounded-tr-sm bg-gradient-to-br from-spark-500 to-rose-500 text-white' : 'rounded-tl-sm bg-white/10 text-white'}`}>
                  {!mine && <p className="mb-0.5 text-[11px] font-semibold text-spark-300">{m.sender_nickname}</p>}
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-white/45'}`}>
                    {new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="border-t border-white/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            rows={1}
            placeholder="Сообщение в группу..."
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

      {showMembers && (
        <MembersPanel
          group={group}
          members={members}
          isAdmin={isAdmin}
          meId={user?.id ?? ''}
          onClose={() => setShowMembers(false)}
          onInvite={() => setInviteOpen(true)}
          onRefresh={load}
        />
      )}

      {inviteOpen && (
        <InviteModal group={group} existingIds={new Set(members.map((m) => m.user_id))} onClose={() => setInviteOpen(false)} onInvited={load} />
      )}
    </div>
  );
}

function MembersPanel({
  group, members, isAdmin, meId, onClose, onInvite, onRefresh,
}: {
  group: Group;
  members: (GroupMemberLite & { nickname: string; avatar_url: string | null })[];
  isAdmin: boolean;
  meId: string;
  onClose: () => void;
  onInvite: () => void;
  onRefresh: () => void;
}) {
  const handleRemove = async (uid: string) => {
    if (uid === meId) return;
    await removeGroupMember(group.id, uid);
    onRefresh();
  };
  const handleToggleAdmin = async (uid: string, val: boolean) => {
    await setGroupAdmin(group.id, uid, val);
    onRefresh();
  };
  const handleLeave = async () => {
    await leaveGroup(group.id);
    onClose();
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-ink-900 p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg font-bold">Участники ({members.length})</h2>
            {group.is_public ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-spark-500/15 px-2 py-0.5 text-[11px] font-semibold text-spark-200">
                <Globe className="h-3 w-3" /> Публичная
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/60">
                <Lock className="h-3 w-3" /> Частная
              </span>
            )}
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/55 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        {isAdmin && (
          <button onClick={onInvite} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-spark-500 to-rose-500 px-5 py-2.5 text-sm font-semibold text-white">
            <Plus className="h-4 w-4" /> Пригласить
          </button>
        )}
        {group.is_public && (
          <p className="mt-3 text-[11px] text-white/40">
            Публичная группа: любой может найти её в поиске и вступить сам. Приглашение нужно только для частных групп.
          </p>
        )}
        <div className="mt-4 space-y-2">
          {members.map((m) => (
            <div key={m.user_id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <Avatar url={m.avatar_url} name={m.nickname} size="sm" />
              <span className="flex-1 text-sm text-white">{m.nickname}{m.user_id === meId && ' (вы)'}</span>
              {m.is_admin && <Crown className="h-4 w-4 text-ember-400" />}
              {isAdmin && m.user_id !== meId && (
                <>
                  <button onClick={() => handleToggleAdmin(m.user_id, !m.is_admin)} className="rounded-full p-1 text-white/55 hover:text-white" title="Админ">
                    <Shield className="h-4 w-4" />
                  </button>
                  <button onClick={() => handleRemove(m.user_id)} className="rounded-full p-1 text-white/55 hover:text-rose-300" title="Удалить">
                    <UserMinus className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
        <button onClick={handleLeave} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-full border border-white/15 py-2.5 text-sm text-white/80 hover:bg-white/5">
          <LogOut className="h-4 w-4" /> Покинуть группу
        </button>
      </div>
    </div>
  );
}

function InviteModal({
  group, existingIds, onClose, onInvited,
}: {
  group: Group;
  existingIds: Set<string>;
  onClose: () => void;
  onInvited: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  const search = async () => {
    setLoading(true);
    try {
      const list = await searchProfiles({ query, limit: 20 });
      setResults(list.filter((p) => !existingIds.has(p.id)));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { search(); /* eslint-disable-next-line */ }, []);

  const invite = async (uid: string) => {
    setInviting(uid);
    try {
      await addGroupMember(group.id, uid);
      onInvited();
      onClose();
    } finally {
      setInviting(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-ink-900 p-6 shadow-2xl sm:rounded-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Пригласить в группу</h2>
          <button onClick={onClose} className="rounded-full p-1.5 text-white/55 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative mt-4">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Поиск по нику..."
            className="w-full rounded-xl border border-white/10 bg-ink-900/60 py-3 pl-10 pr-3.5 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
          />
        </div>
        <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
          {loading && <p className="text-sm text-white/45">Загрузка...</p>}
          {!loading && results.length === 0 && <p className="text-sm text-white/45">Никого не найдено</p>}
          {results.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-spark-500/40 to-rose-500/30 text-sm font-bold uppercase text-white">{p.nickname[0]}</div>
              <span className="flex-1 text-sm text-white">{p.nickname}</span>
              <button
                onClick={() => invite(p.id)}
                disabled={inviting === p.id}
                className="inline-flex items-center gap-1 rounded-full bg-spark-500/80 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {inviting === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Пригласить
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function InvitationsView({
  invitations,
  onRespond,
}: {
  invitations: GroupInvitation[];
  onRespond: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const handleAccept = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await acceptInvitation(id);
      onRespond();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async (id: string) => {
    setBusy(id);
    setErr(null);
    try {
      await declineInvitation(id);
      onRespond();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-6 space-y-2">
      {err && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
          <AlertCircle className="h-4 w-4 shrink-0" /> {err}
        </div>
      )}
      {invitations.length === 0 && (
        <div className="rounded-3xl border border-white/10 bg-ink-900/50 p-10 text-center">
          <Mail className="mx-auto h-10 w-10 text-white/30" />
          <p className="mt-3 text-sm text-white/55">Нет приглашений</p>
        </div>
      )}
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-900/50 p-4"
        >
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-spark-500/40 to-rose-500/30">
            <Users className="h-6 w-6 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-base font-bold text-white">{inv.group_name}</p>
            <p className="text-xs text-white/55">
              Приглашение от <span className="text-spark-300">{inv.inviter_nickname}</span>
            </p>
          </div>
          <button
            onClick={() => handleDecline(inv.id)}
            disabled={busy === inv.id}
            className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold text-white/70 hover:text-white disabled:opacity-50"
          >
            {busy === inv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
            Отклонить
          </button>
          <button
            onClick={() => handleAccept(inv.id)}
            disabled={busy === inv.id}
            className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-spark-500 to-rose-500 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy === inv.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Принять
          </button>
        </div>
      ))}
    </div>
  );
}
