/**
 * Access: a sign-in Hearth keeps for an app at an address (PrusaLink on the printer, Sonarr on
 * the NAS), given once on the Devices page. Widgets for that app, and connection sources, use it
 * through Hearth: the key stays on the server, never in a widget or on the page.
 */
import { z } from "zod";
import type { IconSvg } from "./api";

/** How an app takes a sign-in. */
export const AUTH_KINDS = ["header", "basic", "bearer", "digest", "query"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

/** One way an app accepts a sign-in, as the access dialog offers it. */
export interface AuthWay {
  kind: AuthKind;
  label: string;
  hint?: string;
  /** "header": the header the key goes in (X-Api-Key). */
  header?: string;
  /** "query": the address parameter it goes in (apikey). */
  param?: string;
}

export const AccessSchema = z.object({
  /** "<app>-<host>", like prusalink-192-168-1-30. */
  id: z.string().regex(/^[a-z0-9-]{1,80}$/),
  app: z.string().max(40),
  /** Where the app is: http://192.168.1.30. */
  base: z.string().url().max(300),
  kind: z.enum(AUTH_KINDS),
  header: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,60}$/)
    .optional(),
  param: z
    .string()
    .regex(/^[A-Za-z0-9_.-]{1,60}$/)
    .optional(),
  at: z.string().max(40).optional(),
});
export type Access = z.infer<typeof AccessSchema>;

/** The secret holding an access's key, password or token. */
export const accessSecret = (id: string) => `access:${id}`;

/** An app on the network, and whether Hearth can read it. */
export interface AccessItem {
  /** "<app>|<origin>". */
  key: string;
  app: string;
  appName: string;
  /** "PrusaLink on prusa-mk4s.lan". */
  name: string;
  base: string;
  icon?: string;
  svg?: IconSvg;
  /**
   * connected: Hearth has a sign-in. needed: it needs one. open: it needs none. settings: it's
   * connected in Setup (AdGuard Home, the smart-home hubs), with what else they do.
   */
  status: "connected" | "needed" | "open" | "settings";
  /** For "settings": which card. */
  setup?: "adguard" | "homeassistant" | "openhab";
  ways: AuthWay[];
  /** The saved access, when there is one. */
  access?: Pick<Access, "id" | "kind" | "header" | "param" | "at">;
  /** How many widgets this home has for the app. */
  widgets: number;
  /** Added by hand on the Services tab (it can be removed there). */
  manual?: boolean;
}

/** A service with no link yet, offered when adding one. */
export interface LinkSuggestion {
  app: string;
  name: string;
  url: string;
  icon: string;
  color?: string;
  description?: string;
  svg?: IconSvg;
}

/** The id for an app's access at an address. */
export function accessId(app: string, base: string): string {
  let host = base;
  try {
    host = new URL(base).host;
  } catch {
    // Keep what was given.
  }
  return `${app}-${host}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
