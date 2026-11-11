/**
 * The smart-home hubs the admin connected: their devices and readings, kept fresh with the
 * device monitor (once a minute), and switching what they control.
 */
import type { Settings } from "../../shared/config";
import {
  HUB_NAMES,
  HUBS,
  type HubKind,
  type HubState,
  type SmartHomeView,
  type SmartThing,
} from "../../shared/smarthome";
import type { SecretStore } from "../secrets";
import { type HubConn, HubError, hubSwitch, hubThings, hubVersion } from "./hubs";

export const tokenSecret = (kind: HubKind) => `smarthome:${kind}`;

export interface SmartHomeDeps {
  settings: () => Settings;
  secrets: SecretStore;
  /** Saved devices' links to a hub's device, by device id. */
  links: () => Record<string, string>;
  fetch?: typeof fetch;
}

export class SmartHomeService {
  private things = new Map<HubKind, SmartThing[]>();
  private state = new Map<HubKind, { ok: boolean; error?: string; version?: string }>();

  constructor(private readonly deps: SmartHomeDeps) {}

  conn(kind: HubKind, override?: { url: string; token?: string }): HubConn | null {
    const url = override?.url ?? this.deps.settings().smarthome[kind]?.url;
    if (!url) return null;
    return {
      kind,
      url,
      token: override ? override.token : this.deps.secrets.get(tokenSecret(kind)),
      fetch: this.deps.fetch,
    };
  }

  /** Read every connected hub again. */
  async refresh(): Promise<void> {
    await Promise.all(
      HUBS.map(async (kind) => {
        const c = this.conn(kind);
        if (!c) {
          this.things.delete(kind);
          this.state.delete(kind);
          return;
        }
        try {
          this.things.set(kind, await hubThings(c));
          this.state.set(kind, { ...this.state.get(kind), ok: true, error: undefined });
        } catch (e) {
          this.state.set(kind, {
            ok: false,
            error: this.deps.secrets.redact(
              e instanceof HubError ? e.message : "It didn't answer.",
            ),
          });
        }
      }),
    );
  }

  /** Every device the hubs know, as last read. */
  all(): SmartThing[] {
    return HUBS.flatMap((k) => this.things.get(k) ?? []);
  }

  view(): SmartHomeView {
    const links = this.deps.links();
    const linkedTo = new Map(Object.entries(links).map(([device, key]) => [key, device]));
    return {
      hubs: HUBS.map((kind): HubState => {
        const url = this.deps.settings().smarthome[kind]?.url;
        const s = this.state.get(kind);
        return {
          kind,
          configured: Boolean(url),
          url,
          tokenSaved: this.deps.secrets.has(tokenSecret(kind)),
          ok: Boolean(s?.ok),
          version: s?.version,
          things: this.things.get(kind)?.length ?? 0,
          error: s?.error,
        };
      }),
      things: this.all().map((t) => ({
        key: t.key,
        hub: t.hub,
        name: t.name,
        status: t.status,
        device: linkedTo.get(t.key),
      })),
    };
  }

  /** Check a hub answers with this address and token (before it's saved). */
  async check(kind: HubKind, url: string, token?: string): Promise<string | undefined> {
    const c = this.conn(kind, { url, token });
    if (!c) return undefined;
    try {
      const version = await hubVersion(c);
      this.state.set(kind, { ok: true, version });
      return version;
    } catch (e) {
      throw new HubError(
        `${HUB_NAMES[kind]}: ${e instanceof HubError ? e.message : "it didn't answer."}`,
      );
    }
  }

  /** Switch something a hub controls, then read that hub again. */
  async switch(key: string, point: string, on: boolean): Promise<void> {
    const kind = key.split(":")[0] as HubKind;
    if (!HUBS.includes(kind)) throw new HubError("That isn't a smart-home device.");
    const thing = (this.things.get(kind) ?? []).find((t) => t.key === key);
    const p = thing?.points.find((x) => x.id === point);
    if (!thing || !p) throw new HubError("That isn't on the hub any more.");
    if (!p.canControl) throw new HubError("That can't be switched from here.");
    const c = this.conn(kind);
    if (!c) throw new HubError(`${HUB_NAMES[kind]} isn't connected.`);
    await hubSwitch(c, point, on);
    // The hub takes a moment to report the new state.
    await new Promise((r) => setTimeout(r, 400));
    await this.refresh().catch(() => {});
  }
}
