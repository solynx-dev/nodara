import { getItem, KEYS } from './storage';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Normalise what people type ("nodara.example.com/") into an origin. */
export function normalizeServer(input: string): string {
  let s = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  return new URL(s).origin;
}

let cache: { server: string | null; token: string | null } | null = null;
export function setCredentialsCache(server: string | null, token: string | null) {
  cache = { server, token };
}
async function credentials() {
  cache ??= { server: await getItem(KEYS.server), token: await getItem(KEYS.session) };
  return cache;
}

export async function request<T>(method: string, path: string, body?: unknown, opts: { token?: string | null; server?: string } = {}): Promise<T> {
  const c = await credentials();
  const server = opts.server ?? c.server;
  if (!server) throw new ApiError(0, 'no_server', 'Connect to a Nodara server first');
  const token = opts.token === undefined ? c.token : opts.token;
  let res: Response;
  try {
    res = await fetch(`${server}${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', `Can't reach ${server.replace(/^https?:\/\//, '')}. Check your connection.`);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, d.error ?? 'error', d.message ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export const api = {
  get: <T>(p: string) => request<T>('GET', p),
  post: <T>(p: string, b: unknown = {}) => request<T>('POST', p, b),
  patch: <T>(p: string, b: unknown = {}) => request<T>('PATCH', p, b),
  put: <T>(p: string, b: unknown = {}) => request<T>('PUT', p, b),
  del: <T>(p: string, b?: unknown) => request<T>('DELETE', p, b),
};

export function qs(params: Record<string, string | number | null | undefined>) {
  const parts = Object.entries(params)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}
