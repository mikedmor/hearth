/**
 * The home's smart-home hubs (openHAB, Home Assistant): what Hearth reads from them for the
 * Devices page, and what it can switch.
 */
export const HUBS = ["openhab", "homeassistant"] as const;
export type HubKind = (typeof HUBS)[number];

export const HUB_NAMES: Record<HubKind, string> = {
  openhab: "openHAB",
  homeassistant: "Home Assistant",
};

/** One reading or control of a smart-home device: a switch, a temperature, a leak sensor. */
export interface SmartPoint {
  /** The hub's own id: an openHAB item, a Home Assistant entity. */
  id: string;
  label: string;
  kind: "switch" | "dimmer" | "contact" | "number" | "text";
  /** As people read it: "21.5 °C", "Dry", "On". */
  state: string;
  /** For a switch: whether it's on. */
  on?: boolean;
  /** Hearth can switch it. */
  canControl: boolean;
}

/** A device as a hub knows it. */
export interface SmartThing {
  hub: HubKind;
  /** "<hub>:<the hub's id>", unique across hubs. */
  key: string;
  name: string;
  /** The hub says it's reachable ("ONLINE"), or not. */
  status?: string;
  /** Addresses and hardware ids from its settings, to find it on the network. */
  hosts: string[];
  macs: string[];
  maker?: string;
  model?: string;
  points: SmartPoint[];
}

/** One hub's connection, for the Setup card. */
export interface HubState {
  kind: HubKind;
  configured: boolean;
  url?: string;
  tokenSaved: boolean;
  ok: boolean;
  version?: string;
  things: number;
  error?: string;
}

/** `GET /api/admin/smarthome`. */
export interface SmartHomeView {
  hubs: HubState[];
  /** Every device the hubs know, and the saved device each is linked to (if any). */
  things: (Pick<SmartThing, "key" | "hub" | "name" | "status"> & { device?: string })[];
}
