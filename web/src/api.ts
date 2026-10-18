const TOKEN_KEY = 'ops_token';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null) =>
  token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY);

// Carries the HTTP status and the server's JSON body, so the UI can react to 409/403
// and show the server's own reason.
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any) {
    super(message);
  }
}

// Small fetch wrapper: adds the token, sends/parses JSON, and turns non-2xx into ApiError.
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const token = getToken();
  const res = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await res.json().catch(() => null);

  if (res.status === 401 && path !== '/auth/login') {
    setToken(null); // token expired or invalid: back to login
    window.location.assign('/login');
  }
  if (!res.ok) throw new ApiError(res.status, body?.error ?? `Request failed (${res.status})`, body);
  return body as T;
}

// A random Idempotency-Key. crypto.randomUUID() exists only on https/localhost and in newer browsers
// (e.g. not on a phone opening the laptop over http://192.168..., or iOS before 15.4), so fall back to
// getRandomValues(), which works everywhere.
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
