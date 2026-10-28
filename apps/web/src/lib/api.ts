/** Typed HTTP client. Sends the CSRF token on state-changing requests and normalises errors. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId: string | null = null,
    public details: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const BASE = "/api/v1";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | null {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

type Body = Record<string, unknown> | unknown[] | FormData | undefined;

interface RequestOptions {
  signal?: AbortSignal;
  raw?: boolean; // return the Response (downloads)
}

async function request<T>(method: string, path: string, body?: Body, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (!SAFE.has(method)) {
    const csrf = readCookie("aether_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: payload,
      credentials: "same-origin",
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Cannot reach the Aether API. Is the backend running?");
  }
  if (!res.ok) {
    let code = `http_${res.status}`;
    let message = res.statusText || "Request failed";
    let requestId = res.headers.get("X-Request-ID");
    let details: unknown = null;
    try {
      const data = (await res.json()) as { error?: { code: string; message: string; request_id: string; details: unknown } };
      if (data.error) {
        ({ code, message, details } = data.error);
        requestId = data.error.request_id ?? requestId;
      }
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && path !== "/auth/status") {
      window.dispatchEvent(new CustomEvent("aether:unauthorized"));
    }
    throw new ApiError(res.status, code, message, requestId, details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>("GET", path, undefined, opts),
  post: <T>(path: string, body?: Body, opts?: RequestOptions) => request<T>("POST", path, body, opts),
  put: <T>(path: string, body?: Body) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: Body) => request<T>("PATCH", path, body),
  delete: <T = void>(path: string) => request<T>("DELETE", path),
  /** POST and save the response body as a file. */
  async download(path: string, body: Body, fallbackName: string): Promise<{ truncated: boolean }> {
    const res = await request<Response>("POST", path, body, { raw: true });
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") ?? "";
    const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { truncated: res.headers.get("X-Aether-Truncated") === "true" };
  },
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
