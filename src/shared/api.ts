/** What the API and the live socket send to the page. */

import type { AiServer, Audience, Layout, Role, SectionKind, WidgetType } from "./config";
import type { Look, Theme } from "./themes";
import type { WebSearch } from "./web-search";
import type { WidgetDocInput, WidgetFrame } from "./widget-doc";

/** A library icon, ready to draw: a logo's path and brand colour, or a symbol's strokes. */
export type IconSvg =
  | { kind: "brand"; path: string; hex: string }
  | { kind: "symbol"; nodes: [string, Record<string, string>][] };

/** One result from the icon library's search (`GET /api/icons`). */
export interface IconResult {
  /** What to store in a tile's icon field. */
  ref: string;
  label: string;
  kind: "brand" | "symbol" | "emoji";
  svg?: IconSvg;
}

/** `GET /api/sso`: whether "Sign in with …" is offered. Public. */
export interface SsoInfo {
  enabled: boolean;
  label: string;
}

/** `GET /api/admin/sso`. */
export interface SsoAdmin {
  issuer?: string;
  clientId?: string;
  label: string;
  adminGroup?: string;
  secretSaved: boolean;
  links: { profile: string; label?: string }[];
}

/** `GET /api/trust`: the home's root certificate, for the trust page. Public. */
export interface TrustInfo {
  /** A root is mounted. */
  available: boolean;
  /** Why the mounted file can't be offered (a private key in it, not a CA…). */
  error?: string;
  name?: string;
  /** SHA-256 of the root, "AB:CD:…". */
  fingerprint?: string;
  validTo?: string;
  /** Less than six months left. */
  expiresSoon?: boolean;
  /** Pages opened over plain http move to https on devices that trust the root. */
  redirect: boolean;
}

export interface PublicProfile {
  id: string;
  name: string;
  avatar?: string;
  color: string;
  role: Role;
  /** A PIN is needed to open this profile. */
  hasPin: boolean;
}

export interface ViewTile {
  id: string;
  name: string;
  url: string;
  description?: string;
  /** Emoji, or an `/icons/...` path. Missing means a monogram. */
  icon?: string;
  iconKind: "emoji" | "image" | "monogram" | "svg";
  /** A logo or symbol from the icon library, ready to draw. */
  svg?: IconSvg;
  color?: string;
  checked: boolean;
  keywords: string[];
  short: string | null;
  newTab: boolean;
  group: string;
  /** Who sees it; shown as a badge while editing. */
  access: Access;
  /** This person may change, move or delete it. */
  canManage: boolean;
}

/** Who sees a section or link, as the page needs it. */
export type Access =
  | { kind: "audience"; audience: Audience }
  | { kind: "people"; people: string[] }
  | { kind: "mine" };

export interface ViewGroup {
  id: string;
  name: string;
  tiles: ViewTile[];
  access: Access;
  /** This person may rename it, change who sees it, or delete it. */
  canManage: boolean;
  /** This person may add a link to it (their own, or the house's for the admin). */
  canAdd: boolean;
}

export interface ViewWidget {
  id: string;
  type: WidgetType;
  title?: string;
  /** Columns of 12. */
  w: number;
}

/** Who's asking, from their cookies. */
export interface Session {
  /** No admin password yet: the first visit sets one. */
  needsSetup: boolean;
  admin: boolean;
  /** The profile this device has open, if any. */
  profile: string | null;
}

/** `GET /api/home`: everything the page draws for the open profile (or a guest). */
export interface HomeView {
  title: string;
  homeName?: string;
  session: Session;
  profile: (PublicProfile & { locked: boolean }) | null;
  profiles: PublicProfile[];
  /** May change this page's layout and look. */
  canEdit: boolean;
  /** May add their own sections and links (a profile that isn't locked, or the admin). */
  canAddOwn: boolean;
  canChat: boolean;
  /** May open Files (by role, in Settings → People). */
  canFiles: boolean;
  /** May open the calendar (by role; it needs a profile). */
  canCalendar: boolean;
  /** The admin's: a newer release of Hearth (from the update check). */
  update?: string;
  /** Where the search box searches the web (off: undefined). The browser goes there itself. */
  webSearch?: WebSearch;
  /** May open the Family page (the admin, or a parent they chose, with a PIN). */
  family?: boolean;
  /** Children's requests waiting on the Family page (for parents). */
  familyPending?: number;
  /** Whose device this is, if it's saved as someone's (their page can open by itself). */
  deviceOwner?: string;
  /** Hearth knows whether this browser trusts the home's certificate (if not, the page says). */
  trustKnown?: boolean;
  /** The page Hearth serves now (its script's name): an open tab that differs is out of date. */
  build?: string;
  look: Look;
  /** Custom themes made in this home (built-in ones ship with the page). */
  themes: Theme[];
  sections: { kind: SectionKind; hidden: boolean }[];
  favorites: ViewTile[];
  /** Tiles this person hid from their page. */
  hiddenTiles: string[];
  /** Groups this person hid, and the group order they chose. */
  hiddenGroups: string[];
  groupOrder: string[];
  groups: ViewGroup[];
  widgets: ViewWidget[];
  /** Sections and widgets in one order, when widgets are mixed in ("g:<id>", "w:<id>"). */
  board: string[];
  /** Board keys linked to the one before them (they move and show as one). */
  joined: string[];
  /** Widgets that could be added to this page. */
  library: { id: string; type: WidgetType; title?: string }[];
}

export type TileState = "up" | "slow" | "down" | "unknown";

export interface TileStatus {
  state: TileState;
  ms?: number;
  checkedAt?: string;
}

export type StatusMap = Record<string, TileStatus>;

// ---------------------------------------------------------------------------
// Widget data

export interface StatusWidgetData {
  total: number;
  up: number;
  slow: number;
  down: number;
  unknown: number;
  downNames: string[];
}

export interface NoteWidgetData {
  text: string;
  tone: "info" | "warning" | "celebrate";
}

export interface CountdownWidgetData {
  events: { name: string; date: string; emoji?: string; days: number }[];
  /** How many to show in all: the viewer's own calendar fills the rest. */
  show?: number;
  /** Add what's next on the viewer's calendar. */
  calendar?: boolean;
}

export interface AiWidgetData {
  servers: {
    id: string;
    name: string;
    state: AiServerState;
    models: number;
    loaded: string[];
    ms?: number;
    /** The computers a shared server lends work to, when it lists them. */
    machines?: {
      name: string;
      online: boolean;
      busy: boolean;
      available: boolean;
      reason?: string;
      loaded?: string;
      jobs?: number;
      /** Answers given since it connected, and how long they took on average. */
      served?: number;
      avgMs?: number;
      os?: string;
      /** Its graphics cards ("RTX 4090") and their memory together. */
      gpu?: string;
      vramMib?: number;
      memoryMib?: number;
    }[];
  }[];
}

/** A pinball table running VPin Studio: what's on, and the latest high scores. */
export interface PinballWidgetData {
  /** No table found yet (none has VPin Studio, or the one chosen is gone). */
  missing?: boolean;
  name?: string;
  /** Its row on the Devices page, for the admin's controls. */
  device?: string;
  muted?: boolean;
  /** VPin Studio answered just now. */
  on: boolean;
  playing?: { id: number; name: string; since?: string };
  /** The table played last (when none is being played). */
  last?: { id: number; name: string };
  frontendRunning?: boolean;
  tables?: number;
  /** Tables played lately, newest first: one tap to start again. */
  recent: { id: number; name: string }[];
  scores: {
    initials: string;
    score: string;
    table: string;
    gameId?: number;
    position?: number;
    label?: string;
    at?: string;
  }[];
  players: {
    name: string;
    initials?: string;
    rank: number;
    points: number;
    first: number;
    second: number;
    third: number;
  }[];
}

export interface WidgetDataMap {
  status: StatusWidgetData;
  note: NoteWidgetData;
  countdown: CountdownWidgetData;
  ai: AiWidgetData;
  pinball: PinballWidgetData;
  ask: Record<string, never>;
  agenda: { days: number };
  clock: ClockWidgetData;
  custom: WidgetFrame;
}

export interface ClockWidgetData {
  zones: { label: string; timeZone: string }[];
  seconds: boolean;
}

/** One widget's data, told apart by its type. */
export type WidgetUpdate = {
  [T in WidgetType]: { id: string; type: T; data: WidgetDataMap[T] };
}[WidgetType];

// ---------------------------------------------------------------------------
// The live socket (`/api/live`)

/** Sent by the page. */
export type LiveClientMessage = { type: "watch"; widgets: string[] } | { type: "ping" };

/** Sent by the server. */
export type LiveServerMessage =
  | { type: "status"; data: StatusMap }
  | { type: "widget"; update: WidgetUpdate }
  | { type: "changed"; what: "config" | "session" | "calendar" | "internet" | "devices" }
  | { type: "pong" };

// ---------------------------------------------------------------------------
// AI

export type AiServerState = "up" | "busy" | "down" | "unknown";

export interface AiModel {
  name: string;
  /** Bytes on disk, when the server says. */
  size?: number;
  family?: string;
  parameters?: string;
  quantization?: string;
}

export interface AiLoadedModel {
  name: string;
  /** Bytes of GPU memory in use, when the server says (Ollama). */
  vram?: number;
  size?: number;
  /** When it will be unloaded (ISO time). */
  until?: string;
}

/** A computer a shared AI server lends work to, as the server lists it for apps. */
export interface AiMachine {
  id: string;
  name: string;
  online: boolean;
  /** Free to answer (its owner's rules can say no: a game is running). */
  available: boolean;
  reason?: string;
  busy: boolean;
  jobs: number;
  /** Answers it has given since it connected. */
  served: number;
  avgMs?: number;
  connectedSecs?: number;
  version?: string;
  os?: string;
  models: string[];
  loaded?: string;
  fetching?: { model: string; percent: number };
  /** Where it connects from, while it's online. */
  address?: string;
  mac?: string;
  canWake: boolean;
  hardware?: {
    cpu: string;
    cores: number;
    memoryMib: number;
    gpus: { name: string; vramMib: number }[];
  };
}

/** `GET /api/ai/servers`: each server as last checked. */
export interface AiServerStatus {
  id: string;
  name: string;
  kind: AiServer["kind"];
  /** Only for the admin. */
  url?: string;
  defaultModel?: string;
  state: AiServerState;
  ms?: number;
  version?: string;
  models: AiModel[];
  loaded: AiLoadedModel[];
  /** Why it's down or busy, in plain words. */
  note?: string;
  checkedAt?: string;
  hasKey: boolean;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  server: string;
  model?: string;
  messages: ChatMessage[];
}

/** Server-sent events from `POST /api/ai/chat`. */
export type ChatEvent =
  | { type: "start"; server: string; model: string }
  | { type: "text"; text: string }
  | { type: "wait"; reason: string; seconds: number }
  | { type: "done"; ms: number; tokens?: number }
  | { type: "error"; message: string };

/** `POST /api/ai/design`: the AI designer's turns. */
export interface DesignRequest {
  server: string;
  model?: string;
  messages: ChatMessage[];
  /** The widget in the editor now. */
  draft?: WidgetDocInput;
}

export type DesignEvent =
  | { type: "start"; server: string; model: string }
  | { type: "status"; text: string }
  | { type: "fetched"; url: string; ok: boolean; note: string }
  | { type: "say"; text: string }
  | { type: "draft"; doc: WidgetDocInput; issues: { path: string; message: string }[] }
  | { type: "wait"; reason: string; seconds: number }
  | { type: "done" }
  | { type: "error"; message: string };

/** `POST /api/widgets/preview`: run a document once and show what it comes to. */
export interface PreviewResult {
  issues: { path: string; message: string }[];
  frame: WidgetFrame | null;
  /** What each source returned (trimmed), so you can see what to bind to. */
  samples: Record<string, { ok: boolean; error?: string; sample?: unknown }>;
}

export type { Layout };
