import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import SparkMark from '@/components/SparkMark';
import { Loader2, AlertCircle, Mail, Lock, User, ArrowRight, ArrowLeft } from 'lucide-react';

type Mode = 'signin' | 'signup' | 'reset';

export default function AuthScreen() {
  const [mode, setMode] = useState<Mode>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reset = () => {
    setError(null);
    setInfo(null);
  };

  const validateNickname = (nick: string) => {
    if (nick.length < 3) return 'Никнейм должен быть не короче 3 символов';
    if (nick.length > 24) return 'Никнейм должен быть не длиннее 24 символов';
    if (!/^[a-zA-Z0-9_а-яА-ЯёЁ.\-]+$/.test(nick))
      return 'Допустимы буквы, цифры, _, . и -';
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    reset();
    setLoading(true);
    try {
      if (mode === 'reset') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (err) throw err;
        setInfo('Ссылка для восстановления пароля отправлена на почту.');
        return;
      }

      if (mode === 'signup') {
        const nickErr = validateNickname(nickname);
        if (nickErr) throw new Error(nickErr);
        if (password.length < 6) throw new Error('Пароль должен быть не короче 6 символов');

        const { data: nickAvailable } = await supabase.rpc('check_nickname_available', { p_nickname: nickname.trim() });
        if (nickAvailable === false) throw new Error('Этот никнейм уже занят. Придумай другой.');

        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nickname } },
        });
        if (err) throw err;
        if (!data.user) throw new Error('Не удалось создать аккаунт');
        setInfo('Аккаунт создан. Проверь почту для подтверждения, затем войди.');
        setMode('signin');
        return;
      }

      // signin
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) {
        if (err.message.toLowerCase().includes('not confirmed')) {
          throw new Error('Подтверди email по ссылке из письма перед входом.');
        }
        throw err;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Произошла ошибка';
      // Подсказка про занятый никнейм
      if (msg.toLowerCase().includes('nickname') || msg.toLowerCase().includes('duplicate')) {
        setError('Этот никнейм уже занят. Придумай другой.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const title = mode === 'signup' ? 'Создать профиль' : mode === 'signin' ? 'Войти' : 'Восстановить пароль';
  const buttonLabel =
    mode === 'signup' ? 'Зарегистрироваться' : mode === 'signin' ? 'Войти' : 'Отправить ссылку';

  return (
    <div className="relative min-h-screen overflow-hidden bg-ink-950">
      <div className="absolute inset-0 -z-10 bg-radial-spark" />
      <div className="absolute inset-0 -z-10 bg-grid [mask-image:radial-gradient(70%_60%_at_50%_30%,black,transparent)]" />
      <div className="absolute -left-24 top-32 -z-10 h-72 w-72 rounded-full bg-spark-500/20 blur-3xl animate-glow" />
      <div className="absolute right-0 top-20 -z-10 h-96 w-96 rounded-full bg-rose-500/15 blur-3xl animate-glow [animation-delay:1.5s]" />

      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-10 sm:px-6">
        <div className="mb-7 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center">
            <SparkMark className="h-12 w-12" animate />
          </div>
          <h1 className="mt-4 font-display text-2xl font-extrabold tracking-tight">Искра</h1>
          <p className="mt-1 text-sm text-white/55">Найди своих. Зажги общение.</p>
        </div>

        <div className="glass rounded-3xl p-7 shadow-2xl">
          <h2 className="font-display text-xl font-bold">{title}</h2>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'signup' && (
              <Field
                icon={<User className="h-4 w-4" />}
                label="Никнейм"
                value={nickname}
                onChange={(v) => { setNickname(v); reset(); }}
                placeholder="например, миша"
                autoComplete="username"
              />
            )}
            <Field
              icon={<Mail className="h-4 w-4" />}
              label="Email"
              type="email"
              value={email}
              onChange={(v) => { setEmail(v); reset(); }}
              placeholder="you@example.com"
              autoComplete="email"
            />
            {mode !== 'reset' && (
              <Field
                icon={<Lock className="h-4 w-4" />}
                label="Пароль"
                type="password"
                value={password}
                onChange={(v) => { setPassword(v); reset(); }}
                placeholder="минимум 6 символов"
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              />
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {info && (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-2.5 text-sm text-emerald-200">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-spark-500 via-rose-500 to-ember-500 px-6 py-3.5 text-base font-semibold text-white shadow-xl shadow-spark-500/30 transition-transform duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : buttonLabel}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          <div className="mt-6 space-y-2 text-center text-sm">
            {mode !== 'signin' && (
              <button
                onClick={() => { setMode('signin'); reset(); }}
                className="inline-flex items-center gap-1.5 text-white/65 transition-colors hover:text-white"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Уже есть аккаунт? Войти
              </button>
            )}
            {mode !== 'signup' && (
              <button
                onClick={() => { setMode('signup'); reset(); }}
                className="block w-full text-white/65 transition-colors hover:text-white"
              >
                Нет аккаунта? Зарегистрироваться
              </button>
            )}
            {mode !== 'reset' && (
              <button
                onClick={() => { setMode('reset'); reset(); }}
                className="block w-full text-white/45 transition-colors hover:text-white/70"
              >
                Забыли пароль?
              </button>
            )}
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-white/40">
          Без телефона · без школы · без геолокации
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  icon,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  icon: React.ReactNode;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-white/55">
        {label}
      </span>
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/40">
          {icon}
        </span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required
          className="w-full rounded-xl border border-white/10 bg-ink-900/60 py-3 pl-10 pr-3.5 text-sm text-white placeholder-white/30 outline-none transition-colors focus:border-spark-500/60 focus:bg-ink-900/80"
        />
      </div>
    </label>
  );
}
