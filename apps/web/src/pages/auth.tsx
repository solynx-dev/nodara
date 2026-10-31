import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { startAuthentication } from '@simplewebauthn/browser';
import { CheckCircle2, Fingerprint, KeyRound, MailCheck } from 'lucide-react';
import type { Me } from '@nodara/shared';
import { api, ApiError } from '@/lib/api';
import { useConfig, useMe } from '@/lib/queries';
import { AuthLayout } from '@/components/AuthLayout';
import { Button, ErrorNote, Input } from '@/components/ui';

function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function useAfterLogin() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  return async (user: Me) => {
    qc.setQueryData(['me'], user);
    await qc.invalidateQueries({ queryKey: ['config'] });
    navigate(safeNext(params.get('next')), { replace: true });
  };
}

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'totp'>('password');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useAfterLogin();
  const { data: config } = useConfig();
  const { data: me } = useMe();
  const [params] = useSearchParams();
  if (config?.needsSetup) return <Navigate to="/setup" replace />;
  if (me) return <Navigate to={safeNext(params.get('next'))} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (step === 'password') {
        const r = await api.post<{ user?: Me; twoFactorRequired?: boolean }>('/api/auth/login', { email, password });
        if (r.twoFactorRequired) setStep('totp');
        else await done(r.user!);
      } else {
        const r = await api.post<{ user: Me }>('/api/auth/2fa', { code });
        await done(r.user);
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const passkey = async () => {
    setError(null);
    setBusy(true);
    try {
      const { challengeId, options } = await api.post<{ challengeId: string; options: Parameters<typeof startAuthentication>[0]['optionsJSON'] }>(
        '/api/auth/passkeys/login/options',
      );
      const response = await startAuthentication({ optionsJSON: options });
      const r = await api.post<{ user: Me }>('/api/auth/passkeys/login/verify', { challengeId, response });
      await done(r.user);
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (step === 'totp') {
    return (
      <AuthLayout title="Two-step verification" subtitle="Enter the 6-digit code from your authenticator app, or one of your recovery codes.">
        <form onSubmit={submit} className="space-y-4">
          <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="numeric" autoFocus required />
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            Verify
          </Button>
          <Button type="button" variant="ghost" className="w-full" onClick={() => setStep('password')}>
            Back
          </Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={`Sign in to ${config?.instanceName ?? 'Nodara'}`}
      subtitle="Welcome back. Your circle is waiting."
      footer={
        config?.registrationPolicy === 'open' ? (
          <>
            New here?{' '}
            <Link to="/register" className="font-bold text-accent-text">
              Create an account
            </Link>
          </>
        ) : (
          'Need an account? Ask your server administrator or a circle invite link.'
        )
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username webauthn" required autoFocus />
        <Input
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          hint={
            <Link to="/forgot-password" className="font-semibold text-ink-2 hover:text-ink">
              Forgot password?
            </Link>
          }
        />
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Sign in
        </Button>
        {'PublicKeyCredential' in window && (
          <>
            <div className="flex items-center gap-3 text-[12px] font-semibold text-muted">
              <div className="h-px flex-1 bg-line" /> or <div className="h-px flex-1 bg-line" />
            </div>
            <Button type="button" size="lg" className="w-full" onClick={passkey} disabled={busy} icon={<Fingerprint className="size-5" />}>
              Sign in with a passkey
            </Button>
          </>
        )}
      </form>
    </AuthLayout>
  );
}

export function SetupPage() {
  const [form, setForm] = useState({ displayName: '', email: '', password: '', setupToken: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useAfterLogin();
  const { data: config } = useConfig();
  const { data: me } = useMe();
  if (config && !config.needsSetup) return <Navigate to={me ? '/' : '/login'} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me }>('/api/auth/setup', { ...form, setupToken: form.setupToken || undefined });
      await done(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Set up your Nodara server" subtitle="Create the administrator account. You'll be able to invite your family next.">
      <form onSubmit={submit} className="space-y-4">
        <Input label="Your name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" required autoFocus />
        <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
        <Input label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={10} required hint="At least 10 characters. A passphrase works great." />
        <Input label="Setup token (if configured)" value={form.setupToken} onChange={(e) => setForm({ ...form, setupToken: e.target.value })} hint="Only needed if your server sets SETUP_TOKEN." />
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
          Create administrator
        </Button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage({ inviteToken, circleName }: { inviteToken?: string; circleName?: string }) {
  const [form, setForm] = useState({ displayName: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useAfterLogin();
  const { data: config } = useConfig();
  const closed = !inviteToken && config && config.registrationPolicy !== 'open';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: Me }>('/api/auth/register', { ...form, inviteToken });
      await done(r.user);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout
      title={circleName ? `Join ${circleName}` : 'Create your account'}
      subtitle={circleName ? 'Create an account to start sharing with your circle.' : 'Start sharing locations with the people who matter.'}
      footer={
        <>
          Already have an account?{' '}
          <Link to={inviteToken ? `/login?next=/join/${inviteToken}` : '/login'} className="font-bold text-accent-text">
            Sign in
          </Link>
        </>
      }
    >
      {closed ? (
        <ErrorNote error={new Error(config!.registrationPolicy === 'invite' ? 'This server is invite-only. Open the invitation link you received to create an account.' : 'Registration is closed. Ask the administrator to create an account for you.')} />
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="Your name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} autoComplete="name" required autoFocus />
          <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" required />
          <Input label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={10} required hint="At least 10 characters." />
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            {circleName ? 'Create account & join' : 'Create account'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<null | { emailEnabled: boolean }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setSent(await api.post<{ emailEnabled: boolean }>('/api/auth/forgot-password', { email }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title="Reset your password" subtitle="We'll email you a link to choose a new one." footer={<Link to="/login" className="font-bold text-accent-text">Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-2xl border border-line bg-surface p-5 text-[14px] leading-relaxed">
          <MailCheck className="mb-3 size-6 text-success" />
          If an account exists for <b>{email}</b>, a reset link is on its way.
          {!sent.emailEnabled && (
            <p className="mt-3 text-muted">
              This server has no email configured. Ask your administrator to send you a reset link from <b>Administration → Users</b>.
            </p>
          )}
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const welcome = params.get('welcome') === '1';
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthLayout title={welcome ? 'Welcome to Nodara' : 'Choose a new password'} subtitle={welcome ? 'An account was created for you. Choose a password to finish setting it up.' : undefined}>
      {done ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-[14px]">
            <CheckCircle2 className="size-6 text-success" /> Password saved. You can sign in now.
          </div>
          <Link to="/login">
            <Button variant="primary" size="lg" className="w-full">
              Sign in
            </Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Input label="New password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} required autoFocus hint="At least 10 characters." />
          <ErrorNote error={error} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} icon={<KeyRound className="size-4" />}>
            Save password
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [error, setError] = useState<unknown>(null);
  const qc = useQueryClient();
  const verify = async () => {
    try {
      await api.post('/api/auth/verify-email', { token: params.get('token') ?? '' });
      setState('ok');
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch (e) {
      setError(e instanceof ApiError ? e : new Error('Verification failed'));
      setState('error');
    }
  };
  return (
    <AuthLayout title="Verify your email">
      {state === 'ok' ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 text-[14px]">
            <CheckCircle2 className="size-6 text-success" /> Your email address is verified.
          </div>
          <Link to="/">
            <Button variant="primary" size="lg" className="w-full">
              Continue
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          <ErrorNote error={error} />
          <Button variant="primary" size="lg" className="w-full" onClick={verify}>
            Confirm email address
          </Button>
        </div>
      )}
    </AuthLayout>
  );
}
