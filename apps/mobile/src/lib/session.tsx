import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, normalizeServer, request, setCredentialsCache } from './api';
import { getItem, KEYS, setItem } from './storage';
import type { Me, PublicConfig } from './types';
import { passkeySignIn } from './account';
import { stopTracking } from '@/background/tracking';

type LoginResult = { user?: Me; token?: string; twoFactorRequired?: boolean };

interface SessionValue {
  ready: boolean;
  server: string | null;
  config: PublicConfig | null;
  signedIn: boolean;
  me: Me | null;
  connect: (input: string) => Promise<PublicConfig>;
  disconnect: () => Promise<void>;
  /** 'verify': the server wants the account's email confirmed first (a code was emailed). */
  signIn: (email: string, password: string) => Promise<'ok' | '2fa' | 'verify'>;
  signInWithPasskey: () => Promise<boolean>;
  /** Waiting for a two-step code after a password sign-in. */
  pending2fa: boolean;
  verifyCode: (code: string) => Promise<void>;
  signOut: () => Promise<void>;
  setMe: (me: Me) => void;
}

const Ctx = createContext<SessionValue | null>(null);
export function useSession() {
  const v = use(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
export function useMe(): Me {
  const { me } = useSession();
  if (!me) throw new Error('useMe used while signed out');
  return me;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [server, setServer] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    void (async () => {
      const [s, t] = await Promise.all([getItem(KEYS.server), getItem(KEYS.session)]);
      setCredentialsCache(s, t);
      setServer(s);
      setToken(t);
      if (s) request<PublicConfig>('GET', '/api/config', undefined, { server: s, token: null }).then(setConfig, () => {});
      setReady(true);
    })();
  }, []);

  const meQuery = useQuery({
    queryKey: ['me'],
    enabled: Boolean(server && token),
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          // Session expired or revoked from another device.
          await setItem(KEYS.session, null);
          setCredentialsCache(server, null);
          setToken(null);
          return null;
        }
        throw e;
      }
    },
    staleTime: 30_000,
  });

  const saveToken = useCallback(
    async (t: string, user: Me) => {
      await setItem(KEYS.session, t);
      setCredentialsCache(server, t);
      setToken(t);
      qc.setQueryData(['me'], user);
    },
    [qc, server],
  );

  const connect = useCallback(async (input: string) => {
    const s = normalizeServer(input);
    const cfg = await request<PublicConfig>('GET', '/api/config', undefined, { server: s, token: null });
    if (!cfg || typeof cfg.instanceName !== 'string') throw new ApiError(0, 'not_nodara', "That address doesn't look like a Nodara server.");
    await setItem(KEYS.server, s);
    setCredentialsCache(s, null);
    setServer(s);
    setConfig(cfg);
    return cfg;
  }, []);

  const disconnect = useCallback(async () => {
    await Promise.all([KEYS.server, KEYS.session, KEYS.deviceId, KEYS.deviceToken].map((k) => setItem(k, null)));
    setCredentialsCache(null, null);
    setServer(null);
    setToken(null);
    setConfig(null);
    qc.clear();
  }, [qc]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      let r: LoginResult;
      try {
        r = await request<LoginResult>('POST', '/api/auth/login', { email, password, client: 'native' }, { token: null });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'email_unverified') return 'verify' as const;
        throw e;
      }
      if (r.twoFactorRequired && r.token) {
        // After a password reset this phone's old session is gone; show the code step on the sign-in screen.
        await setItem(KEYS.session, null);
        setCredentialsCache(server, null);
        setToken(null);
        setPending(r.token);
        return '2fa' as const;
      }
      await saveToken(r.token!, r.user!);
      return 'ok' as const;
    },
    [saveToken, server],
  );

  const signInWithPasskey = useCallback(async () => {
    const r = await passkeySignIn();
    if (!r) return false;
    await saveToken(r.token, r.user);
    return true;
  }, [saveToken]);

  const verifyCode = useCallback(
    async (code: string) => {
      const r = await request<LoginResult>('POST', '/api/auth/2fa', { code }, { token: pending });
      setPending(null);
      await saveToken(r.token!, r.user!);
    },
    [pending, saveToken],
  );

  const signOut = useCallback(async () => {
    await stopTracking().catch(() => {});
    const deviceId = await getItem(KEYS.deviceId);
    // Revoke this phone's device token so it can't keep posting locations.
    if (deviceId) await api.del(`/api/devices/${deviceId}`).catch(() => {});
    await api.post('/api/auth/logout').catch(() => {});
    await Promise.all([KEYS.session, KEYS.deviceId, KEYS.deviceToken].map((k) => setItem(k, null)));
    setCredentialsCache(server, null);
    setToken(null);
    qc.clear();
  }, [qc, server]);

  const me = (token && meQuery.data) || null;
  const value = useMemo<SessionValue>(
    () => ({
      ready: ready && (!token || !meQuery.isLoading),
      server,
      config,
      signedIn: Boolean(me),
      me,
      connect,
      disconnect,
      signIn,
      signInWithPasskey,
      pending2fa: Boolean(pending),
      verifyCode,
      signOut,
      setMe: (m) => qc.setQueryData(['me'], m),
    }),
    [ready, token, meQuery.isLoading, server, config, me, connect, disconnect, signIn, signInWithPasskey, pending, verifyCode, signOut, qc],
  );
  return <Ctx value={value}>{children}</Ctx>;
}
