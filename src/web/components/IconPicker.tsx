/**
 * Choosing a tile's icon: suggestions from the tile's name and address, then search
 * across about 3,400 app logos, 2,000 symbols and 1,900 emoji that ship with Hearth. Or use the
 * site's own icon, upload a picture, or have none (a monogram). Nothing is searched on the web.
 */
import { useQuery } from "@tanstack/react-query";
import { Globe, ImageUp, Loader2, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { IconResult, ViewTile } from "../../shared/api";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { TileIcon } from "./Tile";
import { ErrorNote } from "./ui";

type Kind = "all" | "brand" | "symbol" | "emoji";
const KINDS: { value: Kind; label: string }[] = [
  { value: "all", label: "All" },
  { value: "brand", label: "App logos" },
  { value: "symbol", label: "Symbols" },
  { value: "emoji", label: "Emoji" },
];

/** An emoji typed or pasted into the search box. */
const pasted = (s: string) =>
  s.match(/\p{Extended_Pictographic}(️|‍\p{Extended_Pictographic}|\p{EMod})*/u)?.[0] ?? null;

/** Draw any icon reference ("si:plex", "lucide:house", an emoji, a file) where only the ref is known. */
export function RefIcon({ name, icon, color }: { name: string; icon?: string; color?: string }) {
  const r = useQuery({
    queryKey: ["icon-resolve", icon],
    queryFn: () =>
      api.get<Pick<ViewTile, "icon" | "iconKind" | "svg">>(
        `/api/icons/resolve?ref=${encodeURIComponent(icon ?? "")}`,
      ),
    enabled: Boolean(icon),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return (
    <span style={color ? ({ "--tile": color } as React.CSSProperties) : undefined}>
      <TileIcon tile={{ name: name || "?", ...(r.data ?? { iconKind: "monogram" }) }} />
    </span>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function IconPicker({
  value,
  onChange,
  name,
  url,
  color,
  canUpload,
}: {
  value: string | undefined;
  onChange: (ref: string | undefined) => void;
  /** The tile's name and address, for suggestions. */
  name: string;
  url: string;
  color?: string;
  /** The admin may upload pictures. */
  canUpload?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const q = useDebounced(query.trim(), 200);
  const hint = useDebounced(`${name}|${url}`, 400);

  const results = useQuery({
    queryKey: ["icons", q, kind],
    queryFn: () =>
      api.get<IconResult[]>(`/api/icons?q=${encodeURIComponent(q)}&kind=${kind}&limit=72`),
    enabled: q.length > 0,
    staleTime: 60_000,
  });
  const suggested = useQuery({
    queryKey: ["icons-suggest", hint],
    queryFn: () => {
      const [n, u] = hint.split("|");
      return api.get<IconResult[]>(
        `/api/icons/suggest?name=${encodeURIComponent(n ?? "")}&url=${encodeURIComponent(u ?? "")}`,
      );
    },
    enabled: hint.length > 1,
    staleTime: 60_000,
  });
  const current = useQuery({
    queryKey: ["icon-resolve", value],
    queryFn: () =>
      api.get<Pick<ViewTile, "icon" | "iconKind" | "svg">>(
        `/api/icons/resolve?ref=${encodeURIComponent(value ?? "")}`,
      ),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const direct = pasted(query);
  const shown: IconResult[] = q
    ? [
        ...(direct ? [{ ref: direct, label: "pasted", kind: "emoji" as const }] : []),
        ...(results.data ?? []).filter((r) => r.ref !== direct),
      ]
    : (suggested.data ?? []);

  const fromSite = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ file: string }>("/api/icons/fetch", { url });
      onChange(r.file);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setError(null);
    try {
      const r = await api.post<{ file: string }>("/api/admin/icons", form);
      onChange(r.file);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <fieldset className="grid gap-2.5">
      <legend className="mb-1.5 text-[13px] font-semibold">Icon</legend>
      <div
        className="flex flex-wrap items-center gap-2"
        style={color ? ({ "--tile": color } as React.CSSProperties) : undefined}
      >
        <span className="flex-none">
          <TileIcon tile={{ name: name || "?", ...(current.data ?? { iconKind: "monogram" }) }} />
        </span>
        <label className="relative flex min-w-48 grow items-center">
          <Search className="pointer-events-none absolute left-3 size-4 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search logos, symbols and emoji…"
            aria-label="Search icons"
            className="h-10 w-full rounded-xl border border-line bg-page pr-3 pl-9 text-[14px] focus:border-accent focus:outline-none"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
            className={cx(
              "h-7 rounded-full border px-2.5 text-[12px] font-semibold",
              kind === k.value ? "border-accent bg-accent/10 text-ink" : "border-line text-muted",
            )}
          >
            {k.label}
          </button>
        ))}
        <span className="grow" />
        {/^https?:\/\/\S+/.test(url) ? (
          <button
            type="button"
            onClick={fromSite}
            disabled={busy}
            className="flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[12px] font-semibold text-muted hover:text-ink"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Globe className="size-3.5" />}{" "}
            The site's own icon
          </button>
        ) : null}
        {canUpload ? (
          <label className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-line px-2.5 text-[12px] font-semibold text-muted hover:text-ink">
            <ImageUp className="size-3.5" /> Upload
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon"
              className="sr-only"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
        ) : null}
        {value ? (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[12px] font-semibold text-muted hover:text-ink"
          >
            <X className="size-3.5" /> No icon
          </button>
        ) : null}
      </div>
      <p className="text-[12px] text-muted">
        {q
          ? results.isFetching
            ? "Searching…"
            : `${shown.length} found`
          : "Suggested for this tile. Search for more: “plex”, “camera”, “printer”, “🎮”."}
      </p>
      <div
        className="grid max-h-56 grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1 overflow-y-auto rounded-xl border border-line p-1.5"
        role="listbox"
        aria-label="Icons"
      >
        {shown.map((r) => (
          <button
            key={r.ref}
            type="button"
            role="option"
            aria-selected={value === r.ref}
            title={r.label}
            onClick={() => onChange(r.ref)}
            className={cx(
              "flex flex-col items-center gap-1 rounded-lg px-1 py-1.5 transition hover:bg-(--c-surface-2)",
              value === r.ref && "bg-accent/15 ring-2 ring-accent",
            )}
            style={color ? ({ "--tile": color } as React.CSSProperties) : undefined}
          >
            <span className="scale-[0.82]">
              <TileIcon
                tile={{
                  name: r.label,
                  iconKind: r.kind === "emoji" ? "emoji" : "svg",
                  icon: r.kind === "emoji" ? r.ref : undefined,
                  svg: r.svg,
                }}
              />
            </span>
            <span className="w-full truncate text-[10.5px] text-muted">{r.label}</span>
          </button>
        ))}
        {!shown.length && !results.isFetching && !suggested.isFetching ? (
          <p className="col-span-full p-3 text-center text-[13px] text-muted">
            {q ? "Nothing found. Try another word." : "Type the app's name to search."}
          </p>
        ) : null}
      </div>
      <ErrorNote error={error} />
    </fieldset>
  );
}
