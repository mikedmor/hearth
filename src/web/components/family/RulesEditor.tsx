/**
 * A child's rules: their usual mode, their sites, what else a device needs, and schedules.
 * Used on the Family page.
 */

import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Mode, PersonRules, Schedule, ServiceInfo } from "../../../shared/internet";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { Button, Field, Input, Segmented, Select, Toggle } from "../ui";

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "open", label: "Whole internet" },
  { value: "sites", label: "Only their sites" },
  { value: "paused", label: "Paused" },
];

/** Runs a change, refreshes what shows it, and says how it went. */
export type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;

export function RulesEditor({
  person,
  rules,
  pageSites,
  name,
  act,
}: {
  person: string;
  rules: PersonRules;
  pageSites: string[];
  name: string;
  act: Act;
}) {
  const p = { person, pageSites };
  const [r, setR] = useState<PersonRules>(rules);
  const [site, setSite] = useState("");
  const [busy, setBusy] = useState(false);
  // A save elsewhere (another parent, another device) resets the form.
  const saved = JSON.stringify(rules);
  useEffect(() => setR(JSON.parse(saved) as PersonRules), [saved]);
  const dirty = JSON.stringify(r) !== saved;
  const set = (patch: Partial<PersonRules>) => setR((x) => ({ ...x, ...patch }));
  const addSite = () => {
    const s = site
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[/?#].*$/, "");
    if (!s) return;
    if (!r.extra.includes(s)) set({ extra: [...r.extra, s].sort() });
    setSite("");
  };
  const save = async () => {
    setBusy(true);
    await act(() => api.put(`/api/family/${person}/rules`, r), "Saved");
    setBusy(false);
  };

  return (
    <div className="grid gap-4">
      <Field label="Usually">
        {() => (
          <Segmented
            label="Usually"
            value={r.mode}
            onChange={(mode) => set({ mode })}
            options={MODE_OPTIONS}
          />
        )}
      </Field>

      <div className="grid gap-2">
        <Toggle
          label={`The sites on ${name}'s page`}
          hint="Every internet link on their Hearth page is allowed, with what those sites need to load."
          checked={r.usePage}
          onChange={(usePage) => set({ usePage })}
        />
        {r.usePage ? (
          <Chips items={p.pageSites} empty="No internet links on their page yet." />
        ) : null}
      </div>

      <div className="grid gap-2">
        <span className="text-[14px] font-semibold">More allowed sites</span>
        <Chips
          items={r.extra}
          empty="None yet."
          onRemove={(s) => set({ extra: r.extra.filter((x) => x !== s) })}
        />
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addSite();
          }}
        >
          <Input
            aria-label="A site to allow"
            placeholder="pbskids.org"
            value={site}
            onChange={(e) => setSite(e.target.value)}
          />
          <Button type="submit" variant="secondary">
            <Plus className="size-4" /> Add
          </Button>
        </form>
        <p className="text-[12.5px] text-muted">
          A site comes with all its parts (allowing pbskids.org allows www.pbskids.org too).
        </p>
      </div>

      <Field label="Also allowed, so the device works">
        {() => (
          <Segmented
            label="Also allowed"
            value={r.essentials}
            onChange={(essentials) => set({ essentials })}
            options={[
              { value: "device", label: "Updates, app store, sign-in" },
              { value: "basic", label: "Only the basics" },
            ]}
          />
        )}
      </Field>

      <div className="grid gap-3 border-t border-line pt-4">
        <span className="text-[14px] font-semibold">Safety, whatever the mode</span>
        <Toggle
          label="Safe search"
          hint="Google, Bing, DuckDuckGo and others show safe results, and YouTube is in Restricted Mode."
          checked={r.safeSearch}
          onChange={(safeSearch) => set({ safeSearch })}
        />
        <Toggle
          label="Block adult sites"
          hint="AdGuard Home's adult-content filter (it checks names with AdGuard's service, without saying who asked)."
          checked={r.adult}
          onChange={(adult) => set({ adult })}
        />
        <ServicePicker value={r.services} onChange={(services) => set({ services })} />
      </div>

      <Schedules value={r.schedule} onChange={(schedule) => set({ schedule })} />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!dirty} busy={busy} onClick={save}>
          <Check className="size-4" /> Save {name}'s rules
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setR(JSON.parse(saved) as PersonRules)}>
            Undo changes
          </Button>
        ) : null}
      </div>

      <CheckSite person={p.person} />
    </div>
  );
}

export function Chips({
  items,
  empty,
  onRemove,
}: {
  items: string[];
  empty: string;
  onRemove?: (s: string) => void;
}) {
  if (!items.length) return <p className="text-[12.5px] text-muted">{empty}</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <li
          key={s}
          className="flex items-center gap-1 rounded-full bg-(--c-surface-2) py-1 pr-1.5 pl-3 text-[12.5px] font-semibold"
        >
          {s}
          {onRemove ? (
            <button
              type="button"
              aria-label={`Remove ${s}`}
              onClick={() => onRemove(s)}
              className="grid size-5 place-items-center rounded-full text-muted hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <span className="w-1.5" />
          )}
        </li>
      ))}
    </ul>
  );
}

const newId = () => Math.random().toString(36).slice(2, 10);

function Schedules({ value, onChange }: { value: Schedule[]; onChange: (s: Schedule[]) => void }) {
  const change = (i: number, patch: Partial<Schedule>) =>
    onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="grid gap-2">
      <span className="text-[14px] font-semibold">Schedules</span>
      <p className="text-[12.5px] text-muted">
        At these times their mode changes. The first that fits wins; a pause beats them all. A time
        that ends earlier than it starts runs past midnight.
      </p>
      {value.map((s, i) => (
        <div key={s.id} className="grid gap-2 rounded-xl border border-line p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label="Name"
              placeholder="Bedtime"
              className="max-w-40"
              value={s.name ?? ""}
              onChange={(e) => change(i, { name: e.target.value || undefined })}
            />
            <Input
              type="time"
              aria-label="From"
              className="max-w-32"
              value={s.from}
              onChange={(e) => change(i, { from: e.target.value })}
            />
            <span className="text-muted">to</span>
            <Input
              type="time"
              aria-label="To"
              className="max-w-32"
              value={s.to}
              onChange={(e) => change(i, { to: e.target.value })}
            />
            <Select
              aria-label="Mode"
              className="max-w-44"
              value={s.mode}
              onChange={(e) => change(i, { mode: e.target.value as Mode })}
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
            <button
              type="button"
              aria-label="Remove this time"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="ml-auto grid size-8 place-items-center rounded-full text-muted hover:text-bad"
            >
              <X className="size-4" />
            </button>
          </div>
          <fieldset className="flex gap-1" aria-label="Days">
            {DAYS.map((d, n) => {
              const on = s.days.includes(n);
              return (
                <button
                  key={DAY_NAMES[n]}
                  type="button"
                  aria-pressed={on}
                  aria-label={DAY_NAMES[n]}
                  onClick={() => {
                    const days = on ? s.days.filter((x) => x !== n) : [...s.days, n].sort();
                    if (days.length) change(i, { days });
                  }}
                  className={cx(
                    "size-8 rounded-full text-[12.5px] font-bold transition",
                    on ? "bg-accent text-white" : "bg-(--c-surface-2) text-muted",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </fieldset>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange([
              ...value,
              {
                id: newId(),
                name: "School nights",
                days: [0, 1, 2, 3, 4],
                from: "21:00",
                to: "07:00",
                mode: "paused",
              },
            ])
          }
        >
          <Plus className="size-4" /> School-night bedtime
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange([
              ...value,
              {
                id: newId(),
                name: "Weekend",
                days: [0, 6],
                from: "09:00",
                to: "20:00",
                mode: "open",
              },
            ])
          }
        >
          <Plus className="size-4" /> Open weekends
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            onChange([
              ...value,
              { id: newId(), days: [1, 2, 3, 4, 5], from: "15:00", to: "17:00", mode: "sites" },
            ])
          }
        >
          <Plus className="size-4" /> Another time
        </Button>
      </div>
    </div>
  );
}

function CheckSite({ person }: { person: string }) {
  const [site, setSite] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ device?: string; blocked: boolean; rule?: string }>(
        `/api/family/${person}/check`,
        { site: site.trim().toLowerCase() },
      );
      setResult(
        `${r.blocked ? "Blocked" : "Allowed"} on ${r.device}${r.rule ? ` (rule: ${r.rule})` : ""}.`,
      );
    } catch (err) {
      setResult((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={check} className="grid gap-2 border-t border-line pt-4">
      <span className="text-[14px] font-semibold">Try a site</span>
      <p className="text-[12.5px] text-muted">
        Asks AdGuard Home what it would do with a site for one of their devices, right now.
      </p>
      <div className="flex gap-2">
        <Input
          aria-label="A site to try"
          placeholder="youtube.com"
          value={site}
          onChange={(e) => setSite(e.target.value)}
        />
        <Button type="submit" variant="secondary" busy={busy} disabled={!site.trim()}>
          <Search className="size-4" /> Try
        </Button>
      </div>
      {result ? <p className="text-[13px]">{result}</p> : null}
    </form>
  );
}

const GROUPS: Record<string, string> = {
  social_network: "Social",
  messenger: "Chat",
  gaming: "Games",
  streaming: "Video and music",
  ai: "AI chat",
  dating: "Dating",
  gambling: "Gambling",
  shopping: "Shopping",
  privacy: "Privacy and VPNs",
  hosting: "Hosting",
  software: "Software",
  cdn: "Networks",
  other: "Other",
};
/** The groups worth offering first. */
const FIRST = ["social_network", "gaming", "streaming", "messenger", "ai", "dating", "gambling"];

/** Apps and services blocked whatever the mode, from AdGuard Home's own list. */
function ServicePicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = useQuery({
    queryKey: ["family", "services"],
    queryFn: () => api.get<{ services: ServiceInfo[] }>("/api/family/services"),
    staleTime: 3600_000,
    enabled: open || value.length > 0,
  });
  const all = q.data?.services ?? [];
  const byId = useMemo(() => new Map(all.map((s) => [s.id, s])), [all]);
  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id].sort());
  const groups = useMemo(() => {
    const words = query.trim().toLowerCase();
    const shown = all.filter((s) => !words || s.name.toLowerCase().includes(words));
    const ids = [...new Set(shown.map((s) => s.group))].sort(
      (a, b) => (FIRST.indexOf(a) + 1 || 99) - (FIRST.indexOf(b) + 1 || 99) || a.localeCompare(b),
    );
    return ids.map((g) => ({ id: g, items: shown.filter((s) => s.group === g) }));
  }, [all, query]);
  return (
    <div className="grid gap-2">
      <span className="text-[14px] font-semibold">Blocked apps and services</span>
      <p className="text-[12.5px] text-muted">
        Blocked even on the whole internet: TikTok, Roblox, Discord and the like.
      </p>
      {value.length ? (
        <Chips
          items={value.map((id) => byId.get(id)?.name ?? id)}
          empty=""
          onRemove={(name) => {
            const id = value.find((x) => (byId.get(x)?.name ?? x) === name);
            if (id) toggle(id);
          }}
        />
      ) : null}
      {open ? (
        <div className="grid gap-3 rounded-xl border border-line p-3">
          <Input
            aria-label="Find an app or service"
            placeholder="Find one: tiktok, roblox, discord…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {q.error ? (
            <p className="text-[13px] text-bad">{(q.error as Error).message}</p>
          ) : !q.data ? (
            <div className="skeleton h-24" />
          ) : (
            <div className="grid max-h-80 gap-3 overflow-y-auto pr-1">
              {groups.map((g) => (
                <div key={g.id} className="grid gap-1.5">
                  <span className="text-[12px] font-bold tracking-wide text-muted uppercase">
                    {GROUPS[g.id] ?? g.id}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((s) => {
                      const on = value.includes(s.id);
                      return (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggle(s.id)}
                          className={cx(
                            "rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition",
                            on
                              ? "border-bad bg-bad/10 text-bad"
                              : "border-line text-muted hover:border-accent hover:text-ink",
                          )}
                        >
                          {on ? "Blocked: " : ""}
                          {s.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="justify-self-start"
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-4" /> Choose apps and services
        </Button>
      )}
    </div>
  );
}
