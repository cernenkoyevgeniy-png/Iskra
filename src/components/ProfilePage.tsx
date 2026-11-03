import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  updateProfile, checkNicknameTaken, listBlockedUsers, unblockUser,
} from '@/lib/profiles';
import AvatarEditor from '@/components/AvatarEditor';
import type { Profile } from '@/lib/types';
import { INTEREST_CATEGORIES } from '@/lib/types';
import {
  Loader2, AlertCircle, Check, X, Save, LogOut, EyeOff, Eye, School, Lock, Heart, MessageCircle,
} from 'lucide-react';
import Avatar from './Avatar';

export default function ProfilePage() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [nickname, setNickname] = useState(profile?.nickname ?? '');
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [avatar, setAvatar] = useState(profile?.avatar_url ?? '');
  const [interests, setInterests] = useState<string[]>(profile?.interests ?? []);
  const [hidden, setHidden] = useState(profile?.hidden_from_search ?? false);
  const [hiddenMatch, setHiddenMatch] = useState(profile?.hidden_from_match ?? false);
  const [school, setSchool] = useState(profile?.school ?? '');
  const [grade, setGrade] = useState(profile?.grade ?? '');
  const [showSchool, setShowSchool] = useState(profile?.show_school ?? false);
  const [dmPrivacy, setDmPrivacy] = useState<'all' | 'matches' | 'none'>(profile?.dm_privacy ?? 'all');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [blocked, setBlocked] = useState<Profile[] | null>(null);
  const [blockedLoading, setBlockedLoading] = useState(false);

  // Синхронизируем локальные поля при обновлении профиля из БД (обновление аватара,
  // повторный вход и т. п.), чтобы форма не показывала устаревшие значения.
  useEffect(() => {
    if (!profile) return;
    setNickname(profile.nickname);
    setBio(profile.bio);
    setAvatar(profile.avatar_url ?? '');
    setInterests(profile.interests);
    setHidden(profile.hidden_from_search);
    setHiddenMatch(profile.hidden_from_match);
    setSchool(profile.school ?? '');
    setGrade(profile.grade ?? '');
    setShowSchool(profile.show_school);
    setDmPrivacy(profile.dm_privacy ?? 'all');
  }, [profile]);

  if (!profile || !user) return null;

  const toggleInterest = (k: string) =>
    setInterests((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  const handleAvatarSaved = async (url: string) => {
    setMsg(null);
    try {
      await updateProfile(profile.id, { avatar_url: url });
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Аватар обновлён' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось сохранить аватар' });
    }
  };

  const handleAvatarRemoved = async () => {
    setMsg(null);
    try {
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Аватар удалён' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Не удалось обновить профиль' });
    }
  };

  const handleSave = async () => {
    setMsg(null);
    if (nickname.trim().length < 3) {
      setMsg({ kind: 'err', text: 'Никнейм должен быть не короче 3 символов' });
      return;
    }
    setSaving(true);
    try {
      if (nickname.trim() !== profile.nickname) {
        const taken = await checkNicknameTaken(nickname.trim());
        if (taken) {
          setMsg({ kind: 'err', text: 'Этот никнейм уже занят' });
          setSaving(false);
          return;
        }
      }
      await updateProfile(profile.id, {
        nickname: nickname.trim(),
        bio: bio.trim(),
        avatar_url: avatar.trim() || null,
        interests,
        hidden_from_search: hidden,
        hidden_from_match: hiddenMatch,
        school: school.trim() || null,
        grade: grade.trim() || null,
        show_school: showSchool,
        dm_privacy: dmPrivacy,
      });
      await refreshProfile();
      setMsg({ kind: 'ok', text: 'Профиль сохранён' });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : 'Ошибка сохранения' });
    } finally {
      setSaving(false);
    }
  };

  const loadBlocked = async () => {
    setBlockedLoading(true);
    try {
      setBlocked(await listBlockedUsers());
    } catch {
      setBlocked([]);
    } finally {
      setBlockedLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 sm:px-6">
      <h1 className="font-display text-2xl font-extrabold tracking-tight">Мой профиль</h1>

      <div className="mt-6 flex items-center gap-4">
        <div className="relative">
          <Avatar url={avatar} name={nickname} size="xl" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg font-bold">{profile.nickname}</p>
          <p className="text-xs text-white/45">В Искре с {new Date(profile.created_at).toLocaleDateString('ru-RU')}</p>
          <div className="mt-2">
            <AvatarEditor
              userId={profile.id}
              currentUrl={avatar || null}
              onSaved={handleAvatarSaved}
              onRemoved={handleAvatarRemoved}
            />
          </div>
        </div>
      </div>

      <div className="mt-8 space-y-5 rounded-3xl border border-white/10 bg-ink-900/50 p-6">
        <Field label="Никнейм" value={nickname} onChange={setNickname} />
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/55">О себе</span>
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            maxLength={240}
            placeholder="Пара слов о себе..."
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
          />
          <span className="mt-1 block text-right text-[11px] text-white/35">{bio.length}/240</span>
        </label>

        <div>
          <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-white/55">Интересы</span>
          <div className="flex flex-wrap gap-2">
            {INTEREST_CATEGORIES.map((c) => {
              const on = interests.includes(c.key);
              return (
                <button
                  key={c.key}
                  onClick={() => toggleInterest(c.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-all ${
                    on ? 'border-spark-500/60 bg-spark-500/20 text-white' : 'border-white/10 bg-white/5 text-white/70 hover:text-white'
                  }`}
                >
                  {on && <Check className="h-3.5 w-3.5 text-spark-300" />}
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-white/80">
            {hidden ? <EyeOff className="h-4 w-4 text-spark-300" /> : <Eye className="h-4 w-4 text-spark-300" />}
            Скрыть из поиска
          </span>
          <button
            onClick={() => setHidden((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${hidden ? 'bg-spark-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${hidden ? 'translate-x-5' : ''}`} style={{ left: '2px' }} />
          </button>
        </label>

        <label className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="flex items-center gap-2 text-sm text-white/80">
            {hiddenMatch ? <EyeOff className="h-4 w-4 text-spark-300" /> : <Heart className="h-4 w-4 text-spark-300" />}
            Не участвовать в Искра Match
          </span>
          <button
            onClick={() => setHiddenMatch((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${hiddenMatch ? 'bg-spark-500' : 'bg-white/15'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${hiddenMatch ? 'translate-x-5' : ''}`} style={{ left: '2px' }} />
          </button>
        </label>
        <p className="-mt-2 text-[11px] text-white/40">
          Включи, чтобы твои карточки не появлялись у других в Искра Match.
        </p>

        {/* Школа и класс */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/55">
            <School className="h-3.5 w-3.5 text-spark-300" /> Школа и класс
          </span>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              value={school}
              onChange={(e) => setSchool(e.target.value)}
              placeholder="Название школы"
              className="flex-1 rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
            />
            <input
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              placeholder="Класс (напр. 7А)"
              className="flex-1 rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
            />
          </div>
          <label className="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-ink-900/40 px-3.5 py-2.5">
            <span className="flex items-center gap-2 text-sm text-white/80">
              {showSchool ? <Eye className="h-4 w-4 text-spark-300" /> : <Lock className="h-4 w-4 text-white/50" />}
              Показывать школу и класс другим
            </span>
            <button
              onClick={() => setShowSchool((v) => !v)}
              className={`relative h-6 w-11 rounded-full transition-colors ${showSchool ? 'bg-spark-500' : 'bg-white/15'}`}
            >
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${showSchool ? 'translate-x-5' : ''}`} style={{ left: '2px' }} />
            </button>
          </label>
          <p className="mt-2 text-[11px] text-white/40">
            Пока выключено — школу и класс видишь только ты. Включи, чтобы тебя могли найти одноклассники.
          </p>
        </div>

        {/* Настройки приватности сообщений */}
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-white/55">
            <MessageCircle className="h-3.5 w-3.5 text-spark-300" /> Кто может написать мне первым
          </span>
          <div className="mt-3 flex flex-col gap-2">
            {([
              { value: 'all', label: 'Все пользователи' },
              { value: 'matches', label: 'Только из взаимных матчей' },
              { value: 'none', label: 'Никто (только если я писал первым)' },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-sm cursor-pointer transition-colors ${
                  dmPrivacy === opt.value
                    ? 'border-spark-500/60 bg-spark-500/10 text-white'
                    : 'border-white/10 bg-ink-900/40 text-white/70 hover:text-white'
                }`}
              >
                <input
                  type="radio"
                  name="dmPrivacy"
                  checked={dmPrivacy === opt.value}
                  onChange={() => setDmPrivacy(opt.value)}
                  className="sr-only"
                />
                <span className={`h-4 w-4 rounded-full border-2 ${dmPrivacy === opt.value ? 'border-spark-400 bg-spark-400' : 'border-white/30'}`} />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-white/40">
            Настройка применяется на сервере — никто не сможет обойти её.
          </p>
        </div>

        {msg && (
          <div className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-sm ${
            msg.kind === 'ok' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
          }`}>
            {msg.kind === 'err' ? <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
            <span>{msg.text}</span>
          </div>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-spark-500 to-rose-500 px-6 py-3 text-sm font-semibold text-white transition-transform hover:scale-105 disabled:opacity-70"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Сохранить
        </button>
      </div>

      <div className="mt-6 rounded-3xl border border-white/10 bg-ink-900/50 p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold">Заблокированные</h2>
          <button onClick={loadBlocked} className="text-sm text-spark-300 hover:underline">
            {blockedLoading ? 'Загрузка...' : 'Показать'}
          </button>
        </div>
        {blocked && (
          <div className="mt-4 space-y-2">
            {blocked.length === 0 && <p className="text-sm text-white/45">Список пуст</p>}
            {blocked.map((b) => (
              <div key={b.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                <Avatar url={b.avatar_url} name={b.nickname} size="xs" />
                <span className="flex-1 text-sm text-white">{b.nickname}</span>
                <button
                  onClick={async () => {
                    await unblockUser(b.id);
                    setBlocked((list) => (list ?? []).filter((x) => x.id !== b.id));
                  }}
                  className="inline-flex items-center gap-1 rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition-colors hover:text-white"
                >
                  <X className="h-3.5 w-3.5" /> Разблокировать
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={signOut}
        className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-white/80 transition-colors hover:bg-white/5 hover:text-white"
      >
        <LogOut className="h-4 w-4" /> Выйти
      </button>

      <p className="mt-8 text-xs text-white/35">
        Правила сообщества: будь дружелюбным, без оскорблений и спама. Нарушения модерируются по жалобам.
      </p>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/55">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-ink-900/60 px-3.5 py-3 text-sm text-white placeholder-white/30 outline-none focus:border-spark-500/60"
      />
    </label>
  );
}
