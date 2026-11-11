/**
 * On a device that follows someone's internet rules: a strip saying so, and "Grown-up? Unlock".
 * A grown-up picks their own face, types their own PIN, and the device's rules lift for a while.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hand, Lock, LockOpen, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import type { HereInternet, ModeNow } from "../../../shared/internet";
import { api } from "../../lib/api";
import { cx } from "../../lib/format";
import { live } from "../../lib/live";
import { useHome } from "../../lib/queries";
import { Avatar, PinPad } from "../Picker";
import { Button, ErrorNote, Field, Input, Modal, Segmented, useToast } from "../ui";

export const hereKey = ["internet-here"] as const;

const timeOf = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** "Only Ava's sites", "Paused until 4:30 PM", "Bedtime: paused until 07:00". */
export function modeText(now: ModeNow, name?: string): string {
  const what =
    now.mode === "paused"
      ? "Internet paused"
      : now.mode === "sites"
        ? `Only ${name ? `${name}'s` : "their"} sites`
        : "The whole internet";
  const until = now.until
    ? ` until ${timeOf(now.until)}`
    : now.untilTime
      ? ` until ${now.untilTime}`
      : "";
  return now.because === "schedule" && now.schedule
    ? `${now.schedule}: ${what.toLowerCase()}${until}`
    : `${what}${until}`;
}

export function useHere() {
  const qc = useQueryClient();
  useEffect(
    () =>
      live.changes((what) => {
        if (what === "internet" || what === "config")
          void qc.invalidateQueries({ queryKey: hereKey });
      }),
    [qc],
  );
  return useQuery({
    queryKey: hereKey,
    queryFn: () => api.get<HereInternet>("/api/internet/here"),
    refetchInterval: 60_000,
  });
}

export function HereBanner() {
  const q = useHere();
  const home = useHome();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const h = q.data;
  if (!h?.ruled || !h.now) return null;
  const person = home.data?.profiles.find((p) => p.id === h.person);
  const by = h.unlocked
    ? (home.data?.profiles.find((p) => p.id === h.unlocked?.by)?.name ?? "the admin")
    : null;
  const req = h.request;
  const answeredBy = req?.by
    ? (home.data?.profiles.find((p) => p.id === req.by)?.name ?? "A grown-up")
    : null;
  const what = req ? (req.kind === "time" ? `${req.minutes} more minutes` : req.site) : "";
  const lockNow = async () => {
    await api.post("/api/internet/lock", {});
    await qc.invalidateQueries({ queryKey: hereKey });
    toast("Locked again");
  };
  return (
    <div className="shell">
      <div
        className={cx(
          "mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-4 py-2.5 text-[13.5px]",
          h.unlocked ? "border-good/40 bg-good/10" : "border-line bg-surface",
        )}
      >
        {h.unlocked ? (
          <LockOpen className="size-4 flex-none text-good" />
        ) : (
          <ShieldCheck className="size-4 flex-none text-accent" />
        )}
        <span className="grow font-semibold">
          {h.unlocked
            ? `Unlocked by ${by} until ${timeOf(h.unlocked.until)}`
            : modeText(h.now, person?.name)}
        </span>
        {h.unlocked ? (
          <Button size="sm" variant="ghost" onClick={lockNow}>
            <Lock className="size-4" /> Lock again
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onClick={() => setAsking(true)}>
              <Hand className="size-4" /> Ask
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              <LockOpen className="size-4" /> Grown-up? Unlock
            </Button>
          </>
        )}
        {req ? (
          <span className="basis-full text-[12.5px] text-muted">
            {req.status === "pending"
              ? `You asked for ${what}. Waiting for a grown-up…`
              : req.status === "approved"
                ? `${answeredBy} said yes to ${what}.`
                : `${answeredBy} said not this time to ${what}.`}
          </span>
        ) : null}
      </div>
      {open ? <UnlockDialog here={h} onClose={() => setOpen(false)} /> : null}
      {asking ? <AskDialog here={h} onClose={() => setAsking(false)} /> : null}
    </div>
  );
}

const DURATIONS = [
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
  { value: 120, label: "2 hours" },
  { value: 240, label: "4 hours" },
];

function UnlockDialog({ here, onClose }: { here: HereInternet; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const home = useHome();
  const [minutes, setMinutes] = useState(60);
  const [who, setWho] = useState<HereInternet["grownUps"][number] | null>(null);
  const admin = home.data?.session.admin;
  const finish = async () => {
    await qc.invalidateQueries({ queryKey: hereKey });
    toast("Unlocked");
    onClose();
  };
  const unlock = (body: Record<string, unknown>) =>
    api.post("/api/internet/unlock", { minutes, ...body });

  if (who)
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Unlock this device"
        className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--c-background)_80%,transparent)] p-6 backdrop-blur-xl fade-in"
      >
        <PinPad
          profile={who}
          hint={`Your PIN, to unlock this device for ${DURATIONS.find((d) => d.value === minutes)?.label}`}
          action="Unlock"
          submit={(pin) => unlock({ profile: who.id, pin })}
          onBack={() => setWho(null)}
          onDone={finish}
        />
      </div>
    );

  return (
    <Modal open onClose={onClose} title="Unlock this device">
      <div className="grid gap-4">
        <p className="text-[13.5px] text-muted">
          Its rules lift for a while, on this device only, then come back by themselves.
        </p>
        <Segmented label="For how long" value={minutes} onChange={setMinutes} options={DURATIONS} />
        {here.grownUps.length ? (
          <div className="flex flex-wrap gap-3">
            {here.grownUps.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setWho(g)}
                className="card flex min-w-28 flex-col items-center gap-2 px-4 py-3 hover:border-accent"
              >
                <Avatar p={g} />
                <span className="text-[13.5px] font-semibold">{g.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13px]">
            A grown-up needs a PIN to unlock a device. The admin sets PINs in Settings → People.
          </p>
        )}
        {admin ? (
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await unlock({});
                await finish();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            Unlock as the admin
          </Button>
        ) : null}
      </div>
    </Modal>
  );
}

/** A child asks a grown-up: more time, or a site. It shows up on the Family page. */
function AskDialog({ here, onClose }: { here: HereInternet; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [kind, setKind] = useState<"time" | "site">(here.now?.mode === "sites" ? "site" : "time");
  const [minutes, setMinutes] = useState(30);
  const [site, setSite] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/internet/ask", {
        kind,
        ...(kind === "time" ? { minutes } : { site: site.trim() }),
        note: note.trim() || undefined,
      });
      await qc.invalidateQueries({ queryKey: hereKey });
      toast("Asked. A grown-up will see it on the Family page.");
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Ask a grown-up"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="ask-form"
            busy={busy}
            disabled={kind === "site" && !site.trim()}
          >
            Ask
          </Button>
        </>
      }
    >
      <form id="ask-form" onSubmit={send} className="grid gap-4">
        <Segmented
          label="Ask for"
          value={kind}
          onChange={setKind}
          options={[
            { value: "time", label: "More time" },
            { value: "site", label: "A site" },
          ]}
        />
        {kind === "time" ? (
          <Segmented
            label="How long"
            value={minutes}
            onChange={setMinutes}
            options={[
              { value: 15, label: "15 min" },
              { value: 30, label: "30 min" },
              { value: 60, label: "1 hour" },
            ]}
          />
        ) : (
          <Field label="Which site" hint="Its name, like coolmathgames.com, or paste its address.">
            {(id) => (
              <Input
                id={id}
                value={site}
                onChange={(e) => setSite(e.target.value)}
                placeholder="coolmathgames.com"
                autoFocus
              />
            )}
          </Field>
        )}
        <Field label="What's it for? (optional)">
          {(id) => (
            <Input
              id={id}
              value={note}
              maxLength={140}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Homework"
            />
          )}
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

/** For parents with Hearth open: a message when a child asks for something. */
export function FamilyAlerts({ pending }: { pending?: number }) {
  const toast = useToast();
  const [seen, setSeen] = useState(pending);
  useEffect(() => {
    if (pending === undefined) return;
    if (seen !== undefined && pending > seen)
      toast(
        pending - seen === 1
          ? "A child is asking you something (Family)"
          : `${pending - seen} new requests (Family)`,
      );
    setSeen(pending);
  }, [pending, seen, toast]);
  return null;
}
