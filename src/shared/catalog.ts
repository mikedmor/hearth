/**
 * The app catalog: common self-hosted apps, as data. For each: its name, icon, category,
 * the ports it usually listens on, how to recognise it, and ready-made widgets.
 *
 * Hearth uses it to recognise a tile's address (even on an unusual port), to scan the network and
 * suggest tiles, and to offer widgets for the apps a home actually runs. Nothing here is shown
 * unless it's found or chosen. To add an app, add an entry; the admin can also drop more entries in
 * `data/catalog/*.json` (same shape).
 *
 * Widget documents use placeholders, filled in when a widget is added:
 *   {{base}}             the app's address, like http://192.168.1.20:8989
 *   {{secret:key}}       the app's API key (stored as a Hearth secret, never in the widget)
 *   {{param:name}}       a setting asked for when adding it (a status page's name, an entity)
 */
import type { AuthWay } from "./access";
import type { WidgetDocInput } from "./widget-doc";

export const CATEGORIES = [
  "Media",
  "Downloads",
  "Photos",
  "Home",
  "Network",
  "Monitoring",
  "Storage",
  "Productivity",
  "Finance",
  "Development",
  "Security",
  "AI",
  "Printing",
  "Dashboards",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface AppSecret {
  label: string;
  hint: string;
  /**
   * "basic": ask for a user name and password, stored as an Authorization header value.
   * "digest": the same, stored as "user:password" for a source's `digest`.
   */
  kind?: "key" | "basic" | "bearer" | "digest";
}

export interface AppParam {
  key: string;
  label: string;
  hint?: string;
  default?: string;
}

export interface AppWidget {
  id: string;
  name: string;
  description: string;
  secret?: AppSecret;
  params?: AppParam[];
  /** Shows something private (money, cameras): only for adults or the admin by default. */
  private?: boolean;
  doc: WidgetDocInput;
}

export interface AppDef {
  id: string;
  name: string;
  /** An icon reference: "si:<slug>" (logo), "lucide:<name>" (symbol), or an emoji. */
  icon: string;
  color?: string;
  category: Category;
  description: string;
  /** Ports it usually listens on, for the network scan. */
  ports: number[];
  /** Usually served over https on those ports. */
  https?: boolean;
  /** How to recognise it: the page title, or text in the page, or a probe path's answer. */
  match: {
    title?: string;
    body?: string;
    header?: string;
    /** A path to ask: its answer holds `body` (and is a success), or a header matches `header`. */
    probe?: { path: string; body?: string; header?: string };
  };
  widgets?: AppWidget[];
  /** Ways it takes a sign-in, beyond what its widgets use (worked out by `authWays`). */
  auth?: AuthWay[];
}

/**
 * The ways an app takes a sign-in: the ones it says, then what its widgets do with their key (a
 * header, a bearer token, a user and password, a digest, a parameter in the address).
 */
export function authWays(app: AppDef): AuthWay[] {
  const out: AuthWay[] = [...(app.auth ?? [])];
  const add = (w: AuthWay) => {
    if (!out.some((x) => x.kind === w.kind && x.header === w.header && x.param === w.param))
      out.push(w);
  };
  for (const wd of app.widgets ?? []) {
    if (!wd.secret) continue;
    const label = wd.secret.label;
    const hint = wd.secret.hint;
    for (const s of wd.doc.sources ?? []) {
      if (s.kind !== "http") continue;
      if (s.digest?.includes("{{secret:key}}")) add({ kind: "digest", label, hint });
      for (const [h, v] of Object.entries(s.headers ?? {})) {
        if (!v.includes("{{secret:key}}")) continue;
        if (/^authorization$/i.test(h)) {
          // The widget says what its key is: a token ("Bearer …"), a user and password, or the
          // whole header value.
          const k = wd.secret.kind;
          if (/bearer/i.test(v) || k === "bearer") add({ kind: "bearer", label, hint });
          else if (k === "basic") add({ kind: "basic", label, hint });
          else add({ kind: "header", header: h, label, hint });
        } else add({ kind: "header", header: h, label, hint });
      }
      const q = /[?&]([A-Za-z0-9_.-]+)=\{\{secret:key\}\}/.exec(s.url);
      if (q?.[1]) add({ kind: "query", param: q[1], label, hint });
    }
  }
  return out;
}

/**
 * An app's widget reading through the access Hearth keeps for it: each source on the app's own
 * address becomes a connection source, so the widget holds no key at all.
 */
export function throughAccess(doc: WidgetDocInput, accessId: string): WidgetDocInput {
  return {
    ...doc,
    sources: (doc.sources ?? []).map((s) => {
      if (s.kind !== "http" || !s.url.startsWith("{{base}}")) return s;
      return {
        id: s.id,
        kind: "connection" as const,
        to: `app:${accessId}`,
        get:
          s.url.slice("{{base}}".length).replace(/[?&][A-Za-z0-9_.-]+=\{\{secret:key\}\}/, "") ||
          "/",
        every: s.every,
        path: s.path,
        track: s.track,
        keep: s.keep,
      };
    }),
  };
}

const arrKey: AppSecret = { label: "API key", hint: "Settings → General → Security → API Key." };

/** Queue, health and what's coming, for the *arr apps (same API). */
function arrWidgets(
  name: string,
  api: "v3" | "v1",
  upcomingTitle: string,
  upcomingDetail: string,
): AppWidget[] {
  return [
    {
      id: "overview",
      name: `${name}: queue and coming up`,
      description: `What's downloading, any health warnings, and what's coming up.`,
      secret: arrKey,
      doc: {
        v: 1,
        sources: [
          {
            id: "queue",
            kind: "http",
            url: `{{base}}/api/${api}/queue?pageSize=20`,
            headers: { "X-Api-Key": "{{secret:key}}" },
            every: 30,
          },
          {
            id: "health",
            kind: "http",
            url: `{{base}}/api/${api}/health`,
            headers: { "X-Api-Key": "{{secret:key}}" },
            every: 300,
          },
          ...(upcomingTitle
            ? [
                {
                  id: "soon",
                  kind: "http" as const,
                  url: `{{base}}/api/${api}/calendar?includeSeries=true&includeMovie=true`,
                  headers: { "X-Api-Key": "{{secret:key}}" },
                  every: 900,
                },
              ]
            : []),
        ],
        blocks: [
          {
            id: "queue",
            kind: "stat",
            w: 6,
            label: "In the queue",
            value: "$queue.totalRecords ?? count($queue)",
            size: "md",
          },
          {
            id: "health",
            kind: "stat",
            w: 6,
            label: "Health",
            value: 'count($health) == 0 ? "All good" : count($health) + " to look at"',
            tone: 'count(filter($health, "type", "==", "error")) > 0 ? "negative" : count($health) > 0 ? "warning" : "positive"',
            size: "md",
          },
          ...(upcomingTitle
            ? [
                {
                  id: "soon",
                  kind: "list" as const,
                  w: 12,
                  title: "Coming up",
                  items: "$soon",
                  itemTitle: upcomingTitle,
                  itemDetail: upcomingDetail,
                  limit: 5,
                  empty: "Nothing in the next few days.",
                },
              ]
            : []),
        ],
      },
    },
  ];
}

export const APPS: AppDef[] = [
  // Media
  {
    id: "plex",
    name: "Plex",
    icon: "si:plex",
    category: "Media",
    description: "Movies, shows and music",
    ports: [32400],
    match: { probe: { path: "/identity", body: "machineIdentifier" }, title: "^Plex" },
    widgets: [
      {
        id: "now-playing",
        name: "Plex: now playing",
        description: "Who's watching what.",
        secret: {
          label: "Plex token",
          hint: "Your X-Plex-Token (Plex support: “Finding an authentication token”).",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "plex",
              kind: "http",
              url: "{{base}}/status/sessions",
              headers: { "X-Plex-Token": "{{secret:key}}", Accept: "application/json" },
              every: 15,
              path: "MediaContainer",
            },
          ],
          blocks: [
            {
              id: "count",
              kind: "stat",
              w: 12,
              label: "Streaming now",
              value: "$plex.size ?? 0",
              size: "md",
            },
            {
              id: "list",
              kind: "list",
              w: 12,
              items: "$plex.Metadata",
              itemTitle: "$item.grandparentTitle ?? $item.title",
              itemDetail: '$item.User.title + " · " + $item.Player.title',
              itemValue: "$item.Player.state",
              empty: "Nobody's watching.",
            },
          ],
        },
      },
    ],
  },
  {
    id: "jellyfin",
    name: "Jellyfin",
    icon: "si:jellyfin",
    category: "Media",
    description: "Movies, shows and music",
    ports: [8096, 8920],
    match: { probe: { path: "/System/Info/Public", body: "Jellyfin" }, title: "^Jellyfin" },
    widgets: [
      {
        id: "overview",
        name: "Jellyfin: now playing and library",
        description: "Who's watching, and how big the library is.",
        secret: { label: "API key", hint: "Dashboard → API Keys → +." },
        doc: {
          v: 1,
          sources: [
            {
              id: "sessions",
              kind: "http",
              url: "{{base}}/Sessions?activeWithinSeconds=600",
              headers: { "X-Emby-Token": "{{secret:key}}" },
              every: 15,
            },
            {
              id: "counts",
              kind: "http",
              url: "{{base}}/Items/Counts",
              headers: { "X-Emby-Token": "{{secret:key}}" },
              every: 3600,
            },
          ],
          values: [{ id: "playing", expr: 'filter($sessions, "NowPlayingItem", "!=", null)' }],
          blocks: [
            {
              id: "now",
              kind: "list",
              w: 12,
              title: "Now playing",
              items: "$playing",
              itemTitle: "$item.NowPlayingItem.SeriesName ?? $item.NowPlayingItem.Name",
              itemDetail: '$item.UserName + " · " + $item.DeviceName',
              empty: "Nobody's watching.",
            },
            {
              id: "lib",
              kind: "pairs",
              w: 12,
              items: [
                { label: "Movies", value: "{{ fmt($counts.MovieCount, 0) }}" },
                { label: "Shows", value: "{{ fmt($counts.SeriesCount, 0) }}" },
                { label: "Episodes", value: "{{ fmt($counts.EpisodeCount, 0) }}" },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "emby",
    name: "Emby",
    icon: "si:emby",
    category: "Media",
    description: "Movies, shows and music",
    ports: [8096],
    match: { title: "^Emby" },
  },
  {
    id: "tautulli",
    name: "Tautulli",
    icon: "lucide:chart-no-axes-column",
    color: "#e5a00d",
    category: "Media",
    description: "Plex statistics",
    ports: [8181],
    match: { title: "Tautulli" },
    widgets: [
      {
        id: "activity",
        name: "Tautulli: activity",
        description: "Streams on Plex right now.",
        secret: { label: "API key", hint: "Settings → Web Interface → API." },
        doc: {
          v: 1,
          sources: [
            {
              id: "t",
              kind: "http",
              url: "{{base}}/api/v2?apikey={{secret:key}}&cmd=get_activity",
              path: "response.data",
              every: 15,
            },
          ],
          blocks: [
            {
              id: "n",
              kind: "stat",
              w: 12,
              label: "Streams",
              value: "$t.stream_count ?? 0",
              size: "md",
            },
            {
              id: "list",
              kind: "list",
              w: 12,
              items: "$t.sessions",
              itemTitle: "$item.full_title",
              itemDetail: '$item.friendly_name + " · " + $item.player',
              itemValue: '$item.progress_percent + "%"',
              empty: "Nothing playing.",
            },
          ],
        },
      },
    ],
  },
  {
    id: "overseerr",
    name: "Overseerr",
    icon: "lucide:inbox",
    color: "#6366f1",
    category: "Media",
    description: "Requests for movies and shows",
    ports: [5055],
    match: { title: "Overseerr" },
    widgets: [
      {
        id: "requests",
        name: "Overseerr: requests",
        description: "How many requests are waiting.",
        secret: { label: "API key", hint: "Settings → General → API Key." },
        doc: {
          v: 1,
          sources: [
            {
              id: "r",
              kind: "http",
              url: "{{base}}/api/v1/request/count",
              headers: { "X-Api-Key": "{{secret:key}}" },
              every: 120,
            },
          ],
          blocks: [
            {
              id: "pending",
              kind: "stat",
              w: 6,
              label: "Waiting for approval",
              value: "$r.pending",
              tone: '$r.pending > 0 ? "warning" : "normal"',
              size: "md",
            },
            {
              id: "total",
              kind: "pairs",
              w: 6,
              items: [
                { label: "Processing", value: "{{ $r.processing }}" },
                { label: "Available", value: "{{ $r.available }}" },
                { label: "All", value: "{{ $r.total }}" },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "jellyseerr",
    name: "Jellyseerr",
    icon: "lucide:inbox",
    color: "#8b5cf6",
    category: "Media",
    description: "Requests for movies and shows",
    ports: [5055],
    match: { title: "Jellyseerr" },
  },
  {
    id: "audiobookshelf",
    name: "Audiobookshelf",
    icon: "si:audiobookshelf",
    category: "Media",
    description: "Audiobooks and podcasts",
    ports: [13378],
    match: { title: "audiobookshelf" },
  },
  {
    id: "navidrome",
    name: "Navidrome",
    icon: "lucide:list-music",
    category: "Media",
    description: "Music streaming",
    ports: [4533],
    match: { title: "Navidrome" },
  },
  {
    id: "kavita",
    name: "Kavita",
    icon: "lucide:book-open",
    category: "Media",
    description: "Books and comics",
    ports: [5000],
    match: { title: "Kavita" },
  },
  {
    id: "komga",
    name: "Komga",
    icon: "lucide:book-open",
    category: "Media",
    description: "Comics and manga",
    ports: [25600],
    match: { title: "Komga" },
  },
  {
    id: "calibre-web",
    name: "Calibre-Web",
    icon: "si:calibreweb",
    category: "Media",
    description: "E-books",
    ports: [8083],
    match: { title: "Calibre-Web" },
  },
  {
    id: "tdarr",
    name: "Tdarr",
    icon: "lucide:clapperboard",
    category: "Media",
    description: "Media transcoding",
    ports: [8265],
    match: { title: "Tdarr" },
  },

  // Downloads
  {
    id: "sonarr",
    name: "Sonarr",
    icon: "si:sonarr",
    category: "Downloads",
    description: "TV shows",
    ports: [8989],
    match: { title: "^Sonarr" },
    widgets: arrWidgets(
      "Sonarr",
      "v3",
      "$item.series.title",
      '"S" + $item.seasonNumber + "E" + $item.episodeNumber + " · " + date($item.airDateUtc)',
    ),
  },
  {
    id: "radarr",
    name: "Radarr",
    icon: "si:radarr",
    category: "Downloads",
    description: "Movies",
    ports: [7878],
    match: { title: "^Radarr" },
    widgets: arrWidgets(
      "Radarr",
      "v3",
      "$item.title",
      "date($item.digitalRelease ?? $item.physicalRelease ?? $item.inCinemas)",
    ),
  },
  {
    id: "lidarr",
    name: "Lidarr",
    icon: "lucide:disc-3",
    color: "#00a65b",
    category: "Downloads",
    description: "Music",
    ports: [8686],
    match: { title: "^Lidarr" },
    widgets: arrWidgets(
      "Lidarr",
      "v1",
      "$item.artist.artistName ?? $item.title",
      "date($item.releaseDate)",
    ),
  },
  {
    id: "readarr",
    name: "Readarr",
    icon: "lucide:book-bookmark",
    color: "#8e2222",
    category: "Downloads",
    description: "Books",
    ports: [8787],
    match: { title: "^Readarr" },
    widgets: arrWidgets("Readarr", "v1", "", ""),
  },
  {
    id: "prowlarr",
    name: "Prowlarr",
    icon: "lucide:radar",
    color: "#e66001",
    category: "Downloads",
    description: "Indexers",
    ports: [9696],
    match: { title: "^Prowlarr" },
    widgets: arrWidgets("Prowlarr", "v1", "", ""),
  },
  {
    id: "bazarr",
    name: "Bazarr",
    icon: "lucide:captions",
    color: "#e6a817",
    category: "Downloads",
    description: "Subtitles",
    ports: [6767],
    match: { title: "Bazarr" },
  },
  {
    id: "sabnzbd",
    name: "SABnzbd",
    icon: "lucide:download",
    color: "#f5c518",
    category: "Downloads",
    description: "Usenet downloads",
    ports: [8080, 8085, 9090],
    match: { title: "SABnzbd" },
    widgets: [
      {
        id: "queue",
        name: "SABnzbd: queue",
        description: "Speed, time left, and what's downloading.",
        secret: { label: "API key", hint: "Config → General → Security → API Key." },
        doc: {
          v: 1,
          sources: [
            {
              id: "q",
              kind: "http",
              url: "{{base}}/api?mode=queue&output=json&apikey={{secret:key}}",
              path: "queue",
              every: 10,
              track: "number($q.kbpersec)",
              keep: 60,
            },
          ],
          blocks: [
            {
              id: "speed",
              kind: "stat",
              w: 6,
              label: "Speed",
              value: "bytes(number($q.kbpersec) * 1024)",
              sub: "{{ $q.status }}",
              spark: "$history.q",
              size: "md",
            },
            {
              id: "left",
              kind: "stat",
              w: 6,
              label: "Left",
              value: "$q.sizeleft",
              sub: "{{ $q.timeleft }}",
              size: "md",
            },
            {
              id: "list",
              kind: "list",
              w: 12,
              items: "$q.slots",
              itemTitle: "$item.filename",
              itemValue: '$item.percentage + "%"',
              limit: 5,
              empty: "Nothing downloading.",
            },
          ],
        },
      },
    ],
  },
  {
    id: "nzbget",
    name: "NZBGet",
    icon: "lucide:download",
    category: "Downloads",
    description: "Usenet downloads",
    ports: [6789],
    match: { title: "NZBGet" },
  },
  {
    id: "qbittorrent",
    name: "qBittorrent",
    icon: "si:qbittorrent",
    category: "Downloads",
    description: "Torrents",
    ports: [8080, 8090],
    match: { title: "qBittorrent" },
  },
  {
    id: "transmission",
    name: "Transmission",
    icon: "si:transmission",
    category: "Downloads",
    description: "Torrents",
    ports: [9091],
    match: { title: "Transmission" },
  },
  {
    id: "deluge",
    name: "Deluge",
    icon: "si:deluge",
    category: "Downloads",
    description: "Torrents",
    ports: [8112],
    match: { title: "Deluge" },
  },
  {
    id: "metube",
    name: "MeTube",
    icon: "lucide:circle-play",
    category: "Downloads",
    description: "Video downloads",
    ports: [8081],
    match: { title: "MeTube" },
  },

  // Photos
  {
    id: "immich",
    name: "Immich",
    icon: "si:immich",
    category: "Photos",
    description: "Photos and videos",
    ports: [2283],
    match: { title: "^Immich" },
    widgets: [
      {
        id: "stats",
        name: "Immich: library",
        description: "Photos, videos and space used.",
        secret: {
          label: "API key (admin)",
          hint: "Account settings → API Keys. Statistics need an admin's key.",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "s",
              kind: "http",
              url: "{{base}}/api/server/statistics",
              headers: { "x-api-key": "{{secret:key}}" },
              every: 3600,
            },
          ],
          blocks: [
            {
              id: "p",
              kind: "pairs",
              w: 12,
              items: [
                { label: "Photos", value: "{{ fmt($s.photos, 0) }}" },
                { label: "Videos", value: "{{ fmt($s.videos, 0) }}" },
                { label: "Space", value: "{{ bytes($s.usage) }}" },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "photoprism",
    name: "PhotoPrism",
    icon: "lucide:images",
    category: "Photos",
    description: "Photos",
    ports: [2342],
    match: { title: "PhotoPrism" },
  },
  {
    id: "synology-photos",
    name: "Synology Photos",
    icon: "si:synology",
    category: "Photos",
    description: "Photos on the NAS",
    ports: [],
    match: { title: "Synology Photos" },
  },

  // Home
  {
    id: "home-assistant",
    name: "Home Assistant",
    icon: "si:homeassistant",
    category: "Home",
    description: "Smart home",
    ports: [8123],
    match: { title: "Home Assistant" },
    widgets: [
      {
        id: "lights",
        name: "Home Assistant: lights",
        description: "Which lights are on.",
        secret: {
          label: "Long-lived access token",
          hint: "Your profile → Security → Long-lived access tokens.",
          kind: "bearer",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "ha",
              kind: "http",
              url: "{{base}}/api/states",
              headers: { Authorization: "{{secret:key}}" },
              every: 15,
            },
          ],
          values: [{ id: "lights", expr: 'filter($ha, "entity_id", "contains", "light.")' }],
          blocks: [
            {
              id: "on",
              kind: "stat",
              w: 12,
              label: "Lights on",
              value: 'count(filter($lights, "state", "==", "on"))',
              sub: "of {{ count($lights) }}",
              size: "md",
            },
            {
              id: "list",
              kind: "lights",
              w: 12,
              items: "$lights",
              itemLabel: "$item.attributes.friendly_name ?? $item.entity_id",
              itemState: '$item.state == "on" ? "up" : "off"',
              limit: 30,
            },
          ],
        },
      },
      {
        id: "sensor",
        name: "Home Assistant: a sensor",
        description: "One sensor's value, with a history line.",
        secret: {
          label: "Long-lived access token",
          hint: "Your profile → Security → Long-lived access tokens.",
          kind: "bearer",
        },
        params: [
          {
            key: "entity",
            label: "Entity id",
            hint: "Like sensor.living_room_temperature",
            default: "sensor.",
          },
        ],
        doc: {
          v: 1,
          sources: [
            {
              id: "s",
              kind: "http",
              url: "{{base}}/api/states/{{param:entity}}",
              headers: { Authorization: "{{secret:key}}" },
              every: 30,
              track: "number($s.state)",
              keep: 120,
            },
          ],
          blocks: [
            {
              id: "v",
              kind: "stat",
              w: 12,
              label: "{{ $s.attributes.friendly_name }}",
              value: "$s.state",
              unit: "{{param:unit}}",
              spark: "$history.s",
              sub: "Updated {{ ago($s.last_changed) }}",
            },
          ],
        },
      },
    ],
  },
  {
    id: "openhab",
    name: "openHAB",
    icon: "si:openhab",
    category: "Home",
    description: "Smart home",
    ports: [8080, 8443],
    match: { title: "openHAB" },
    widgets: [
      {
        id: "things",
        name: "openHAB: things",
        description: "How many of openHAB's things are online, and which aren't.",
        secret: {
          label: "API token",
          hint: "In openHAB: your profile (bottom left) → API tokens → Create new API token.",
          kind: "bearer",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "things",
              kind: "http",
              url: "{{base}}/rest/things?summary=true",
              every: 120,
              headers: { Authorization: "{{secret:key}}" },
            },
          ],
          values: [
            { id: "online", expr: 'count(filter($things, "statusInfo.status", "==", "ONLINE"))' },
            { id: "off", expr: 'filter($things, "statusInfo.status", "!=", "ONLINE")' },
          ],
          blocks: [
            {
              id: "count",
              kind: "stat",
              w: 12,
              label: "Things online",
              value: "$online",
              sub: "of {{ count($things) }}",
              tone: 'count($off) > 0 ? "warning" : "positive"',
              size: "md",
            },
            {
              id: "offline",
              kind: "list",
              w: 12,
              title: "Not online",
              items: "take($off, 5)",
              itemTitle: "$item.label",
              itemDetail: "lower($item.statusInfo.status)",
              empty: "Everything is online.",
            },
          ],
        },
      },
    ],
  },
  {
    id: "homebridge",
    name: "Homebridge",
    icon: "si:homebridge",
    category: "Home",
    description: "HomeKit bridge",
    ports: [8581],
    match: { title: "Homebridge" },
  },
  {
    id: "node-red",
    name: "Node-RED",
    icon: "si:nodered",
    category: "Home",
    description: "Automations",
    ports: [1880],
    match: { title: "Node-RED" },
  },
  {
    id: "zigbee2mqtt",
    name: "Zigbee2MQTT",
    icon: "si:zigbee2mqtt",
    category: "Home",
    description: "Zigbee devices",
    ports: [8080],
    match: { title: "Zigbee2MQTT" },
  },
  {
    id: "esphome",
    name: "ESPHome",
    icon: "si:esphome",
    category: "Home",
    description: "Smart devices",
    ports: [6052],
    match: { title: "ESPHome" },
  },
  {
    id: "frigate",
    name: "Frigate",
    icon: "lucide:cctv",
    color: "#3b82f6",
    category: "Home",
    description: "Cameras and detection",
    ports: [5000, 8971],
    match: { title: "Frigate" },
    widgets: [
      {
        id: "cameras",
        name: "Frigate: cameras",
        description: "Each camera, and whether it's sending frames.",
        private: true,
        doc: {
          v: 1,
          sources: [{ id: "f", kind: "http", url: "{{base}}/api/stats", every: 30 }],
          blocks: [
            {
              id: "cams",
              kind: "lights",
              w: 12,
              items: "entries($f.cameras)",
              itemLabel: "$item.key",
              itemState: '$item.value.camera_fps > 0 ? "up" : "down"',
              itemDetail: 'round($item.value.camera_fps, 1) + " fps"',
            },
          ],
        },
      },
    ],
  },
  {
    id: "mealie",
    name: "Mealie",
    icon: "lucide:chef-hat",
    category: "Home",
    description: "Recipes",
    ports: [9000, 9925],
    match: { title: "Mealie" },
  },
  {
    id: "grocy",
    name: "Grocy",
    icon: "lucide:shopping-basket",
    category: "Home",
    description: "Groceries and household",
    ports: [9283],
    match: { title: "Grocy" },
  },

  // Network
  {
    id: "adguard-home",
    name: "AdGuard Home",
    icon: "si:adguard",
    category: "Network",
    description: "Ad blocking DNS",
    ports: [3000, 80],
    match: { title: "AdGuard Home" },
    widgets: [
      {
        id: "stats",
        name: "AdGuard Home: blocking",
        description: "Queries, how many were blocked, and whether protection is on.",
        secret: { label: "User name and password", hint: "The AdGuard Home login.", kind: "basic" },
        doc: {
          v: 1,
          sources: [
            {
              id: "st",
              kind: "http",
              url: "{{base}}/control/stats",
              headers: { Authorization: "{{secret:key}}" },
              every: 60,
            },
            {
              id: "on",
              kind: "http",
              url: "{{base}}/control/status",
              headers: { Authorization: "{{secret:key}}" },
              every: 60,
            },
          ],
          blocks: [
            {
              id: "q",
              kind: "stat",
              w: 6,
              label: "Queries",
              value: "fmt($st.num_dns_queries, 0)",
              size: "md",
            },
            {
              id: "b",
              kind: "stat",
              w: 6,
              label: "Blocked",
              value: 'round(pct($st.num_blocked_filtering, $st.num_dns_queries), 1) + "%"',
              sub: "{{ fmt($st.num_blocked_filtering, 0) }} queries",
              size: "md",
            },
            {
              id: "p",
              kind: "lights",
              w: 12,
              items: "[$on]",
              itemLabel: '"Protection " + ($item.protection_enabled ? "on" : "off")',
              itemState: "$item.protection_enabled",
            },
          ],
        },
      },
    ],
  },
  {
    id: "pihole",
    name: "Pi-hole",
    icon: "si:pihole",
    category: "Network",
    description: "Ad blocking DNS",
    ports: [80, 8080],
    match: { title: "Pi-hole" },
    widgets: [
      {
        id: "stats",
        name: "Pi-hole (v5): blocking",
        description: "Queries and ads blocked today. For Pi-hole 5; Pi-hole 6 isn't supported yet.",
        secret: { label: "API token", hint: "Settings → API → Show API token." },
        doc: {
          v: 1,
          sources: [
            {
              id: "p",
              kind: "http",
              url: "{{base}}/admin/api.php?summaryRaw&auth={{secret:key}}",
              every: 60,
            },
          ],
          blocks: [
            {
              id: "q",
              kind: "stat",
              w: 6,
              label: "Queries today",
              value: "fmt($p.dns_queries_today, 0)",
              size: "md",
            },
            {
              id: "b",
              kind: "stat",
              w: 6,
              label: "Blocked",
              value: 'round($p.ads_percentage_today, 1) + "%"',
              sub: "{{ fmt($p.ads_blocked_today, 0) }} queries",
              tone: '$p.status == "enabled" ? "normal" : "warning"',
              size: "md",
            },
          ],
        },
      },
    ],
  },
  {
    id: "nginx-proxy-manager",
    name: "Nginx Proxy Manager",
    icon: "si:nginxproxymanager",
    category: "Network",
    description: "Reverse proxy",
    ports: [81],
    match: { title: "Nginx Proxy Manager" },
  },
  {
    id: "traefik",
    name: "Traefik",
    icon: "si:traefikproxy",
    category: "Network",
    description: "Reverse proxy",
    ports: [8080],
    match: { title: "Traefik" },
  },
  {
    id: "unifi",
    name: "UniFi Network",
    icon: "si:ubiquiti",
    category: "Network",
    description: "Network controller",
    ports: [8443],
    https: true,
    match: { title: "UniFi" },
  },
  {
    id: "opnsense",
    name: "OPNsense",
    icon: "si:opnsense",
    category: "Network",
    description: "Firewall",
    ports: [443],
    https: true,
    match: { title: "OPNsense" },
  },
  {
    id: "pfsense",
    name: "pfSense",
    icon: "si:pfsense",
    category: "Network",
    description: "Firewall",
    ports: [443],
    https: true,
    match: { title: "pfSense" },
  },
  {
    id: "openwrt",
    name: "OpenWrt",
    icon: "si:openwrt",
    category: "Network",
    description: "Router",
    ports: [80],
    match: { title: "LuCI|OpenWrt" },
  },
  {
    id: "glinet",
    name: "GL.iNet router",
    icon: "lucide:router",
    category: "Network",
    description: "Router",
    ports: [80],
    match: { title: "GL\\.iNet|GL-" },
  },
  {
    id: "wireguard",
    name: "WireGuard (wg-easy)",
    icon: "si:wireguard",
    category: "Network",
    description: "VPN",
    ports: [51821],
    match: { title: "WireGuard" },
  },

  // Monitoring
  {
    id: "uptime-kuma",
    name: "Uptime Kuma",
    icon: "si:uptimekuma",
    category: "Monitoring",
    description: "Uptime monitoring",
    ports: [3001],
    match: { title: "Uptime Kuma" },
    widgets: [
      {
        id: "status-page",
        name: "Uptime Kuma: a status page",
        description: "Every monitor on one of your status pages, as lights.",
        params: [
          {
            key: "slug",
            label: "Status page slug",
            hint: "The last part of the status page's address: /status/<slug>.",
          },
        ],
        doc: {
          v: 1,
          sources: [
            {
              id: "page",
              kind: "http",
              url: "{{base}}/api/status-page/{{param:slug}}",
              every: 600,
            },
            {
              id: "beats",
              kind: "http",
              url: "{{base}}/api/status-page/heartbeat/{{param:slug}}",
              every: 60,
            },
          ],
          values: [{ id: "monitors", expr: 'flat(pluck($page.publicGroupList, "monitorList"))' }],
          blocks: [
            {
              id: "l",
              kind: "lights",
              w: 12,
              items: "$monitors",
              itemLabel: "$item.name",
              itemState:
                'last($beats.heartbeatList[$item.id]).status == 1 ? "up" : last($beats.heartbeatList[$item.id]).status == 3 ? "warn" : "down"',
              itemDetail: 'last($beats.heartbeatList[$item.id]).ping + " ms"',
              limit: 60,
            },
          ],
        },
      },
    ],
  },
  {
    id: "glances",
    name: "Glances",
    icon: "lucide:activity",
    color: "#2b9348",
    category: "Monitoring",
    description: "System and container monitoring",
    ports: [61208],
    match: { title: "Glances" },
    widgets: [
      {
        id: "system",
        name: "Glances: the server",
        description: "CPU, memory and disks (Glances 4).",
        doc: {
          v: 1,
          sources: [
            {
              id: "q",
              kind: "http",
              url: "{{base}}/api/4/quicklook",
              every: 15,
              track: "$q.cpu",
              keep: 60,
            },
            { id: "fs", kind: "http", url: "{{base}}/api/4/fs", every: 300 },
          ],
          blocks: [
            {
              id: "cpu",
              kind: "stat",
              w: 6,
              label: "CPU",
              value: "round($q.cpu)",
              unit: "%",
              spark: "$history.q",
              size: "md",
            },
            {
              id: "mem",
              kind: "gauge",
              w: 6,
              label: "Memory",
              value: "$q.mem",
              unit: "%",
              warnAt: 80,
              badAt: 92,
            },
            {
              id: "disks",
              kind: "list",
              w: 12,
              items: "$fs",
              itemTitle: "$item.mnt_point",
              itemValue: 'round($item.percent) + "%"',
              itemDetail: 'bytes($item.used) + " of " + bytes($item.size)',
              itemTone:
                '$item.percent > 90 ? "negative" : $item.percent > 80 ? "warning" : "normal"',
              limit: 6,
            },
          ],
        },
      },
      {
        id: "containers",
        name: "Glances: Docker containers",
        description: "Every container and whether it's running (Glances 4).",
        doc: {
          v: 1,
          sources: [{ id: "c", kind: "http", url: "{{base}}/api/4/containers", every: 30 }],
          blocks: [
            {
              id: "n",
              kind: "stat",
              w: 12,
              label: "Running",
              value: 'count(filter($c, "status", "==", "running"))',
              sub: "of {{ count($c) }} containers",
              tone: 'count(filter($c, "status", "!=", "running")) > 0 ? "warning" : "positive"',
              size: "md",
            },
            {
              id: "l",
              kind: "lights",
              w: 12,
              items: 'sort($c, "name")',
              itemLabel: "$item.name",
              itemState:
                '$item.status == "running" ? "up" : $item.status == "paused" ? "warn" : "down"',
              itemDetail: "$item.status",
              limit: 60,
            },
          ],
        },
      },
    ],
  },
  {
    id: "portainer",
    name: "Portainer",
    icon: "si:portainer",
    category: "Monitoring",
    description: "Docker management",
    ports: [9000, 9443],
    match: { title: "Portainer" },
    widgets: [
      {
        id: "containers",
        name: "Portainer: containers",
        description: "Every container in one environment and whether it's running.",
        secret: { label: "Access token", hint: "My account → Access tokens → Add access token." },
        params: [
          {
            key: "endpoint",
            label: "Environment id",
            hint: "The number in an environment's address (often 1 or 2).",
            default: "1",
          },
        ],
        doc: {
          v: 1,
          sources: [
            {
              id: "c",
              kind: "http",
              url: "{{base}}/api/endpoints/{{param:endpoint}}/docker/containers/json?all=1",
              headers: { "X-API-Key": "{{secret:key}}" },
              every: 30,
            },
          ],
          blocks: [
            {
              id: "n",
              kind: "stat",
              w: 12,
              label: "Running",
              value: 'count(filter($c, "State", "==", "running"))',
              sub: "of {{ count($c) }} containers",
              tone: 'count(filter($c, "State", "==", "exited")) > 0 ? "warning" : "positive"',
              size: "md",
            },
            {
              id: "l",
              kind: "lights",
              w: 12,
              items: "$c",
              itemLabel: 'replace(first($item.Names), "/", "")',
              itemState:
                '$item.State == "running" ? "up" : $item.State == "paused" ? "warn" : "down"',
              itemDetail: "$item.Status",
              limit: 60,
            },
          ],
        },
      },
    ],
  },
  {
    id: "grafana",
    name: "Grafana",
    icon: "si:grafana",
    category: "Monitoring",
    description: "Dashboards",
    ports: [3000],
    match: { title: "Grafana" },
  },
  {
    id: "prometheus",
    name: "Prometheus",
    icon: "si:prometheus",
    category: "Monitoring",
    description: "Metrics",
    ports: [9090],
    match: { title: "Prometheus" },
  },
  {
    id: "netdata",
    name: "Netdata",
    icon: "si:netdata",
    category: "Monitoring",
    description: "Real-time monitoring",
    ports: [19999],
    match: { title: "Netdata" },
  },
  {
    id: "dozzle",
    name: "Dozzle",
    icon: "lucide:scroll-text",
    category: "Monitoring",
    description: "Container logs",
    ports: [8080, 9999],
    match: { title: "Dozzle" },
  },
  {
    id: "scrutiny",
    name: "Scrutiny",
    icon: "lucide:hard-drive",
    category: "Monitoring",
    description: "Disk health",
    ports: [8080],
    match: { title: "Scrutiny" },
  },
  {
    id: "speedtest-tracker",
    name: "Speedtest Tracker",
    icon: "si:speedtest",
    category: "Monitoring",
    description: "Internet speed history",
    ports: [8765, 8080],
    match: { title: "Speedtest Tracker" },
  },

  // Storage
  {
    id: "synology-dsm",
    name: "Synology DSM",
    icon: "si:synology",
    category: "Storage",
    description: "The NAS",
    ports: [5000, 5001],
    // Not Web Station's welcome page, which DSM serves on 80 and 443.
    match: { title: "^(?!.*Web Station).*(Synology|DiskStation|RackStation)" },
  },
  {
    id: "truenas",
    name: "TrueNAS",
    icon: "si:truenas",
    category: "Storage",
    description: "The NAS",
    ports: [80, 443],
    match: { title: "TrueNAS" },
  },
  {
    id: "unraid",
    name: "Unraid",
    icon: "si:unraid",
    category: "Storage",
    description: "The server",
    ports: [80],
    match: { title: "Unraid" },
  },
  {
    id: "proxmox",
    name: "Proxmox VE",
    icon: "si:proxmox",
    category: "Storage",
    description: "Virtual machines",
    ports: [8006],
    https: true,
    match: { title: "Proxmox|pve" },
  },
  {
    id: "nextcloud",
    name: "Nextcloud",
    icon: "si:nextcloud",
    category: "Storage",
    description: "Files and more",
    ports: [80, 443, 8080],
    match: { title: "Nextcloud" },
    widgets: [
      {
        id: "info",
        name: "Nextcloud: server",
        description: "Files, active users and free space.",
        secret: {
          label: "Server info token",
          hint: "Admin settings → System → Monitoring: set a token, or use an app password.",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "n",
              kind: "http",
              url: "{{base}}/ocs/v2.php/apps/serverinfo/api/v1/info?format=json",
              headers: { "NC-Token": "{{secret:key}}" },
              path: "ocs.data",
              every: 600,
            },
          ],
          blocks: [
            {
              id: "p",
              kind: "pairs",
              w: 12,
              items: [
                { label: "Files", value: "{{ fmt($n.nextcloud.storage.num_files, 0) }}" },
                { label: "Active today", value: "{{ $n.activeUsers.last24hours }}" },
                { label: "Free space", value: "{{ bytes($n.nextcloud.system.freespace) }}" },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "syncthing",
    name: "Syncthing",
    icon: "si:syncthing",
    category: "Storage",
    description: "File sync",
    ports: [8384],
    match: { title: "Syncthing" },
  },
  {
    id: "seafile",
    name: "Seafile",
    icon: "si:seafile",
    category: "Storage",
    description: "Files",
    ports: [8000],
    match: { title: "Seafile" },
  },
  {
    id: "filebrowser",
    name: "File Browser",
    icon: "lucide:folder-open",
    category: "Storage",
    description: "Files",
    ports: [8080],
    match: { title: "File Browser" },
  },
  {
    id: "cockpit",
    name: "Cockpit",
    icon: "lucide:server",
    category: "Storage",
    description: "Server admin",
    ports: [9090],
    https: true,
    match: { title: "Cockpit" },
  },

  // Productivity
  {
    id: "paperless",
    name: "Paperless-ngx",
    icon: "si:paperlessngx",
    category: "Productivity",
    description: "Documents",
    ports: [8000],
    match: { title: "Paperless" },
    widgets: [
      {
        id: "stats",
        name: "Paperless: documents",
        description: "How many documents, and how many wait in the inbox.",
        secret: { label: "API token", hint: "Your profile → API Auth Token." },
        doc: {
          v: 1,
          sources: [
            {
              id: "p",
              kind: "http",
              url: "{{base}}/api/statistics/",
              headers: { Authorization: "Token {{secret:key}}" },
              every: 600,
            },
          ],
          blocks: [
            {
              id: "inbox",
              kind: "stat",
              w: 6,
              label: "In the inbox",
              value: "$p.documents_inbox",
              tone: '$p.documents_inbox > 0 ? "warning" : "positive"',
              size: "md",
            },
            {
              id: "all",
              kind: "stat",
              w: 6,
              label: "Documents",
              value: "fmt($p.documents_total, 0)",
              size: "md",
            },
          ],
        },
      },
    ],
  },
  {
    id: "bookstack",
    name: "BookStack",
    icon: "si:bookstack",
    category: "Productivity",
    description: "Wiki",
    ports: [6875],
    match: { title: "BookStack" },
  },
  {
    id: "wikijs",
    name: "Wiki.js",
    icon: "si:wikidotjs",
    category: "Productivity",
    description: "Wiki",
    ports: [3000],
    match: { title: "Wiki\\.js" },
  },
  {
    id: "freshrss",
    name: "FreshRSS",
    icon: "si:freshrss",
    category: "Productivity",
    description: "News feeds",
    ports: [8080],
    match: { title: "FreshRSS" },
  },
  {
    id: "miniflux",
    name: "Miniflux",
    icon: "lucide:rss",
    category: "Productivity",
    description: "News feeds",
    ports: [8080],
    match: { title: "Miniflux" },
  },
  {
    id: "linkding",
    name: "linkding",
    icon: "lucide:bookmark",
    category: "Productivity",
    description: "Bookmarks",
    ports: [9090],
    match: { title: "linkding" },
  },
  {
    id: "stirling-pdf",
    name: "Stirling-PDF",
    icon: "lucide:file-text",
    category: "Productivity",
    description: "PDF tools",
    ports: [8080],
    match: { title: "Stirling" },
  },
  {
    id: "vikunja",
    name: "Vikunja",
    icon: "lucide:list-checks",
    category: "Productivity",
    description: "To-dos",
    ports: [3456],
    match: { title: "Vikunja" },
  },
  {
    id: "ntfy",
    name: "ntfy",
    icon: "si:ntfy",
    category: "Productivity",
    description: "Notifications",
    ports: [80, 8080],
    match: { title: "ntfy" },
  },
  {
    id: "gotify",
    name: "Gotify",
    icon: "lucide:bell",
    category: "Productivity",
    description: "Notifications",
    ports: [80],
    match: { title: "Gotify" },
  },

  // Finance
  {
    id: "muny",
    name: "Muny",
    icon: "lucide:wallet",
    color: "#3fae6a",
    category: "Finance",
    description: "Budget, bills and subscriptions",
    ports: [8420],
    match: { title: "^Muny" },
    widgets: [
      {
        id: "overview",
        name: "Muny: this month",
        description:
          "Spending against budget, net worth and the next bills. Private: give it to PIN-protected pages.",
        private: true,
        secret: {
          label: "Muny agent token",
          hint: "In Muny: Settings → Agents → New token, with the read:summary scope.",
          kind: "bearer",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "muny",
              kind: "http",
              method: "POST",
              url: "{{base}}/mcp",
              every: 300,
              headers: {
                Authorization: "{{secret:key}}",
                Accept: "application/json, text/event-stream",
                "Content-Type": "application/json",
              },
              body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_financial_overview","arguments":{}}}',
            },
          ],
          values: [{ id: "o", expr: "json($muny.result.content[0].text)" }],
          blocks: [
            {
              id: "spent",
              kind: "stat",
              w: 6,
              label: "Spent this month",
              value: "money($o.spending.monthToDateCents / 100)",
              sub: "Last month by now: {{ money($o.spending.lastMonthSameDayCents / 100) }}",
              tone: '$o.spending.monthToDateCents > $o.spending.lastMonthSameDayCents ? "warning" : "positive"',
              size: "md",
            },
            {
              id: "worth",
              kind: "stat",
              w: 6,
              label: "Net worth",
              value: "money($o.netWorth.nowCents / 100)",
              size: "md",
            },
            {
              id: "budget",
              kind: "progress",
              w: 12,
              label: "Budget",
              value: "$o.budget.spentCents",
              max: "$o.budget.budgetCents",
              detail:
                "{{ money($o.budget.spentCents / 100) }} of {{ money($o.budget.budgetCents / 100) }}",
              warnAt: 85,
              badAt: 100,
            },
            {
              id: "bills",
              kind: "list",
              w: 12,
              title: "Coming up",
              items: "take($o.upcoming, 4)",
              itemTitle: "$item.name",
              itemDetail: "date($item.date)",
              itemValue: "money($item.amountCents / 100)",
              empty: "No bills due soon.",
            },
          ],
        },
      },
    ],
  },
  {
    id: "actual",
    name: "Actual Budget",
    icon: "lucide:piggy-bank",
    category: "Finance",
    description: "Budgeting",
    ports: [5006],
    match: { title: "Actual" },
  },
  {
    id: "firefly",
    name: "Firefly III",
    icon: "lucide:landmark",
    category: "Finance",
    description: "Finances",
    ports: [8080],
    match: { title: "Firefly III" },
  },

  // Development
  {
    id: "gitea",
    name: "Gitea",
    icon: "si:gitea",
    category: "Development",
    description: "Git",
    ports: [3000],
    match: { title: "Gitea" },
  },
  {
    id: "forgejo",
    name: "Forgejo",
    icon: "si:forgejo",
    category: "Development",
    description: "Git",
    ports: [3000],
    match: { title: "Forgejo" },
  },
  {
    id: "code-server",
    name: "code-server",
    icon: "lucide:code",
    category: "Development",
    description: "VS Code in the browser",
    ports: [8443, 8080],
    match: { title: "code-server" },
  },
  {
    id: "jupyter",
    name: "Jupyter",
    icon: "si:jupyter",
    category: "Development",
    description: "Notebooks",
    ports: [8888],
    match: { title: "Jupyter" },
  },
  {
    id: "n8n",
    name: "n8n",
    icon: "si:n8n",
    category: "Development",
    description: "Automations",
    ports: [5678],
    match: { title: "n8n" },
  },

  // Security
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    icon: "si:vaultwarden",
    category: "Security",
    description: "Passwords",
    ports: [80, 8080],
    match: { title: "Vaultwarden|Bitwarden" },
  },
  {
    id: "authentik",
    name: "authentik",
    icon: "si:authentik",
    category: "Security",
    description: "Sign-in",
    ports: [9000, 9443],
    match: { title: "authentik" },
  },
  {
    id: "authelia",
    name: "Authelia",
    icon: "si:authelia",
    category: "Security",
    description: "Sign-in",
    ports: [9091],
    match: { title: "Authelia" },
  },
  {
    id: "step-ca",
    name: "step-ca",
    icon: "lucide:shield-check",
    category: "Security",
    description: "Certificate authority",
    ports: [9000],
    https: true,
    // Its home page is a 404; the list of provisioners says what it is.
    match: { probe: { path: "/provisioners", body: '"provisioners"' } },
    widgets: [
      {
        id: "health",
        name: "step-ca: health",
        description: "Whether the home's certificate authority is answering.",
        doc: {
          v: 1,
          sources: [{ id: "health", kind: "http", url: "{{base}}/health", every: 300 }],
          blocks: [
            {
              id: "state",
              kind: "stat",
              w: 12,
              label: "Certificate authority",
              value: '$health.status == "ok" ? "Healthy" : "Not answering"',
              tone: '$health.status == "ok" ? "positive" : "negative"',
              size: "md",
            },
          ],
        },
      },
    ],
  },

  // Games
  {
    id: "vpin-studio",
    name: "VPin Studio",
    icon: "lucide:joystick",
    color: "#e0533d",
    category: "Home",
    description: "Pinball table manager",
    ports: [8089],
    // Its server is an API with no page; "what system is this" says what it is.
    match: { probe: { path: "/api/v1/system", body: '"systemName"' } },
  },

  // AI
  {
    id: "ollama",
    name: "Ollama",
    icon: "si:ollama",
    category: "AI",
    description: "Local AI models (or an Ollama-compatible AI server)",
    ports: [11434],
    match: { body: "Ollama is running", probe: { path: "/api/version", body: '"version"' } },
  },
  {
    id: "open-webui",
    name: "Open WebUI",
    icon: "lucide:bot",
    category: "AI",
    description: "AI chat",
    ports: [3000, 8080],
    match: { title: "Open WebUI" },
  },

  // Printing
  {
    id: "prusalink",
    name: "PrusaLink",
    icon: "lucide:box",
    color: "#fa6831",
    category: "Home",
    description: "Prusa printers (MK4, XL, MINI, CORE One)",
    ports: [80],
    // Its page comes gzipped, and its API asks for a Digest sign-in in the "Printer API" realm.
    match: {
      title: "PrusaLink|Prusa Link",
      probe: { path: "/api/version", header: 'www-authenticate: Digest realm="Printer API"' },
    },
    // Either its API key, or the user and password (Digest).
    auth: [
      {
        kind: "header",
        header: "X-Api-Key",
        label: "API key",
        hint: "On the printer: Settings → Network → PrusaLink, or in Prusa Connect's printer settings.",
      },
      {
        kind: "digest",
        label: "User name and password",
        hint: "On the printer: Settings → Network → PrusaLink (the user is usually maker).",
      },
    ],
    widgets: [
      {
        id: "status",
        name: "PrusaLink: print status",
        description: "What's printing, how far along, time left, and the temperatures.",
        secret: {
          label: "User name and password",
          hint: "On the printer: Settings → Network → PrusaLink (the user is usually maker).",
          kind: "digest",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "status",
              kind: "http",
              url: "{{base}}/api/v1/status",
              every: 15,
              digest: "{{secret:key}}",
            },
            {
              id: "job",
              kind: "http",
              url: "{{base}}/api/v1/job",
              every: 30,
              digest: "{{secret:key}}",
            },
            {
              // Its name and where it is, as set on the printer.
              id: "info",
              kind: "http",
              url: "{{base}}/api/v1/info",
              every: 3600,
              digest: "{{secret:key}}",
            },
          ],
          values: [
            { id: "s", expr: 'upper(default($status.printer.state, ""))' },
            {
              id: "state",
              expr: '$s == "IDLE" ? "Idle" : $s == "READY" ? "Ready" : $s == "PRINTING" ? "Printing" : $s == "PAUSED" ? "Paused" : $s == "FINISHED" ? "Finished" : $s == "STOPPED" ? "Stopped" : $s == "ATTENTION" ? "Needs attention" : $s == "ERROR" ? "Error" : $s == "BUSY" ? "Busy" : default($status.printer.state, "Not answering")',
            },
          ],
          blocks: [
            {
              id: "name",
              kind: "heading",
              w: 12,
              text: '{{ default($info.name, default($info.hostname, "Printer")) }}{{ $info.location ? " · " + $info.location : "" }}',
            },
            {
              id: "state",
              kind: "stat",
              w: 6,
              label: "Now",
              value: "$state",
              tone: '$s == "PRINTING" ? "positive" : $s == "ERROR" || $s == "ATTENTION" ? "negative" : $s == "PAUSED" ? "warning" : "normal"',
              size: "md",
            },
            {
              id: "left",
              kind: "stat",
              w: 6,
              label: "Time left",
              value: '$status.job.progress > 0 ? duration($status.job.time_remaining) : "—"',
              size: "md",
            },
            {
              id: "job",
              kind: "progress",
              w: 12,
              label: '{{ default($job.file.display_name, "No print") }}',
              value: "default($status.job.progress, 0)",
              max: "100",
              detail: "{{ round(default($status.job.progress, 0)) }}%",
            },
            {
              id: "temps",
              kind: "pairs",
              w: 12,
              items: [
                {
                  label: "Nozzle",
                  // The target only while it's heating.
                  value:
                    '{{ round($status.printer.temp_nozzle) }}°{{ $status.printer.target_nozzle > 0 ? " → " + round($status.printer.target_nozzle) + "°" : "" }}',
                },
                {
                  label: "Bed",
                  value:
                    '{{ round($status.printer.temp_bed) }}°{{ $status.printer.target_bed > 0 ? " → " + round($status.printer.target_bed) + "°" : "" }}',
                },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "octoprint",
    name: "OctoPrint",
    icon: "si:octoprint",
    category: "Printing",
    description: "3D printer",
    ports: [80, 5000],
    match: { title: "OctoPrint" },
    widgets: [
      {
        id: "status",
        name: "OctoPrint: print status",
        description: "What's printing, how far along, time left, and the temperatures.",
        secret: {
          label: "API key",
          hint: "In OctoPrint: Settings → Application Keys (or Settings → API → Global API Key).",
        },
        doc: {
          v: 1,
          sources: [
            {
              id: "job",
              kind: "http",
              url: "{{base}}/api/job",
              every: 20,
              headers: { "X-Api-Key": "{{secret:key}}" },
            },
            {
              id: "printer",
              kind: "http",
              url: "{{base}}/api/printer",
              every: 20,
              headers: { "X-Api-Key": "{{secret:key}}" },
            },
          ],
          blocks: [
            {
              id: "state",
              kind: "stat",
              w: 6,
              label: "Printer",
              value: "lower($job.state)",
              tone: 'lower($job.state) == "printing" ? "positive" : contains(lower($job.state), "error") ? "negative" : "normal"',
              size: "md",
            },
            {
              id: "left",
              kind: "stat",
              w: 6,
              label: "Time left",
              value: '$job.progress.completion > 0 ? duration($job.progress.printTimeLeft) : "—"',
              size: "md",
            },
            {
              id: "job",
              kind: "progress",
              w: 12,
              label: '{{ default($job.job.file.display, "No print") }}',
              value: "default($job.progress.completion, 0)",
              max: "100",
              detail: "{{ round(default($job.progress.completion, 0)) }}%",
            },
            {
              id: "temps",
              kind: "pairs",
              w: 12,
              items: [
                {
                  label: "Nozzle",
                  value:
                    '{{ round($printer.temperature.tool0.actual) }}°{{ $printer.temperature.tool0.target > 0 ? " → " + round($printer.temperature.tool0.target) + "°" : "" }}',
                },
                {
                  label: "Bed",
                  value:
                    '{{ round($printer.temperature.bed.actual) }}°{{ $printer.temperature.bed.target > 0 ? " → " + round($printer.temperature.bed.target) + "°" : "" }}',
                },
              ],
            },
          ],
        },
      },
    ],
  },
  {
    id: "mainsail",
    name: "Mainsail",
    icon: "lucide:printer",
    category: "Printing",
    description: "3D printer (Klipper)",
    ports: [80],
    match: { title: "Mainsail" },
  },
  {
    id: "fluidd",
    name: "Fluidd",
    icon: "lucide:printer",
    category: "Printing",
    description: "3D printer (Klipper)",
    ports: [80],
    match: { title: "Fluidd" },
  },
  {
    id: "cups",
    name: "CUPS",
    icon: "lucide:printer",
    category: "Printing",
    description: "Printers",
    ports: [631],
    match: { title: "CUPS" },
  },

  // Dashboards
  {
    id: "heimdall",
    name: "Heimdall",
    icon: "lucide:layout-grid",
    category: "Dashboards",
    description: "Start page",
    ports: [80, 443, 8081],
    match: { title: "^Heimdall$" },
  },
  {
    id: "homarr",
    name: "Homarr",
    icon: "si:homarr",
    category: "Dashboards",
    description: "Start page",
    ports: [7575],
    match: { title: "Homarr" },
  },
  {
    id: "homepage",
    name: "Homepage",
    icon: "si:homepage",
    category: "Dashboards",
    description: "Start page",
    ports: [3000],
    match: { body: "gethomepage|homepage-logo" },
  },
  {
    id: "dashy",
    name: "Dashy",
    icon: "lucide:layout-dashboard",
    category: "Dashboards",
    description: "Start page",
    ports: [4000, 8080],
    match: { title: "^Dashy" },
  },
  {
    id: "organizr",
    name: "Organizr",
    icon: "lucide:layout-dashboard",
    category: "Dashboards",
    description: "Start page",
    ports: [80],
    match: { title: "Organizr" },
  },

  // Cameras and things around the house
  {
    id: "motioneye",
    name: "motionEye",
    icon: "lucide:cctv",
    category: "Home",
    description: "Cameras",
    ports: [8765],
    match: { title: "motionEye" },
    widgets: [
      {
        id: "camera",
        name: "motionEye: camera",
        description:
          "A camera's picture, refreshed every few seconds. Hearth fetches it, so the camera stays private.",
        params: [
          {
            key: "snapshot",
            label: "Snapshot address",
            hint: "In motionEye: the camera's settings → Video Streaming → Useful URLs → Snapshot URL.",
            default: "http://",
          },
        ],
        doc: {
          v: 1,
          sources: [],
          blocks: [
            { id: "cam", kind: "image", w: 12, src: "{{param:snapshot}}", every: 5, height: 220 },
          ],
        },
      },
    ],
  },
  {
    id: "scrypted",
    name: "Scrypted",
    icon: "lucide:cctv",
    category: "Home",
    description: "Cameras",
    ports: [10443, 11080],
    https: true,
    match: { title: "Scrypted" },
  },
  {
    id: "ip-camera",
    name: "Camera",
    icon: "lucide:webcam",
    category: "Home",
    description: "A network camera",
    ports: [80, 443],
    match: { title: "Reolink|Hikvision|Amcrest|Dahua|Network Camera|IP ?Camera|IPCam|Foscam" },
  },
  {
    id: "tasmota",
    name: "Tasmota",
    icon: "si:tasmota",
    category: "Home",
    description: "A smart plug or switch",
    ports: [80],
    match: { title: "Tasmota", body: "Tasmota" },
  },
  {
    id: "shelly",
    name: "Shelly",
    icon: "si:shelly",
    category: "Home",
    description: "A smart relay or plug",
    ports: [80],
    match: { title: "Shelly", probe: { path: "/shelly", body: '"type"' } },
  },
  {
    id: "wled",
    name: "WLED",
    icon: "lucide:lightbulb",
    category: "Home",
    description: "LED lights",
    ports: [80],
    match: { title: "^WLED", probe: { path: "/json/info", body: '"ver"' } },
  },
  {
    id: "hue",
    name: "Philips Hue bridge",
    icon: "si:philipshue",
    category: "Home",
    description: "Lights",
    ports: [80, 443],
    match: {
      title: "hue personal wireless lighting|Philips hue",
      probe: { path: "/api/config", body: '"bridgeid"' },
    },
  },
  {
    id: "kodi",
    name: "Kodi",
    icon: "si:kodi",
    category: "Media",
    description: "Media player",
    ports: [8080],
    match: { title: "^Kodi" },
  },

  // Printers and routers that make up most of what answers on a home network
  {
    id: "printer",
    name: "Printer",
    icon: "lucide:printer",
    category: "Printing",
    description: "A network printer",
    ports: [80, 443],
    match: {
      title:
        "LaserJet|OfficeJet|DeskJet|ENVY|HP Smart|Brother|EPSON|Canon|Kyocera|Xerox|Lexmark|Ricoh|Printer",
    },
  },
  {
    id: "tp-link",
    name: "TP-Link",
    icon: "si:tplink",
    category: "Network",
    description: "Router, mesh or switch",
    ports: [80, 443],
    match: { title: "TP-?LINK|Archer|Deco|Omada" },
  },
  {
    id: "netgear",
    name: "NETGEAR",
    icon: "si:netgear",
    category: "Network",
    description: "Router or switch",
    ports: [80, 443],
    match: { title: "NETGEAR|Orbi|Nighthawk" },
  },
  {
    id: "asus-router",
    name: "ASUS router",
    icon: "si:asus",
    category: "Network",
    description: "Router",
    ports: [80, 443, 8443],
    match: { title: "ASUS (Wireless )?Router|ASUSWRT|RT-[A-Z]{2}[0-9]" },
  },
  {
    id: "qnap",
    name: "QNAP",
    icon: "si:qnap",
    category: "Storage",
    description: "The NAS",
    ports: [8080, 443],
    match: { title: "QNAP|QTS" },
  },
];

export function findApp(id: string | undefined, extra: AppDef[] = []): AppDef | undefined {
  if (!id) return undefined;
  return APPS.find((a) => a.id === id) ?? extra.find((a) => a.id === id);
}

/** Widgets anyone could add, not tied to one app. Weather and news need the internet allowed. */
export interface GeneralTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  needsInternet?: boolean;
  params?: AppParam[];
  doc: WidgetDocInput;
}

export const GENERAL_TEMPLATES: GeneralTemplate[] = [
  {
    id: "services-lights",
    name: "Service Health",
    icon: "lucide:traffic-cone",
    description: "Every service Hearth checks, as a light, with how many are up.",
    doc: {
      v: 1,
      sources: [{ id: "home", kind: "hearth", what: "status" }],
      blocks: [
        {
          id: "count",
          kind: "stat",
          w: 5,
          label: "Answering",
          value: "$home.up",
          sub: "of {{ $home.total }} services",
          tone: '$home.down > 0 ? "warning" : "positive"',
        },
        {
          id: "lights",
          kind: "lights",
          w: 7,
          items: "$home.tiles",
          itemLabel: "$item.name",
          itemState: '$item.state == "slow" ? "warn" : $item.state',
          itemDetail: '$item.ms ? $item.ms + " ms" : ""',
        },
      ],
    },
  },
  {
    id: "server",
    name: "This server",
    icon: "lucide:server",
    description: "Load, memory and disk of the machine Hearth runs on.",
    doc: {
      v: 1,
      sources: [{ id: "h", kind: "hearth", what: "host" }],
      blocks: [
        {
          id: "load",
          kind: "stat",
          w: 6,
          label: "Load",
          value: "round($h.load1, 2)",
          sub: "{{ $h.cpus }} cores",
          size: "md",
        },
        {
          id: "mem",
          kind: "gauge",
          w: 6,
          label: "Memory",
          value: "pct($h.memUsed, $h.memTotal)",
          unit: "%",
          warnAt: 80,
          badAt: 92,
        },
        {
          id: "disk",
          kind: "progress",
          w: 12,
          label: "Hearth's disk",
          value: "$h.diskUsed",
          max: "$h.diskTotal",
          detail: "{{ bytes($h.diskUsed) }} of {{ bytes($h.diskTotal) }}",
          warnAt: 80,
          badAt: 92,
        },
        {
          id: "up",
          kind: "pairs",
          w: 12,
          items: [
            { label: "Up for", value: "{{ duration($h.uptime) }}" },
            { label: "Host", value: "{{ $h.hostname }}" },
          ],
        },
      ],
    },
  },
  {
    id: "weather",
    name: "Weather",
    icon: "lucide:cloud-sun",
    needsInternet: true,
    description:
      "Now and the next days, from Open-Meteo (free, no key). Needs the internet allowed in Settings.",
    params: [
      { key: "lat", label: "Latitude", hint: "Like 40.71", default: "" },
      { key: "lon", label: "Longitude", hint: "Like -74.01", default: "" },
      { key: "unit", label: "Units", hint: "celsius or fahrenheit", default: "celsius" },
    ],
    doc: {
      v: 1,
      sources: [
        {
          id: "w",
          kind: "http",
          url: "https://api.open-meteo.com/v1/forecast?latitude={{param:lat}}&longitude={{param:lon}}&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=4&timezone=auto&temperature_unit={{param:unit}}",
          every: 900,
        },
      ],
      blocks: [
        {
          id: "now",
          kind: "stat",
          w: 12,
          label: "{{ wmo($w.current.weather_code) }}",
          value: "round($w.current.temperature_2m)",
          unit: "°",
          sub: "Wind {{ round($w.current.wind_speed_10m) }} km/h · Humidity {{ $w.current.relative_humidity_2m }}%",
          size: "lg",
        },
        {
          id: "days",
          kind: "list",
          w: 12,
          items: "take($w.daily.time, -3)",
          itemIcon: "wmoIcon($w.daily.weather_code[$index + 1])",
          itemTitle: "date($item)",
          itemValue:
            'round($w.daily.temperature_2m_max[$index + 1]) + "° / " + round($w.daily.temperature_2m_min[$index + 1]) + "°"',
        },
      ],
    },
  },
  {
    id: "rss",
    name: "News feed",
    icon: "lucide:rss",
    needsInternet: true,
    description:
      "The newest items from any RSS or Atom feed (a site on the internet needs the internet allowed).",
    params: [
      {
        key: "feed",
        label: "Feed address",
        hint: "Like https://example.com/feed.xml",
        default: "https://",
      },
    ],
    doc: {
      v: 1,
      sources: [{ id: "f", kind: "http", url: "{{param:feed}}", every: 1800 }],
      values: [{ id: "items", expr: "default($f.rss.channel.item, $f.feed.entry)" }],
      blocks: [
        {
          id: "list",
          kind: "list",
          w: 12,
          items: "$items",
          itemTitle: "text($item.title)",
          itemDetail: "ago(default($item.pubDate, $item.updated))",
          limit: 6,
          empty: "The feed is empty.",
        },
      ],
    },
  },
  {
    id: "camera",
    name: "Camera picture",
    icon: "lucide:cctv",
    description:
      "A snapshot from a camera on the home network, refreshed every few seconds. Hearth fetches it, so the camera's address stays private.",
    params: [
      {
        key: "snapshot",
        label: "Snapshot address",
        hint: "The camera's JPEG snapshot URL.",
        default: "http://",
      },
    ],
    doc: {
      v: 1,
      sources: [],
      blocks: [
        { id: "cam", kind: "image", w: 12, src: "{{param:snapshot}}", every: 10, height: 220 },
      ],
    },
  },
];

/** Fill a template's placeholders. Unknown params become empty; secrets point at `secretName`. */
export function fillTemplate(
  doc: WidgetDocInput,
  opts: { base?: string; secretName?: string; params?: Record<string, string> },
): WidgetDocInput {
  const base = (opts.base ?? "").replace(/\/+$/, "");
  const text = JSON.stringify(doc)
    .replace(/\{\{base\}\}/g, base)
    .replace(/\{\{secret:key\}\}/g, opts.secretName ? `{{secret:${opts.secretName}}}` : "")
    .replace(/\{\{param:([a-z0-9_]+)\}\}/gi, (_m, k: string) =>
      JSON.stringify(opts.params?.[k] ?? "").slice(1, -1),
    );
  return JSON.parse(text) as WidgetDocInput;
}
