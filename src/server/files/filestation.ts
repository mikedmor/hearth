/**
 * The NAS's shared folders, through Synology's File Station API, as each person.
 *
 * Hearth never sees more than the person could in DSM: it signs in with their own NAS account,
 * so the NAS's permissions decide what they see. Their account and password are a secret
 * (`files:<who>`, never in the page and never for widgets); the session DSM hands back is kept in
 * memory and renewed by signing in again when DSM says it has ended.
 *
 * Everything is sent as a form POST, so a password never ends up in an address or a log.
 */
import type { Entry, Share } from "../../shared/files";

export type { Entry, Share };

export interface NasLogin {
  account: string;
  password: string;
  /** DSM's "trust this device" token, so two-step sign-in is asked only once. */
  did?: string;
}

export class FileStationError extends Error {
  /** The person has to sign in again (wrong password, or two-step sign-in is needed). */
  readonly needsSignIn: boolean;
  /** A two-step sign-in code is needed. */
  readonly needsCode: boolean;
  /** The answer Hearth gives the page. */
  readonly status: 400 | 401 | 403;
  constructor(
    message: string,
    /** DSM's own code (0 when it wasn't DSM that said no). */
    readonly code: number,
    opts: { needsSignIn?: boolean; needsCode?: boolean; status?: 400 | 401 | 403 } = {},
  ) {
    super(message);
    this.needsSignIn = opts.needsSignIn ?? false;
    this.needsCode = opts.needsCode ?? false;
    this.status = opts.status ?? 400;
  }
}

/** DSM's sign-in answers, in plain words. */
const AUTH_ERRORS: Record<number, string> = {
  400: "That NAS account or password isn't right.",
  401: "That NAS account is turned off.",
  402: "That NAS account isn't allowed to use File Station.",
  403: "Enter the code from your authenticator app.",
  404: "That code isn't right, or it ran out. Try the next one.",
  406: "The NAS wants this account to set up two-step sign-in first (in DSM).",
  407: "The NAS has blocked this address after too many tries. Wait, or unblock it in DSM.",
  408: "That NAS password has run out. Change it in DSM first.",
  409: "That NAS password has run out. Change it in DSM first.",
  410: "The NAS wants this password changed. Change it in DSM first.",
};

/** Answers that mean the session ended: sign in again and retry once. */
const SESSION_ENDED = new Set([105, 106, 107, 119]);

const FILE_ERRORS: Record<number, string> = {
  105: "You don't have permission to see that.",
  400: "That folder or file can't be opened.",
  401: "That isn't a file or folder.",
  407: "You don't have permission to see that.",
  408: "That folder or file isn't there anymore.",
};

export interface FileStationDeps {
  /** DSM's address, like https://nas.home or http://192.168.1.20:5000. */
  url: () => string | undefined;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class FileStation {
  private sessions = new Map<string, string>();

  constructor(private readonly deps: FileStationDeps) {}

  private base(): string {
    const url = this.deps.url()?.trim().replace(/\/+$/, "");
    if (!url) throw new FileStationError("The admin hasn't set the NAS's address yet.", 0);
    return url;
  }

  private async post(params: Record<string, string>, timeoutMs?: number): Promise<Response> {
    const doFetch = this.deps.fetch ?? fetch;
    try {
      return await doFetch(`${this.base()}/webapi/entry.cgi`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
        signal: AbortSignal.timeout(timeoutMs ?? this.deps.timeoutMs ?? 15_000),
      });
    } catch (e) {
      if (e instanceof FileStationError) throw e;
      const err = e as Error & { cause?: { code?: string } };
      throw new FileStationError(
        err.name === "TimeoutError"
          ? "The NAS didn't answer in time."
          : `Couldn't reach the NAS${err.cause?.code ? ` (${err.cause.code})` : ""}.`,
        0,
      );
    }
  }

  private async json(params: Record<string, string>): Promise<Record<string, unknown>> {
    const res = await this.post(params);
    const body = (await res.json().catch(() => null)) as {
      success?: boolean;
      data?: Record<string, unknown>;
      error?: { code?: number };
    } | null;
    if (!body) throw new FileStationError("The NAS's answer wasn't readable.", 0);
    if (!body.success) {
      const code = body.error?.code ?? 0;
      throw new FileStationError(FILE_ERRORS[code] ?? `The NAS said no (code ${code}).`, code);
    }
    return body.data ?? {};
  }

  /**
   * Sign in as this person. With a two-step code, DSM can also trust this device: the token comes
   * back in `did`, to keep with the login.
   */
  async signIn(who: string, login: NasLogin, code?: string): Promise<{ did?: string }> {
    const params: Record<string, string> = {
      api: "SYNO.API.Auth",
      version: "6",
      method: "login",
      account: login.account,
      passwd: login.password,
      session: "FileStation",
      format: "sid",
    };
    if (code) {
      params.otp_code = code;
      params.enable_device_token = "yes";
      params.device_name = "Hearth";
    } else if (login.did) params.device_id = login.did;
    let data: Record<string, unknown>;
    try {
      data = await this.json(params);
    } catch (e) {
      if (e instanceof FileStationError && AUTH_ERRORS[e.code]) {
        throw new FileStationError(AUTH_ERRORS[e.code] as string, e.code, {
          needsSignIn: true,
          needsCode: e.code === 403 || e.code === 404,
        });
      }
      throw e;
    }
    const sid = typeof data.sid === "string" ? data.sid : "";
    if (!sid) throw new FileStationError("The NAS didn't start a session.", 0);
    this.sessions.set(who, sid);
    const did = typeof data.did === "string" ? data.did : (data.device_id as string | undefined);
    return { did: did || login.did };
  }

  /** Forget this person's session (they disconnected). */
  forget(who: string): void {
    this.sessions.delete(who);
  }

  /** A File Station call as this person, signing in again once if their session ended. */
  private async call(
    who: string,
    login: NasLogin,
    params: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let sid = this.sessions.get(who);
      if (!sid) {
        await this.signIn(who, login);
        sid = this.sessions.get(who) as string;
      }
      try {
        return await this.json({ ...params, _sid: sid });
      } catch (e) {
        if (attempt === 0 && e instanceof FileStationError && SESSION_ENDED.has(e.code)) {
          this.sessions.delete(who);
          continue;
        }
        throw e;
      }
    }
    throw new FileStationError("The NAS kept ending the session.", 0);
  }

  /** The shared folders this person may open. */
  async shares(who: string, login: NasLogin): Promise<Share[]> {
    const data = await this.call(who, login, {
      api: "SYNO.FileStation.List",
      version: "2",
      method: "list_share",
      additional: JSON.stringify(["perm"]),
      sort_by: "name",
    });
    const shares = (data.shares as Record<string, unknown>[] | undefined) ?? [];
    return shares.map((s) => {
      const perm = (s.additional as { perm?: { acl?: { write?: boolean } } } | undefined)?.perm;
      return {
        name: String(s.name ?? ""),
        path: String(s.path ?? ""),
        readOnly: perm?.acl?.write === false,
      };
    });
  }

  /** What's in a folder, folders first. */
  async list(
    who: string,
    login: NasLogin,
    path: string,
    offset = 0,
    limit = 500,
  ): Promise<{ entries: Entry[]; total: number }> {
    if (!path.startsWith("/")) throw new FileStationError("That isn't a folder on the NAS.", 400);
    const data = await this.call(who, login, {
      api: "SYNO.FileStation.List",
      version: "2",
      method: "list",
      folder_path: path,
      additional: JSON.stringify(["size", "time"]),
      sort_by: "name",
      sort_direction: "asc",
      offset: String(offset),
      limit: String(limit),
    });
    const files = (data.files as Record<string, unknown>[] | undefined) ?? [];
    const entries: Entry[] = files.map((f) => {
      const extra = f.additional as { size?: number; time?: { mtime?: number } } | undefined;
      return {
        name: String(f.name ?? ""),
        path: String(f.path ?? ""),
        dir: Boolean(f.isdir),
        size: f.isdir ? undefined : extra?.size,
        mtime: extra?.time?.mtime,
      };
    });
    entries.sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
    return { entries, total: Number(data.total ?? entries.length) };
  }

  /**
   * A file (or a folder, which the NAS zips) as a stream, signing in again once if needed. The
   * caller passes the body straight on to the browser.
   */
  async download(who: string, login: NasLogin, path: string): Promise<Response> {
    if (!path.startsWith("/")) throw new FileStationError("That isn't a file on the NAS.", 400);
    for (let attempt = 0; attempt < 2; attempt++) {
      let sid = this.sessions.get(who);
      if (!sid) {
        await this.signIn(who, login);
        sid = this.sessions.get(who) as string;
      }
      const res = await this.post(
        {
          api: "SYNO.FileStation.Download",
          version: "2",
          method: "download",
          path: JSON.stringify([path]),
          mode: "download",
          _sid: sid,
        },
        // A big file takes as long as it takes; only the start has to be quick.
        60 * 60_000,
      );
      // An error comes back as JSON instead of the file.
      if ((res.headers.get("content-type") ?? "").includes("application/json")) {
        const body = (await res.json().catch(() => null)) as { error?: { code?: number } } | null;
        const code = body?.error?.code ?? 0;
        if (attempt === 0 && SESSION_ENDED.has(code)) {
          this.sessions.delete(who);
          continue;
        }
        throw new FileStationError(FILE_ERRORS[code] ?? `The NAS said no (code ${code}).`, code);
      }
      if (!res.ok) throw new FileStationError(`The NAS said ${res.status}.`, res.status);
      return res;
    }
    throw new FileStationError("The NAS kept ending the session.", 0);
  }
}
