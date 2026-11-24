// Same-origin JSON client for the accounts / projects API (kallax.abpq.cc/api/*).
// The session lives in an HttpOnly cookie set by the server: every call sends
// credentials: 'same-origin'. On hosts without the API (kallax.pages.dev, a
// plain static server) /api/* answers 404 or the SPA's HTML: see `isApiResponse`.

export type ApiErrorCode =
  | 'network'        // fetch failed (offline, DNS, CORS…)
  | 'unavailable'    // no API on this host (404 / HTML / not JSON)
  | 'unauthorized'   // 401: no or expired session
  | 'too_large'      // 413
  | 'invalid_email' | 'rate_limited'
  | 'invalid_code' | 'expired' | 'too_many_attempts'
  | 'not_found'
  | 'server';        // anything else

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    readonly body: Record<string, unknown> = {},
  ) { super(code); }
  /** `retryAfter` (seconds) of a 429 rate_limited answer. */
  get retryAfter(): number | undefined {
    const v = Number(this.body.retryAfter);
    return Number.isFinite(v) && v > 0 ? v : undefined;
  }
  /** `attemptsLeft` of a 400 invalid_code answer. */
  get attemptsLeft(): number | undefined {
    const v = Number(this.body.attemptsLeft);
    return Number.isFinite(v) ? v : undefined;
  }
}

const KNOWN = new Set<ApiErrorCode>(['unauthorized', 'too_large', 'invalid_email', 'rate_limited', 'invalid_code', 'expired', 'too_many_attempts', 'not_found']);

function isJson(r: Response) {
  return (r.headers.get('content-type') || '').toLowerCase().includes('application/json');
}

/** Call the API. Resolves with the parsed JSON body, rejects with an ApiError. */
export async function api<T = Record<string, unknown>>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('network', 0);
  }
  if (!isJson(r)) {
    // Static hosting: 404 page or the SPA's index.html. A 413 from a proxy may also be HTML.
    if (r.status === 413) throw new ApiError('too_large', 413);
    throw new ApiError(r.status >= 500 ? 'server' : 'unavailable', r.status);
  }
  let data: Record<string, unknown>;
  try { data = await r.json(); } catch { throw new ApiError('unavailable', r.status); }
  if (r.ok) return data as T;
  const err = String(data?.error ?? '') as ApiErrorCode;
  if (KNOWN.has(err)) throw new ApiError(err, r.status, data);
  if (r.status === 401) throw new ApiError('unauthorized', 401, data);
  if (r.status === 413) throw new ApiError('too_large', 413, data);
  if (r.status === 404) throw new ApiError('not_found', 404, data);
  throw new ApiError('server', r.status, data);
}
