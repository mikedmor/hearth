/**
 * Talking to AdGuard Home: on the router, it answers every device's DNS, so it knows the
 * devices on the network and when each last asked for something. Hearth reads its clients and
 * query log, and writes only its own block of custom filtering rules (the internet controls).
 * Every request goes through the network guard; the password is a secret.
 */
import { guardedFetch, type NetPolicy } from "../net";

export class AdGuardError extends Error {}

/** The start of the names of AdGuard Home clients Hearth keeps (one per child): "Hearth: Ava". */
export const HEARTH_CLIENT = "Hearth: ";

export interface AdGuardOptions {
  url: string;
  username?: string;
  password?: string;
  policy: NetPolicy;
  fetch?: typeof fetch;
}

export interface AdGuardStatus {
  version?: string;
  running?: boolean;
  protection_enabled?: boolean;
}

/** A device AdGuard Home was told about (a "persistent client"). */
export interface AdGuardClient {
  name: string;
  ids: string[];
  tags?: string[];
}

/** A persistent client's settings, as AdGuard Home 0.107 stores them (the parts Hearth sets). */
export interface AdGuardClientSettings {
  name: string;
  ids: string[];
  tags?: string[];
  use_global_settings?: boolean;
  filtering_enabled?: boolean;
  parental_enabled?: boolean;
  safebrowsing_enabled?: boolean;
  safe_search?: {
    enabled: boolean;
    bing: boolean;
    duckduckgo: boolean;
    ecosia: boolean;
    google: boolean;
    pixabay: boolean;
    yandex: boolean;
    youtube: boolean;
  };
  use_global_blocked_services?: boolean;
  blocked_services?: string[] | null;
  [more: string]: unknown;
}

/** A device AdGuard Home found by itself: from the router's DHCP, ARP, reverse DNS or hosts. */
export interface AdGuardAutoClient {
  ip: string;
  name?: string;
  source?: string;
}

export interface AdGuardQuery {
  client: string;
  time: string;
  client_info?: { name?: string };
  question?: { name?: string; type?: string };
  /** Why it was answered so: "FilteredBlackList" (blocked by a rule), "NotFilteredNotFound"… */
  reason?: string;
  rules?: { text?: string }[];
}

/** What AdGuard Home would do with a name for a client (`/control/filtering/check_host`). */
export interface AdGuardCheck {
  reason?: string;
  rules?: { text?: string }[];
}

/** Answers that a filter or rule blocked (not allowed, not just made safe). */
export const isBlocked = (reason?: string): boolean =>
  Boolean(reason?.startsWith("Filtered")) && reason !== "FilteredSafeSearch";

export class AdGuard {
  constructor(private readonly o: AdGuardOptions) {}

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const base = this.o.url.replace(/\/+$/, "");
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.o.username)
      headers.authorization = `Basic ${Buffer.from(`${this.o.username}:${this.o.password ?? ""}`).toString("base64")}`;
    const res = await guardedFetch(`${base}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      policy: this.o.policy,
      fetch: this.o.fetch,
      headers,
      timeoutMs: 8000,
      maxBytes: 8 * 1024 * 1024,
    });
    if (res.status === 401 || res.status === 403)
      throw new AdGuardError("AdGuard Home didn't accept that username and password.");
    if (res.status === 404)
      throw new AdGuardError(
        "That address doesn't look like AdGuard Home's page (no /control/status).",
      );
    if (res.status >= 400) {
      const why = res.body.toString("utf8").trim().slice(0, 200);
      throw new AdGuardError(`AdGuard Home answered ${res.status}${why ? `: ${why}` : "."}`);
    }
    // Writes answer "OK", or nothing.
    if (method !== "GET") return undefined as T;
    try {
      return JSON.parse(res.body.toString("utf8")) as T;
    } catch {
      throw new AdGuardError(
        "AdGuard Home's answer wasn't what Hearth expected. Is that its address?",
      );
    }
  }

  status(): Promise<AdGuardStatus> {
    return this.get<AdGuardStatus>("/control/status");
  }

  async clients(): Promise<{ clients: AdGuardClient[]; auto: AdGuardAutoClient[] }> {
    const r = await this.get<{
      clients?: AdGuardClient[] | null;
      auto_clients?: AdGuardAutoClient[] | null;
    }>("/control/clients");
    return { clients: r.clients ?? [], auto: r.auto_clients ?? [] };
  }

  /** The most recent lookups, newest first: who's been active, and when. */
  async recent(limit = 1000): Promise<AdGuardQuery[]> {
    const r = await this.get<{ data?: AdGuardQuery[] | null }>(`/control/querylog?limit=${limit}`);
    return r.data ?? [];
  }

  /** One page of the query log, newest first; older than a time when given. */
  async queryLog(opts: { olderThan?: string; limit?: number; search?: string } = {}): Promise<{
    data: AdGuardQuery[];
    oldest?: string;
  }> {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 500) });
    if (opts.olderThan) q.set("older_than", opts.olderThan);
    // A name or a client's address; AdGuard Home matches parts too, so callers check exactly.
    if (opts.search) q.set("search", opts.search);
    const r = await this.get<{ data?: AdGuardQuery[] | null; oldest?: string }>(
      `/control/querylog?${q}`,
    );
    return { data: r.data ?? [], oldest: r.oldest || undefined };
  }

  /** The custom filtering rules (Filters → Custom filtering rules), every line. */
  async userRules(): Promise<string[]> {
    const r = await this.get<{ user_rules?: string[] | null }>("/control/filtering/status");
    return r.user_rules ?? [];
  }

  /** Replace the custom filtering rules. Callers keep every line that isn't theirs. */
  async setUserRules(rules: string[]): Promise<void> {
    await this.request("POST", "/control/filtering/set_rules", { rules });
  }

  /** Persistent clients with all their settings. */
  async persistentClients(): Promise<AdGuardClientSettings[]> {
    const r = await this.get<{ clients?: AdGuardClientSettings[] | null }>("/control/clients");
    return r.clients ?? [];
  }

  async addClient(c: AdGuardClientSettings): Promise<void> {
    await this.request("POST", "/control/clients/add", c);
  }

  async updateClient(name: string, c: AdGuardClientSettings): Promise<void> {
    await this.request("POST", "/control/clients/update", { name, data: c });
  }

  async deleteClient(name: string): Promise<void> {
    await this.request("POST", "/control/clients/delete", { name });
  }

  /** The apps and services AdGuard Home can block, with their groups. */
  async services(): Promise<{ id: string; name: string; group_id?: string }[]> {
    const r = await this.get<{
      blocked_services?: { id: string; name: string; group_id?: string }[] | null;
    }>("/control/blocked_services/all");
    return r.blocked_services ?? [];
  }

  /** What AdGuard Home would do with a name, asked as if by a client. */
  checkHost(name: string, client?: string): Promise<AdGuardCheck> {
    const q = new URLSearchParams({ name });
    if (client) q.set("client", client);
    return this.get<AdGuardCheck>(`/control/filtering/check_host?${q}`);
  }
}
