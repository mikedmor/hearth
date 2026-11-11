/**
 * Find services: scan the home network for apps Hearth knows, and add them as tiles.
 * Only private addresses are scanned. One app answering on several ports of one machine (a NAS on
 * 5000 and 5001) is one row, with its addresses to choose from; what's already a tile is marked.
 */
import { useQueryClient } from "@tanstack/react-query";
import { Radar, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IconSvg } from "../../shared/api";
import { api, streamEvents } from "../lib/api";
import { TileIcon } from "./Tile";
import { Button, ErrorNote, Field, Input, Modal, Toggle, useToast } from "./ui";

interface Found {
  url: string;
  host: string;
  port: number;
  title: string;
  tile: string | null;
  app?: { id: string; name: string; icon: string; category: string; color?: string; svg?: IconSvg };
}

type ScanEvent =
  | { type: "start"; hosts: number; ports: number; refused: string[] }
  | { type: "progress"; done: number; total: number }
  | { type: "looking"; done: number; total: number }
  | { type: "found"; found: Found }
  | { type: "done" };

/** One app on one machine, with every address it answered on. */
interface Row {
  key: string;
  app?: Found["app"];
  host: string;
  title: string;
  /** Best first: one that's already a tile, then plain http (no certificate warnings on an IP). */
  options: Found[];
  tile: string | null;
}

const rank = (f: Found) => (f.tile ? 0 : 10) + (f.url.startsWith("http:") ? 0 : 1) + f.port / 1e6;

function rowsOf(found: Found[]): Row[] {
  const rows = new Map<string, Row>();
  for (const f of found) {
    const key = f.app ? `${f.host}|${f.app.id}` : f.url;
    const row = rows.get(key) ?? {
      key,
      app: f.app,
      host: f.host,
      title: f.title,
      options: [],
      tile: null,
    };
    row.options.push(f);
    row.options.sort((a, b) => rank(a) - rank(b));
    row.tile = row.options.find((o) => o.tile)?.tile ?? null;
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) =>
      Number(Boolean(b.app)) - Number(Boolean(a.app)) ||
      a.host.localeCompare(b.host, undefined, { numeric: true }) ||
      (a.options[0]?.port ?? 0) - (b.options[0]?.port ?? 0),
  );
}

export function FindServices({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [targets, setTargets] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [looking, setLooking] = useState<{ done: number; total: number } | null>(null);
  const [found, setFound] = useState<Found[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [address, setAddress] = useState<Record<string, string>>({});
  const [byKind, setByKind] = useState(true);
  const [showUnknown, setShowUnknown] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [finished, setFinished] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    void api
      .get<{ targets: string }>("/api/admin/discover")
      .then((r) => setTargets((t) => t || r.targets));
  }, []);

  const rows = useMemo(() => rowsOf(found), [found]);

  const start = async () => {
    setRunning(true);
    setFinished(false);
    setError(null);
    setFound([]);
    setChosen(new Set());
    setAddress({});
    setLooking(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      await streamEvents<ScanEvent>(
        "/api/admin/discover",
        { targets },
        (e) => {
          if (e.type === "progress") setProgress({ done: e.done, total: e.total });
          else if (e.type === "looking") setLooking({ done: e.done, total: e.total });
          else if (e.type === "found") {
            setFound((f) => [...f, e.found]);
            // Recognised apps that aren't tiles yet start ticked.
            if (e.found.app && !e.found.tile)
              setChosen((c) => new Set(c).add(`${e.found.host}|${e.found.app?.id}`));
          } else if (e.type === "done") setFinished(true);
        },
        controller.signal,
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e);
    } finally {
      setRunning(false);
    }
  };

  const add = async () => {
    const items = rows
      .filter((r) => chosen.has(r.key) && !r.tile)
      .map((r) => {
        const url = address[r.key] ?? r.options[0]?.url ?? "";
        const port = r.options.find((o) => o.url === url)?.port;
        return {
          name: r.app?.name ?? (r.title || `${r.host}:${port}`).slice(0, 40),
          url,
          group: byKind && r.app ? r.app.category : "Home",
          icon: r.app?.icon,
          color: r.app?.color,
          app: r.app?.id,
        };
      });
    try {
      const r = await api.post<{ added: string[] }>("/api/admin/tiles/add-many", { items });
      toast(`Added ${r.added.length} link${r.added.length === 1 ? "" : "s"}`);
      await qc.invalidateQueries();
      onClose();
    } catch (e) {
      setError(e);
    }
  };

  const known = rows.filter((r) => r.app);
  const unknown = rows.length - known.length;
  const shown = showUnknown ? rows : known;
  const count = rows.filter((r) => chosen.has(r.key) && !r.tile).length;
  const pct = progress ? Math.round((progress.done / Math.max(1, progress.total)) * 100) : 0;
  const status = running
    ? looking
      ? `Looking at what answered… ${looking.done} of ${looking.total}`
      : `Knocking… ${pct}%`
    : finished
      ? `Done. Found ${known.length} app${known.length === 1 ? "" : "s"}${unknown ? ` and ${unknown} other web page${unknown === 1 ? "" : "s"}` : ""}.`
      : "Stopped. What was found so far is below.";

  return (
    <Modal
      open
      wide
      onClose={() => {
        abort.current?.abort();
        onClose();
      }}
      title="Find services on your network"
      footer={
        <>
          <Toggle
            label="Put them in sections by kind (Media, Downloads…)"
            checked={byKind}
            onChange={setByKind}
          />
          <span className="grow" />
          <Button variant="primary" onClick={add} disabled={!count}>
            Add {count || ""} link{count === 1 ? "" : "s"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-[13.5px] text-muted">
          Hearth knocks on the usual ports of about 90 self-hosted apps and devices (Plex, Jellyfin,
          the *arrs, Home Assistant, Pi-hole, printers, routers…) and reads each page to tell what
          it is. Only addresses on your own network are looked at.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Field
            label="Where to look"
            hint="Private addresses: a network like 192.168.1.0/24, single addresses, or names like nas.local."
            className="grow"
          >
            {(id) => (
              <Input
                id={id}
                value={targets}
                onChange={(e) => setTargets(e.target.value)}
                placeholder="192.168.1.0/24"
              />
            )}
          </Field>
          {running ? (
            <Button onClick={() => abort.current?.abort()}>
              <Square className="size-4" /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={start} disabled={!targets.trim()}>
              <Radar className="size-4" /> {found.length ? "Scan again" : "Scan"}
            </Button>
          )}
        </div>
        {progress ? (
          <div className="grid gap-1">
            <div className="h-2 overflow-hidden rounded-full bg-(--c-surface-2)">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{
                  width: `${looking ? Math.round((looking.done / Math.max(1, looking.total)) * 100) : pct}%`,
                }}
              />
            </div>
            <p className="text-[12px] text-muted">{status}</p>
          </div>
        ) : null}
        <ErrorNote error={error} />
        {shown.length ? (
          <ul className="grid max-h-[46vh] gap-1.5 overflow-y-auto">
            {shown.map((r) => {
              const label = r.app?.name ?? (r.title || "Unknown web page");
              const url = address[r.key] ?? r.options[0]?.url ?? "";
              return (
                <li
                  key={r.key}
                  className="flex items-center gap-3 rounded-xl border border-line px-3 py-2"
                  style={
                    r.app?.color ? ({ "--tile": r.app.color } as React.CSSProperties) : undefined
                  }
                >
                  <input
                    type="checkbox"
                    aria-label={`Add ${label}`}
                    checked={!r.tile && chosen.has(r.key)}
                    disabled={Boolean(r.tile)}
                    onChange={(e) =>
                      setChosen((c) => {
                        const n = new Set(c);
                        if (e.target.checked) n.add(r.key);
                        else n.delete(r.key);
                        return n;
                      })
                    }
                    className="size-4 flex-none accent-accent"
                  />
                  <span className="flex-none scale-75">
                    <TileIcon
                      tile={
                        r.app?.svg
                          ? { name: label, iconKind: "svg", svg: r.app.svg }
                          : { name: label, iconKind: "monogram" }
                      }
                    />
                  </span>
                  <span className="grid min-w-0 grow">
                    <span className="truncate font-semibold">{label}</span>
                    <span className="truncate text-[12px] text-muted">
                      {r.app
                        ? `${r.app.category}${r.title && r.title !== r.app.name ? ` · ${r.title}` : ""}`
                        : r.host}
                    </span>
                  </span>
                  {r.options.length > 1 && !r.tile ? (
                    <select
                      aria-label={`Address for ${label}`}
                      value={url}
                      onChange={(e) => setAddress((a) => ({ ...a, [r.key]: e.target.value }))}
                      className="h-8 max-w-56 flex-none rounded-lg border border-line bg-page px-2 text-[12.5px]"
                    >
                      {r.options.map((o) => (
                        <option key={o.url} value={o.url}>
                          {o.url.replace(/^https?:\/\//, (m) => (m === "https://" ? "🔒 " : ""))}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="max-w-56 flex-none truncate text-[12.5px] text-muted">
                      {url.replace(/^https?:\/\//, "")}
                    </span>
                  )}
                  {r.tile ? (
                    <span className="flex-none rounded-full bg-good/15 px-2 py-0.5 text-[11px] font-semibold text-good">
                      Already added
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {unknown ? (
          <Toggle
            label={`Show ${unknown} other web page${unknown === 1 ? "" : "s"} Hearth didn't recognise`}
            checked={showUnknown}
            onChange={setShowUnknown}
          />
        ) : null}
      </div>
    </Modal>
  );
}
