/**
 * Settings → Internet: the house-wide part of the internet controls. On or off, how long
 * children's history is kept, and which adults are parents (they get the Family page). Each
 * child's rules, pauses, unlocks and history are on the Family page.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { InternetView } from "../../../shared/internet";
import { api } from "../../lib/api";
import { live } from "../../lib/live";
import { keys, useHome } from "../../lib/queries";
import { Avatar } from "../Picker";
import { Button, ErrorNote, Field, Input, Select, Toggle, useToast } from "../ui";
import { FrontDoorCard } from "./FrontDoorCard";
import { hereKey } from "./HereBanner";

const KEY = ["admin-internet"] as const;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function InternetPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const home = useHome();
  useEffect(
    () =>
      live.changes((what) => {
        if (what === "internet" || what === "config") void qc.invalidateQueries({ queryKey: KEY });
      }),
    [qc],
  );
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<InternetView>("/api/admin/internet"),
    refetchInterval: 20_000,
  });
  const put = async (body: Partial<InternetView>, done?: string) => {
    try {
      await api.put("/api/admin/internet", body);
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: hereKey });
      await qc.invalidateQueries({ queryKey: keys.home });
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  if (!q.data) return q.error ? <ErrorNote error={q.error} /> : <div className="skeleton h-64" />;
  const v = q.data;
  const adults = (home.data?.profiles ?? []).filter((p) => p.role === "adult");

  return (
    <div className="grid gap-5">
      <div className="card grid gap-4 p-5">
        <div>
          <h2 className="text-lg font-bold">Internet</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            Hearth writes AdGuard Home's rules for each child's devices: the whole internet, only
            the sites on their page, or nothing, by schedule. Each child is set up on the{" "}
            <Link to="/family" className="font-semibold text-accent hover:underline">
              Family page
            </Link>
            , where parents also see what was visited and blocked.
          </p>
        </div>
        <Toggle
          label="Internet controls are on"
          hint={
            v.enabled
              ? "Each child's rules apply to their devices now."
              : "Off: nothing is limited, and Hearth's rules are taken out of AdGuard Home. History is still kept."
          }
          checked={v.enabled}
          disabled={!v.adguard.configured}
          onChange={(on) =>
            put({ enabled: on }, on ? "Internet controls are on" : "Internet controls are off")
          }
        />
        <p className="text-[12.5px] text-muted">
          {!v.adguard.configured
            ? "Connect AdGuard Home first, in Devices → Setup."
            : v.adguard.error
              ? `AdGuard Home: ${v.adguard.error}`
              : v.applied
                ? `AdGuard Home has Hearth's rules: ${v.applied.lines ? `${v.applied.lines} lines` : "none needed right now"} (checked ${timeOf(v.applied.at)}).`
                : "Checking AdGuard Home…"}
        </p>
        {v.clientsError ? (
          <p className="rounded-xl bg-bad/10 px-3 py-2 text-[13px] text-bad">
            Safe search and blocked apps couldn't be saved in AdGuard Home: {v.clientsError}
          </p>
        ) : null}
        <div className="max-w-xs">
          <Field label="Keep children's history for">
            {(id) => (
              <Select
                id={id}
                value={v.historyDays}
                onChange={(e) => put({ historyDays: Number(e.target.value) })}
              >
                {[7, 14, 30, 60, 90].map((n) => (
                  <option key={n} value={n}>
                    {n} days
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Link
          to="/family"
          className="flex items-center gap-1.5 text-[14px] font-semibold text-accent hover:underline"
        >
          Open the Family page <ArrowRight className="size-4" />
        </Link>
      </div>

      <FrontDoorCard adguard={v.adguard.configured} />

      <Alerts v={v} put={put} />

      <div className="card grid gap-3 p-5">
        <div>
          <h2 className="text-lg font-bold">Parents</h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            Adults who get the Family page: they see what the children's devices visited, pause and
            unlock them, allow sites and change the children's rules. You always do. A parent needs
            a PIN (Settings → People); without one, anyone could pick their face.
          </p>
        </div>
        {adults.length ? (
          <ul className="grid gap-2">
            {adults.map((p) => {
              const on = v.parents.includes(p.id);
              return (
                <li key={p.id} className="flex items-center gap-3">
                  <Avatar p={p} size="xs" />
                  <div className="grow">
                    <Toggle
                      label={p.name}
                      hint={
                        on && !p.hasPin
                          ? "Needs a PIN before the Family page opens for them."
                          : undefined
                      }
                      checked={on}
                      onChange={(yes) =>
                        put(
                          {
                            parents: yes
                              ? [...v.parents, p.id]
                              : v.parents.filter((x) => x !== p.id),
                          },
                          yes ? `${p.name} is a parent here` : `${p.name} isn't a parent here`,
                        )
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No adults yet (Settings → People).</p>
        )}
      </div>
    </div>
  );
}

/** Where alerts go besides Hearth itself: a web address that takes a message (ntfy and others). */
function Alerts({
  v,
  put,
}: {
  v: InternetView;
  put: (body: Partial<InternetView>, done?: string) => Promise<void>;
}) {
  const toast = useToast();
  const [url, setUrl] = useState(v.notify.url ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setUrl(v.notify.url ?? ""), [v.notify.url]);
  const save = (e: React.FormEvent) => {
    e.preventDefault();
    void put(
      { notify: { url: url.trim() || undefined, blocked: v.notify.blocked } },
      url.trim() ? "Alerts will go there" : "Alerts only in Hearth",
    );
  };
  const test = async () => {
    setBusy(true);
    try {
      await api.post("/api/admin/internet/notify/test", {});
      toast("Sent a test alert");
    } catch (e) {
      toast((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="card grid gap-3 p-5">
      <div>
        <h2 className="text-lg font-bold">Alerts</h2>
        <p className="mt-0.5 text-[13.5px] text-muted">
          When a child asks for more time or a site, parents with Hearth open see it straight away,
          and the Family page shows how many are waiting. To get it on your phone too, give a web
          address that takes a message: an{" "}
          <a
            href="https://ntfy.sh"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-accent hover:underline"
          >
            ntfy
          </a>{" "}
          topic (its app pushes it to your phone), Home Assistant, Gotify and the like. Hearth sends
          only the alert: who asked, and for what.
        </p>
      </div>
      <form onSubmit={save} className="flex flex-wrap gap-2">
        <Input
          aria-label="Where to send alerts"
          placeholder="https://ntfy.sh/our-family-alerts"
          className="max-w-md"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Button type="submit" variant="secondary" disabled={url.trim() === (v.notify.url ?? "")}>
          Save
        </Button>
        <Button variant="ghost" busy={busy} disabled={!v.notify.url} onClick={test}>
          Send a test
        </Button>
      </form>
      {v.notify.error ? <p className="text-[13px] text-bad">Last alert: {v.notify.error}</p> : null}
      <Toggle
        label="Also when a child is blocked from a new site"
        hint="Once a day for each site, so you can allow it before they ask."
        checked={v.notify.blocked}
        disabled={!v.notify.url}
        onChange={(blocked) => put({ notify: { url: v.notify.url, blocked } })}
      />
      <p className="text-[12.5px] text-muted">
        A public ntfy topic can be read by anyone who guesses its name: pick a long, unguessable
        one, or run ntfy on your own network.
      </p>
    </div>
  );
}
