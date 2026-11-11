/**
 * Google Calendar, both ways: sign-in with Google's OAuth, then its Calendar API.
 *
 * Google only sends a sign-in back to a public address or to the computer the browser runs on,
 * and `start.home` is neither. So Hearth uses a "Desktop app" client: Google sends the browser to
 * http://127.0.0.1:53682/?code=…, which doesn't open (nothing listens there), and the person copies
 * that address back into Hearth. PKCE and a one-time `state` tie the code to the person who
 * started. The refresh token is a secret; access tokens live only in memory.
 */
import { createHash, randomBytes } from "node:crypto";
import type { Repeat } from "../../shared/calendar";
import { guardedFetch, type NetPolicy } from "../net";
import { utcRule } from "./ics";

export const GOOGLE_REDIRECT = "http://127.0.0.1:53682/";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export class GoogleError extends Error {
  constructor(
    message: string,
    /** The account has to be connected again. */
    readonly signedOut = false,
  ) {
    super(message);
  }
}

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
}

export interface GoogleOptions {
  policy: NetPolicy;
  fetch?: typeof fetch;
}

// ---------------------------------------------------------------------------
// Signing in

export interface PendingSignIn {
  state: string;
  verifier: string;
  person: string;
  expires: number;
  /** Where Google sent the browser back to: it has to be the same when the code is used. */
  redirect: string;
}

/**
 * Start a sign-in. With `via` (a public "return page"), Google sends the browser there,
 * and the page forwards it home to `home` + "/calendar", which is carried in the state.
 * Without it, Google sends the browser to 127.0.0.1, to be copied back by hand.
 */
export function startSignIn(
  client: GoogleClient,
  person: string,
  now = Date.now(),
  via?: { page: string; home: string },
) {
  const verifier = randomBytes(32).toString("base64url");
  const redirect = via?.page ?? GOOGLE_REDIRECT;
  const state = via
    ? `${randomBytes(16).toString("base64url")}.${Buffer.from(via.home).toString("base64url")}`
    : randomBytes(16).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(AUTH);
  for (const [k, v] of Object.entries({
    client_id: client.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }))
    url.searchParams.set(k, v);
  const pending: PendingSignIn = {
    state,
    verifier,
    person,
    expires: now + 15 * 60_000,
    redirect,
  };
  return { url: url.href, pending };
}

/** What the person pasted: the whole address Google sent them to, or just its code. */
export function readPasted(pasted: string): { code: string; state?: string; error?: string } {
  const text = pasted.trim();
  const query = text.includes("?") ? text.slice(text.indexOf("?") + 1) : text;
  if (query.includes("=")) {
    const q = new URLSearchParams(query.split("#")[0]);
    return {
      code: q.get("code") ?? "",
      state: q.get("state") ?? undefined,
      error: q.get("error") ?? undefined,
    };
  }
  return { code: text };
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function token(form: Record<string, string>, opts: GoogleOptions): Promise<TokenAnswer> {
  const res = await guardedFetch(TOKEN, {
    method: "POST",
    policy: opts.policy,
    fetch: opts.fetch,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  let data: TokenAnswer = {};
  try {
    data = JSON.parse(res.body.toString("utf8")) as TokenAnswer;
  } catch {
    // Not JSON.
  }
  if (res.status >= 400 || !data.access_token) {
    if (data.error === "invalid_grant")
      throw new GoogleError(
        "Google didn't accept that sign-in (it may be old or used already). Start again.",
        true,
      );
    if (data.error === "invalid_client")
      throw new GoogleError(
        "Google didn't recognise Hearth's client. The admin should check the client ID and secret (Settings → Calendars).",
      );
    throw new GoogleError(
      `Google said no${data.error_description ? `: ${data.error_description}` : ` (${res.status})`}.`,
    );
  }
  return data;
}

export async function finishSignIn(
  client: GoogleClient,
  code: string,
  verifier: string,
  opts: GoogleOptions,
  redirect = GOOGLE_REDIRECT,
): Promise<{ refresh: string; access: string; expires: number }> {
  const t = await token(
    {
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
      code_verifier: verifier,
    },
    opts,
  );
  if (!t.refresh_token)
    throw new GoogleError(
      "Google didn't give Hearth lasting access. Remove Hearth at myaccount.google.com/permissions and connect again.",
    );
  return {
    refresh: t.refresh_token,
    access: t.access_token as string,
    expires: Date.now() + (t.expires_in ?? 3600) * 1000,
  };
}

// ---------------------------------------------------------------------------
// The Calendar API

export interface GoogleCalendarItem {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  accessRole?: string;
  primary?: boolean;
}

interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurringEventId?: string;
  originalStartTime?: GoogleTime;
  recurrence?: string[];
  etag?: string;
}

export interface GoogleEventInput {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  location?: string;
  notes?: string;
  repeat?: Repeat;
  until?: string;
}

/** One connected Google account: refreshes its access token as needed. */
export class GoogleAccount {
  private access?: { token: string; expires: number };

  constructor(
    private readonly client: GoogleClient,
    private readonly refreshToken: string,
    private readonly opts: GoogleOptions,
  ) {}

  /** Start with the access token from signing in, so the first calls don't refresh at once. */
  prime(access: string, expires: number): this {
    this.access = { token: access, expires };
    return this;
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.access && this.access.expires > Date.now() + 60_000)
      return this.access.token;
    try {
      const t = await token(
        {
          client_id: this.client.clientId,
          client_secret: this.client.clientSecret,
          refresh_token: this.refreshToken,
          grant_type: "refresh_token",
        },
        this.opts,
      );
      this.access = {
        token: t.access_token as string,
        expires: Date.now() + (t.expires_in ?? 3600) * 1000,
      };
      return this.access.token;
    } catch (e) {
      if (e instanceof GoogleError && e.signedOut)
        throw new GoogleError(
          "Google signed Hearth out of this account (or it was a test app's 7-day sign-in). Connect it again.",
          true,
        );
      throw e;
    }
  }

  private async call<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await guardedFetch(`${API}${path}`, {
        method,
        policy: this.opts.policy,
        fetch: this.opts.fetch,
        timeoutMs: 15_000,
        maxBytes: 20 * 1024 * 1024,
        headers: {
          authorization: `Bearer ${await this.accessToken(attempt > 0)}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.status === 401 && attempt === 0) continue;
      if (method === "DELETE" && (res.status === 410 || res.status === 404)) return null;
      const text = res.body.toString("utf8");
      if (res.status >= 400) {
        let message = "";
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
        } catch {
          // Not JSON.
        }
        if (res.status === 403 && /insufficient/i.test(message))
          throw new GoogleError(
            "Hearth wasn't given access to calendars. Connect the account again and tick the calendar boxes.",
            true,
          );
        throw new GoogleError(
          `Google Calendar said no${message ? `: ${message}` : ` (${res.status})`}.`,
        );
      }
      return text ? (JSON.parse(text) as T) : null;
    }
    throw new GoogleError("Google didn't accept Hearth's sign-in.", true);
  }

  async calendars(): Promise<GoogleCalendarItem[]> {
    const out: GoogleCalendarItem[] = [];
    let page: string | undefined;
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({ maxResults: "250", ...(page ? { pageToken: page } : {}) });
      const r = await this.call<{ items?: GoogleCalendarItem[]; nextPageToken?: string }>(
        "GET",
        `/users/me/calendarList?${q}`,
      );
      out.push(...(r?.items ?? []));
      page = r?.nextPageToken;
      if (!page) break;
    }
    return out;
  }

  /** Every time something happens between `from` and `to`; repeating events come one per time. */
  async events(calendarId: string, from: number, to: number): Promise<GoogleEvent[]> {
    const out: GoogleEvent[] = [];
    let page: string | undefined;
    for (let i = 0; i < 10; i++) {
      const q = new URLSearchParams({
        timeMin: new Date(from).toISOString(),
        timeMax: new Date(to).toISOString(),
        singleEvents: "true",
        maxResults: "2500",
        ...(page ? { pageToken: page } : {}),
      });
      const r = await this.call<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        "GET",
        `/calendars/${encodeURIComponent(calendarId)}/events?${q}`,
      );
      out.push(...(r?.items ?? []).filter((e) => e.status !== "cancelled"));
      page = r?.nextPageToken;
      if (!page) break;
    }
    return out;
  }

  async create(calendarId: string, input: GoogleEventInput): Promise<GoogleEvent> {
    const r = await this.call<GoogleEvent>(
      "POST",
      `/calendars/${encodeURIComponent(calendarId)}/events`,
      googleBody(input, true),
    );
    if (!r) throw new GoogleError("Google didn't say the event was made.");
    return r;
  }

  /** Change one event, or one time of a repeating one (its instance id). */
  async update(calendarId: string, eventId: string, input: GoogleEventInput, series: boolean) {
    await this.call(
      "PATCH",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      googleBody(input, series),
    );
  }

  /**
   * Bring in an event from a calendar file, known by the file's own id (iCalUID): importing the
   * same one again updates it instead of adding a second copy.
   */
  async importEvent(
    calendarId: string,
    e: {
      uid: string;
      title: string;
      start: string;
      end: string;
      allDay: boolean;
      timeZone?: string;
      location?: string;
      notes?: string;
      repeat?: Repeat;
      rrule?: string;
      except: string[];
    },
  ): Promise<void> {
    const when = (w: string): GoogleTime =>
      e.allDay
        ? { date: w.slice(0, 10) }
        : { dateTime: new Date(w).toISOString(), timeZone: e.timeZone ?? "UTC" };
    const recurrence: string[] = [];
    if (e.rrule) recurrence.push(`RRULE:${utcRule(e.rrule, e.timeZone).toString()}`);
    else if (e.repeat) recurrence.push(`RRULE:FREQ=${FREQ[e.repeat]}`);
    if (recurrence.length && e.except.length)
      recurrence.push(
        e.allDay
          ? `EXDATE;VALUE=DATE:${e.except.map((d) => d.slice(0, 10).replace(/-/g, "")).join(",")}`
          : `EXDATE:${e.except.map((x) => new Date(x).toISOString().replace(/[-:]|\.\d{3}/g, "")).join(",")}`,
      );
    await this.call("POST", `/calendars/${encodeURIComponent(calendarId)}/events/import`, {
      iCalUID: e.uid,
      summary: e.title,
      location: e.location ?? "",
      description: e.notes ?? "",
      start: when(e.start),
      end: when(e.end),
      ...(recurrence.length ? { recurrence } : {}),
    });
  }

  async remove(calendarId: string, eventId: string): Promise<void> {
    await this.call(
      "DELETE",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  }
}

const FREQ: Record<Repeat, string> = {
  daily: "DAILY",
  weekly: "WEEKLY",
  monthly: "MONTHLY",
  yearly: "YEARLY",
};

function googleBody(input: GoogleEventInput, withRepeat: boolean) {
  const when = (w: string): GoogleTime =>
    input.allDay
      ? { date: w.slice(0, 10) }
      : { dateTime: new Date(normal(w)).toISOString(), timeZone: input.timeZone };
  const until = input.until
    ? input.allDay
      ? input.until.replace(/-/g, "")
      : `${input.until.replace(/-/g, "")}T235959Z`
    : undefined;
  return {
    summary: input.title,
    location: input.location ?? "",
    description: input.notes ?? "",
    start: when(input.start),
    end: when(input.end),
    ...(withRepeat
      ? {
          recurrence: input.repeat
            ? [`RRULE:FREQ=${FREQ[input.repeat]}${until ? `;UNTIL=${until}` : ""}`]
            : [],
        }
      : {}),
  };
}

const normal = (w: string) => (/Z|[+-]\d{2}:\d{2}$/.test(w) ? w : `${w}Z`);

/** Google's descriptions can hold a little HTML; the page shows text. */
export function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
  return text || undefined;
}

/** A Google time as the page wants it: a day, or an instant. */
export function googleWhen(t: GoogleTime | undefined): string {
  if (!t) return "";
  if (t.date) return t.date;
  return t.dateTime ? new Date(t.dateTime).toISOString() : "";
}
