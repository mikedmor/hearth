/** Talking to Hearth's server. Every change carries the header the server requires (CSRF). */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: string[] = [],
    /** The whole answer, for anything else it said (like that a sign-in code is needed). */
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    method,
    headers: {
      accept: "application/json",
      ...(method !== "GET" ? { "x-hearth": "1" } : {}),
      ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; issues?: string[] };
    throw new ApiError(
      d.error ?? `Hearth answered ${res.status}.`,
      res.status,
      d.issues ?? [],
      typeof data === "object" && data ? (data as Record<string, unknown>) : {},
    );
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T = { ok: true }>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T = { ok: true }>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T = { ok: true }>(path: string) => request<T>("DELETE", path),
  text: async (path: string) => {
    const res = await fetch(path, { credentials: "same-origin" });
    if (!res.ok) throw new ApiError(`Hearth answered ${res.status}.`, res.status);
    return res.text();
  },
};

/** POST and read server-sent events, one JSON object per event. Abort with the signal. */
export async function streamEvents<E>(
  path: string,
  body: unknown,
  onEvent: (e: E) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream", "x-hearth": "1" },
    body: JSON.stringify(body),
    signal,
    credentials: "same-origin",
  });
  if (!res.ok || !res.body) {
    let msg = `Hearth answered ${res.status}.`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // Not JSON.
    }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut !== -1) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          onEvent(JSON.parse(data) as E);
        } catch {
          // A malformed event: skip it.
        }
      }
      cut = buffer.indexOf("\n\n");
    }
  }
}

/** Per-device storage that never throws (private windows, blocked storage). */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // The choice lasts for this visit only.
    }
  },
};
