/**
 * A person's calendars: the list beside the calendar (on or off, settings), adding one (Hearth's
 * own, Google, CalDAV, a calendar link), and each one's settings (name, colour, who it's shared
 * with). Passwords and links go to Hearth and stay there; the page never gets them back.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  Link2,
  Plus,
  Server,
  Settings2,
  TriangleAlert,
  Unplug,
} from "lucide-react";
import { useState } from "react";
import type { PublicProfile } from "../../../shared/api";
import {
  type AccountInfo,
  CAL_COLORS,
  type CalendarInfo,
  type CalendarView,
  type RemoteCalendar,
} from "../../../shared/calendar";
import { api } from "../../lib/api";
import { calendarKey } from "../../lib/calendar";
import { cx } from "../../lib/format";
import { Avatar } from "../Picker";
import {
  Button,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Toggle,
  useToast,
} from "../ui";
import { PeopleChips } from "./EventDialogs";

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: calendarKey });
}

const KIND_WORDS: Record<CalendarInfo["kind"], string> = {
  hearth: "Hearth",
  ics: "Link",
  caldav: "CalDAV",
  google: "Google",
  tagged: "Tagged",
};

// ---------------------------------------------------------------------------
// The list

export function CalendarList({
  view,
  people,
  onSettings,
  onAdd,
}: {
  view: CalendarView;
  people: PublicProfile[];
  onSettings: (c: CalendarInfo) => void;
  onAdd: () => void;
}) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const byId = new Map(people.map((p) => [p.id, p]));
  const toggle = async (c: CalendarInfo) => {
    const off = view.calendars.filter((x) => (x.id === c.id ? x.on : !x.on)).map((x) => x.id);
    try {
      await api.put("/api/calendar/off", { off });
    } catch (e) {
      toast((e as Error).message, "bad");
    }
    await invalidate();
  };
  const groups: [string, CalendarInfo[]][] = [
    ["Your calendars", view.calendars.filter((c) => c.mine)],
    ["Shared with you", view.calendars.filter((c) => !c.mine && c.kind !== "tagged")],
    ["Events you're tagged on", view.calendars.filter((c) => c.kind === "tagged")],
  ];
  return (
    <div className="grid gap-4">
      {groups.map(([title, list]) =>
        list.length ? (
          <section key={title} className="grid gap-0.5">
            <h3 className="px-1 pb-1 text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted">
              {title}
            </h3>
            {list.map((c) => {
              const owner = byId.get(c.owner);
              return (
                <div
                  key={c.id}
                  className="group flex min-h-9 items-center gap-2 rounded-xl px-1 hover:bg-(--c-surface-2)"
                >
                  <button
                    type="button"
                    aria-pressed={c.on}
                    aria-label={`Show ${c.name}`}
                    onClick={() => toggle(c)}
                    className="grid size-5 flex-none place-items-center rounded-md border-2 transition"
                    style={{
                      borderColor: c.color,
                      background: c.on ? c.color : "transparent",
                    }}
                  >
                    {c.on ? <Check className="size-3.5 text-white" strokeWidth={3} /> : null}
                  </button>
                  <span className="grid min-w-0 grow leading-tight">
                    <span
                      className={cx("truncate text-[14px] font-semibold", !c.on && "text-muted")}
                    >
                      {c.name}
                    </span>
                    <span className="truncate text-[11.5px] text-muted">
                      {c.mine
                        ? [
                            c.account?.name ?? KIND_WORDS[c.kind],
                            c.shareWith?.length ? `shared with ${c.shareWith.length}` : "",
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : c.kind === "tagged"
                          ? "Only what you're tagged on"
                          : owner
                            ? `Shared by ${owner.name}${c.canWrite ? ", you can add" : ""}`
                            : ""}
                    </span>
                  </span>
                  {c.error ? (
                    <span title={c.error} className="flex-none text-warn">
                      <TriangleAlert className="size-4" aria-label={c.error} />
                    </span>
                  ) : null}
                  {!c.mine && owner ? <Avatar p={owner} size="xs" /> : null}
                  {c.mine ? (
                    <IconButton
                      label={`${c.name}: name, colour, sharing`}
                      className="size-7 opacity-60 group-hover:opacity-100"
                      onClick={() => onSettings(c)}
                    >
                      <Settings2 className="size-3.5" />
                    </IconButton>
                  ) : null}
                </div>
              );
            })}
          </section>
        ) : null,
      )}
      {!view.locked ? (
        <Button onClick={onAdd} className="w-full">
          <Plus className="size-4" /> Add a calendar
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colours

function Colors({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
      {CAL_COLORS.map((c) => (
        // biome-ignore lint/a11y/useSemanticElements: a swatch in a labelled radio group
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value.toLowerCase() === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={cx(
            "grid size-8 place-items-center rounded-full transition",
            value.toLowerCase() === c && "ring-2 ring-ink ring-offset-2 ring-offset-surface",
          )}
          style={{ background: c }}
        >
          {value.toLowerCase() === c ? (
            <Check className="size-4 text-white" strokeWidth={3} />
          ) : null}
        </button>
      ))}
      <label className="relative grid size-8 cursor-pointer place-items-center overflow-hidden rounded-full border border-line text-[11px] font-bold text-muted">
        <span>+</span>
        <input
          type="color"
          aria-label="Another colour"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One calendar's settings

export function CalendarSettings({
  calendar,
  people,
  me,
  onClose,
}: {
  calendar: CalendarInfo;
  people: PublicProfile[];
  me: string;
  onClose: () => void;
}) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState(calendar.name);
  const [color, setColor] = useState(calendar.color);
  const [shareWith, setShareWith] = useState(calendar.shareWith ?? []);
  const [shareEdit, setShareEdit] = useState(calendar.shareEdit ?? false);
  const [refresh, setRefresh] = useState(calendar.refreshMinutes ?? 15);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const fromElsewhere = calendar.kind !== "hearth";

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/api/calendar/calendars/${calendar.id}`, {
        name: name.trim(),
        color,
        shareWith,
        shareEdit,
        ...(fromElsewhere ? { refreshMinutes: refresh } : {}),
        ...(url.trim() ? { url: url.trim() } : {}),
      });
      toast("Saved");
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/calendar/calendars/${calendar.id}`);
      toast(`${calendar.name} is gone`);
      await invalidate();
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={calendar.name}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <p className="text-[13px] text-muted">
          {calendar.account
            ? `From ${calendar.account.name} (${KIND_WORDS[calendar.kind]}).`
            : calendar.kind === "ics"
              ? "From a calendar link: it can be read, not changed."
              : "Kept in Hearth."}
        </p>
        <Field label="Name">
          {(id) => (
            <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <div className="grid gap-1.5">
          <p className="text-[13px] font-semibold">Colour</p>
          <Colors value={color} onChange={setColor} />
        </div>
        <div className="grid gap-1.5">
          <p className="text-[13px] font-semibold">Share with</p>
          <PeopleChips
            label="Share with"
            people={people.filter((p) => p.id !== me)}
            value={shareWith}
            onChange={setShareWith}
          />
          <p className="text-[12px] text-muted">
            They see its events on their calendar, and can turn it off there.
          </p>
        </div>
        {shareWith.length && !calendar.readOnly ? (
          <Toggle
            label="They can add and change events"
            hint="Good for a family calendar."
            checked={shareEdit}
            onChange={setShareEdit}
          />
        ) : null}
        {fromElsewhere ? (
          <Field label="Look for changes every">
            {(id) => (
              <Select id={id} value={refresh} onChange={(e) => setRefresh(Number(e.target.value))}>
                {[5, 15, 30, 60, 240, 1440].map((m) => (
                  <option key={m} value={m}>
                    {m < 60
                      ? `${m} minutes`
                      : m === 60
                        ? "hour"
                        : m === 1440
                          ? "day"
                          : `${m / 60} hours`}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        {calendar.kind === "ics" ? (
          <Field label="A new address" hint="Only if the link changed. The old one isn't shown.">
            {(id) => (
              <Input
                id={id}
                value={url}
                placeholder="https://…/basic.ics"
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <ErrorNote error={error} />
        <div className="border-t border-line pt-3">
          {confirm ? (
            <div className="grid gap-2">
              <p className="text-[13.5px]">
                {calendar.kind === "hearth"
                  ? "Delete this calendar and every event in it? This can't be undone."
                  : "Take this calendar off Hearth? Its events stay where they are."}
              </p>
              <div className="flex gap-2">
                <Button variant="danger" busy={busy} onClick={remove}>
                  {calendar.kind === "hearth" ? "Delete it" : "Take it off"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="danger" onClick={() => setConfirm(true)}>
              {calendar.kind === "hearth" ? "Delete this calendar" : "Take it off Hearth"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Adding one

type Step =
  | { kind: "menu" }
  | { kind: "hearth" }
  | { kind: "link" }
  | { kind: "caldav" }
  | { kind: "google" }
  | { kind: "pick"; account: AccountInfo; calendars: RemoteCalendar[] };

/** An account just connected (Google's sign-in came back): pick its calendars. */
export interface Found {
  account: AccountInfo;
  calendars: RemoteCalendar[];
}

export function AddCalendar({
  view,
  people,
  found,
  onClose,
}: {
  view: CalendarView;
  people: PublicProfile[];
  found?: Found;
  onClose: () => void;
}) {
  const [step, setStep] = useState<Step>(found ? { kind: "pick", ...found } : { kind: "menu" });
  const back = () => setStep({ kind: "menu" });
  const title =
    step.kind === "menu"
      ? "Add a calendar"
      : step.kind === "hearth"
        ? "A new calendar"
        : step.kind === "link"
          ? "A calendar link"
          : step.kind === "caldav"
            ? "A CalDAV account"
            : step.kind === "google"
              ? "Google Calendar"
              : "Which calendars?";
  return (
    <Modal open onClose={onClose} title={title}>
      {step.kind !== "menu" ? (
        <button
          type="button"
          onClick={back}
          className="mb-3 flex items-center gap-1 text-[13px] font-semibold text-muted hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Back
        </button>
      ) : null}
      {step.kind === "menu" ? (
        <Menu view={view} go={setStep} />
      ) : step.kind === "hearth" ? (
        <NewHearth people={people} me={view.me} onDone={onClose} />
      ) : step.kind === "link" ? (
        <NewLink internet={view.internet} onDone={onClose} />
      ) : step.kind === "caldav" ? (
        <NewCalDav
          onFound={(account, calendars) => setStep({ kind: "pick", account, calendars })}
        />
      ) : step.kind === "google" ? (
        <NewGoogle
          returns={view.googleReturns}
          onFound={(account, calendars) => setStep({ kind: "pick", account, calendars })}
        />
      ) : (
        <Pick account={step.account} calendars={step.calendars} onDone={onClose} />
      )}
    </Modal>
  );
}

function Option({
  icon,
  title,
  text,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  text: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="card flex w-full items-start gap-3 px-4 py-3 text-left transition hover:border-accent disabled:opacity-60 disabled:hover:border-line"
    >
      <span className="mt-0.5 grid size-9 flex-none place-items-center rounded-xl bg-accent/12 text-accent">
        {icon}
      </span>
      <span className="grid gap-0.5">
        <span className="font-semibold">{title}</span>
        <span className="text-[12.5px] text-muted">{text}</span>
      </span>
    </button>
  );
}

function Menu({ view, go }: { view: CalendarView; go: (s: Step) => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [more, setMore] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const googleReady = view.google && view.internet;
  const fromAccount = async (a: AccountInfo) => {
    setMore(a.id);
    setError(null);
    try {
      const r = await api.get<{ calendars: RemoteCalendar[] }>(
        `/api/calendar/accounts/${a.id}/calendars`,
      );
      go({ kind: "pick", account: a, calendars: r.calendars });
    } catch (e) {
      setError(e);
    }
    setMore(null);
  };
  const disconnect = async (a: AccountInfo) => {
    if (
      !window.confirm(
        `Disconnect ${a.name}? Its calendars come off Hearth; nothing is deleted there.`,
      )
    )
      return;
    try {
      await api.del(`/api/calendar/accounts/${a.id}`);
      toast(`${a.name} is disconnected`);
      await invalidate();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <div className="grid gap-2.5">
      <Option
        icon={<CalendarDays className="size-5" />}
        title="A new calendar in Hearth"
        text="For the family, a club, the bins. Share it with anyone in the house."
        onClick={() => go({ kind: "hearth" })}
      />
      <Option
        icon={<span className="text-[15px] font-black">G</span>}
        title="Google Calendar"
        text={
          googleReady
            ? "Sign in with Google: see your calendars here and add events to them."
            : !view.google
              ? "The admin needs to set up Google first (Settings → Calendars)."
              : "The admin needs to let calendars reach the internet (Settings → Calendars)."
        }
        onClick={() => go({ kind: "google" })}
        disabled={!googleReady}
      />
      <Option
        icon={<Server className="size-5" />}
        title="A CalDAV account"
        text="Synology Calendar, iCloud, Nextcloud, Fastmail and others. Two-way."
        onClick={() => go({ kind: "caldav" })}
      />
      <Option
        icon={<Link2 className="size-5" />}
        title="A calendar link"
        text="An address ending in .ics: a school's, a team's, holidays, or Google's secret address. Read only."
        onClick={() => go({ kind: "link" })}
      />
      {view.accounts.length ? (
        <section className="mt-2 grid gap-1">
          <h3 className="text-[11.5px] font-bold uppercase tracking-[0.09em] text-muted">
            Your accounts
          </h3>
          {view.accounts.map((a) => (
            <div key={a.id} className="flex items-center gap-2 rounded-xl px-1 py-1">
              <span className="grid min-w-0 grow leading-tight">
                <span className="truncate text-[14px] font-semibold">{a.name}</span>
                <span className="text-[11.5px] text-muted">
                  {a.kind === "google" ? "Google" : "CalDAV"}
                </span>
              </span>
              <Button size="sm" busy={more === a.id} onClick={() => fromAccount(a)}>
                More calendars
              </Button>
              <IconButton
                label={`Disconnect ${a.name}`}
                className="size-8"
                onClick={() => disconnect(a)}
              >
                <Unplug className="size-4" />
              </IconButton>
            </div>
          ))}
        </section>
      ) : null}
      <ErrorNote error={error} />
    </div>
  );
}

function NewHearth({
  people,
  me,
  onDone,
}: {
  people: PublicProfile[];
  me: string;
  onDone: () => void;
}) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CAL_COLORS[1]);
  const [shareWith, setShareWith] = useState<string[]>([]);
  const [shareEdit, setShareEdit] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const others = people.filter((p) => p.id !== me);
  const make = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/calendar/calendars", {
        kind: "hearth",
        name: name.trim(),
        color,
        shareWith,
        shareEdit,
      });
      toast(`${name.trim()} is made`);
      await invalidate();
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={make} className="grid gap-4">
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={name}
            maxLength={60}
            required
            placeholder="Family, Football, Bins"
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-1.5">
        <p className="text-[13px] font-semibold">Colour</p>
        <Colors value={color} onChange={setColor} />
      </div>
      {others.length ? (
        <div className="grid gap-1.5">
          <p className="text-[13px] font-semibold">Share with</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <PeopleChips
              label="Share with"
              people={others}
              value={shareWith}
              onChange={setShareWith}
            />
            <button
              type="button"
              className="text-[12.5px] font-semibold text-accent"
              onClick={() => setShareWith(others.map((p) => p.id))}
            >
              Everyone
            </button>
          </div>
        </div>
      ) : null}
      {shareWith.length ? (
        <Toggle
          label="They can add and change events"
          checked={shareEdit}
          onChange={setShareEdit}
        />
      ) : null}
      <ErrorNote error={error} />
      <Button type="submit" variant="primary" busy={busy}>
        Make it
      </Button>
    </form>
  );
}

function NewLink({ internet, onDone }: { internet: boolean; onDone: () => void }) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(CAL_COLORS[3]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/calendar/calendars", {
        kind: "ics",
        name: name.trim(),
        color,
        url: url.trim(),
      });
      toast(`${name.trim()} is on your calendar`);
      await invalidate();
      onDone();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={add} className="grid gap-4">
      <Field
        label="The calendar's address"
        hint={
          <>
            Google: open the calendar's settings and copy its "Secret address in iCal format". It's
            kept as a secret.
            {!internet ? " Addresses on the internet need the admin to allow it first." : ""}
          </>
        }
      >
        {(id) => (
          <Input
            id={id}
            value={url}
            required
            placeholder="https://…/basic.ics or webcal://…"
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Field>
      <Field label="Name">
        {(id) => (
          <Input
            id={id}
            value={name}
            required
            maxLength={60}
            placeholder="School, Holidays"
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-1.5">
        <p className="text-[13px] font-semibold">Colour</p>
        <Colors value={color} onChange={setColor} />
      </div>
      <ErrorNote error={error} />
      <Button type="submit" variant="primary" busy={busy}>
        Add it
      </Button>
    </form>
  );
}

const DAV_TIPS: { name: string; url: string; tip: string }[] = [
  {
    name: "Synology Calendar",
    url: "https://nas.home:5001/caldav/",
    tip: "Your DSM username and password. Calendar's own settings show the address.",
  },
  {
    name: "iCloud",
    url: "https://caldav.icloud.com/",
    tip: "Your Apple ID, with an app-specific password from appleid.apple.com.",
  },
  {
    name: "Nextcloud",
    url: "https://cloud.example.com/remote.php/dav/",
    tip: "Your username, and an app password from Settings → Security.",
  },
  {
    name: "Fastmail",
    url: "https://caldav.fastmail.com/",
    tip: "An app password from Settings → Privacy & Security.",
  },
];

function NewCalDav({
  onFound,
}: {
  onFound: (a: AccountInfo, calendars: RemoteCalendar[]) => void;
}) {
  const invalidate = useInvalidate();
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const tip = DAV_TIPS.find((t) => url && t.url.startsWith(url.split("/").slice(0, 3).join("/")));
  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ account: AccountInfo; calendars: RemoteCalendar[] }>(
        "/api/calendar/accounts/caldav",
        { url: url.trim(), username: username.trim(), password },
      );
      await invalidate();
      onFound(r.account, r.calendars);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={connect} className="grid gap-4" autoComplete="off">
      <div className="flex flex-wrap gap-1.5">
        {DAV_TIPS.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => setUrl(t.url)}
            className="h-7 rounded-full border border-line px-2.5 text-[12px] font-semibold text-muted hover:border-accent hover:text-ink"
          >
            {t.name}
          </button>
        ))}
      </div>
      <Field
        label="Server address"
        hint={tip?.tip ?? "The server's address is enough; Hearth finds your calendars."}
      >
        {(id) => (
          <Input
            id={id}
            value={url}
            required
            placeholder="https://nas.home:5001/caldav/"
            onChange={(e) => setUrl(e.target.value)}
          />
        )}
      </Field>
      <Field label="Username">
        {(id) => (
          <Input id={id} value={username} required onChange={(e) => setUsername(e.target.value)} />
        )}
      </Field>
      <Field label="Password" hint="Kept encrypted in Hearth, used only to reach this server.">
        {(id) => (
          <Input
            id={id}
            type="password"
            value={password}
            required
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      <ErrorNote error={error} />
      <Button type="submit" variant="primary" busy={busy}>
        Connect
      </Button>
    </form>
  );
}

function NewGoogle({
  returns,
  onFound,
}: {
  /** A return page is set up: Google sends this tab back to the Calendar page by itself. */
  returns: boolean;
  onFound: (a: AccountInfo, calendars: RemoteCalendar[]) => void;
}) {
  const invalidate = useInvalidate();
  const [started, setStarted] = useState(false);
  const [pasted, setPasted] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ url: string }>("/api/calendar/google/start");
      window.location.assign(r.url);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  if (returns)
    return (
      <div className="grid gap-4 text-[14px]">
        <p>
          Google asks you to sign in and to let Hearth see and add events, then brings you back here
          to pick which calendars to show.
        </p>
        <p className="text-[13px] text-muted">
          If Google says it hasn't verified the app: that's this house's own Hearth, so choose
          Advanced, then continue.
        </p>
        <ErrorNote error={error} />
        <Button variant="primary" busy={busy} onClick={go}>
          <ArrowUpRight className="size-4" /> Sign in with Google
        </Button>
      </div>
    );
  const start = async () => {
    setError(null);
    // Open the tab first, so the browser doesn't block it as a pop-up.
    const tab = window.open("about:blank", "_blank");
    try {
      const r = await api.post<{ url: string }>("/api/calendar/google/start");
      if (tab) {
        tab.opener = null;
        tab.location.href = r.url;
      } else window.location.assign(r.url);
      setStarted(true);
    } catch (e) {
      tab?.close();
      setError(e);
    }
  };
  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ account: AccountInfo; calendars: RemoteCalendar[] }>(
        "/api/calendar/google/finish",
        { pasted },
      );
      await invalidate();
      onFound(r.account, r.calendars);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 text-[14px]">
      <ol className="grid list-decimal gap-2 pl-5">
        <li>
          Sign in with Google in the new tab and allow Hearth to see and add events. Google may say
          it hasn't verified the app: that's this house's own Hearth, so choose Advanced, then
          continue.
        </li>
        <li>
          Google then sends you to a page that <b>doesn't open</b>, at 127.0.0.1. That's expected.
          Copy the whole address from that tab's address bar.
        </li>
        <li>Paste it here.</li>
      </ol>
      <Button variant={started ? "secondary" : "primary"} onClick={start}>
        <ArrowUpRight className="size-4" /> {started ? "Open Google again" : "Sign in with Google"}
      </Button>
      <form onSubmit={finish} className="grid gap-3">
        <Field label="The address Google sent you to">
          {(id) => (
            <Input
              id={id}
              value={pasted}
              required
              placeholder="http://127.0.0.1:53682/?state=…&code=…"
              onChange={(e) => setPasted(e.target.value)}
            />
          )}
        </Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" busy={busy} disabled={!pasted.trim()}>
          Connect
        </Button>
      </form>
    </div>
  );
}

function Pick({
  account,
  calendars,
  onDone,
}: {
  account: AccountInfo;
  calendars: RemoteCalendar[];
  onDone: () => void;
}) {
  const invalidate = useInvalidate();
  const toast = useToast();
  const fresh = calendars.filter((c) => !c.added);
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(fresh.filter((c) => !c.readOnly).map((c) => c.remote)),
  );
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/calendar/accounts/${account.id}/calendars`, {
        calendars: fresh
          .filter((c) => picked.has(c.remote))
          .map((c) => ({ remote: c.remote, name: c.name, color: c.color, readOnly: c.readOnly })),
      });
      toast(`Added from ${account.name}`);
      await invalidate();
      onDone();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-3">
      <p className="text-[13.5px] text-muted">
        {account.name}: tick the calendars to show in Hearth.
      </p>
      <ul className="grid gap-1">
        {calendars.map((c) => {
          const on = c.added || picked.has(c.remote);
          return (
            <li key={c.remote}>
              <label
                className={cx(
                  "flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-(--c-surface-2)",
                  c.added && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={c.added}
                  onChange={() =>
                    setPicked((s) => {
                      const n = new Set(s);
                      if (n.has(c.remote)) n.delete(c.remote);
                      else n.add(c.remote);
                      return n;
                    })
                  }
                  className="size-4 accent-(--c-accent)"
                />
                <span
                  className="size-3 flex-none rounded-full"
                  style={{ background: c.color?.slice(0, 7) ?? "var(--c-muted)" }}
                />
                <span className="grow truncate font-semibold">{c.name}</span>
                <span className="flex-none text-[12px] text-muted">
                  {c.added ? "Added" : c.readOnly ? "Read only" : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <ErrorNote error={error} />
      <Button variant="primary" busy={busy} disabled={!picked.size} onClick={add}>
        Add {picked.size || ""} {picked.size === 1 ? "calendar" : "calendars"}
      </Button>
    </div>
  );
}
