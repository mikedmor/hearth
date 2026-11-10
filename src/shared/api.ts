/** What the API and the live socket send to the page. */
import type { AiServer, Audience, Layout, Role, SectionKind, WidgetType } from "./config";
import type { Look, Theme } from "./themes";
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
}

export interface AiWidgetData {
  servers: {
    id: string;
    name: string;
    state: AiServerState;
    models: number;
    loaded: string[];
    ms?: number;
  }[];
}

export interface WidgetDataMap {
  status: StatusWidgetData;
  note: NoteWidgetData;
  countdown: CountdownWidgetData;
  ai: AiWidgetData;
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
  | { type: "changed"; what: "config" | "session" | "calendar" }
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
