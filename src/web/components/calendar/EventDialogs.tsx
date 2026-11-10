/**
 * An event: looking at it, and making or changing it. Times are set in this device's zone; a
 * repeating event keeps its time of day there.
 */
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, Lock, MapPin, Pencil, Repeat, Trash2, Users } from "lucide-react";
import { useState } from "react";
import type { PublicProfile } from "../../../shared/api";
import type {
  CalEvent,
  CalendarInfo,
  EventInput,
  Repeat as RepeatKind,
} from "../../../shared/calendar";
import { api, local } from "../../lib/api";
import {
  addDays,
  calendarKey,
  dayKey,
  localZone,
  parseWhen,
  timeKey,
  whenText,
} from "../../lib/calendar";
import { cx } from "../../lib/format";
import { Avatar } from "../Picker";
import { Button, ErrorNote, Field, Input, Modal, Segmented, Select, Toggle, useToast } from "../ui";

const REPEAT_WORDS: Record<RepeatKind, string> = {
  daily: "Every day",
  weekly: "Every week",
  monthly: "Every month",
  yearly: "Every year",
};

/** Pick people from the family: their avatars, pressed or not. */
export function PeopleChips({
  people,
  value,
  onChange,
  label,
}: {
  people: PublicProfile[];
  value: string[];
  onChange: (v: string[]) => void;
  label: string;
}) {
  if (!people.length) return null;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons with a label
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {people.map((p) => {
        const on = value.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])}
            className={cx(
              "flex h-8 items-center gap-1.5 rounded-full border pr-3 pl-1 text-[13px] font-semibold transition",
              on ? "border-accent bg-accent/15" : "border-line text-muted hover:text-ink",
            )}
          >
            <Avatar p={p} size="xs" /> {p.name}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Looking at one

export function EventDetails({
  event,
  calendar,
  owner,
  people,
  me,
  onEdit,
  onClose,
}: {
  event: CalEvent;
  calendar?: CalendarInfo;
  owner?: PublicProfile;
  people: PublicProfile[];
  me: string;
  onEdit: () => void;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false);
  const tagged = people.filter((p) => event.people.includes(p.id) && p.id !== me);
  const remove = async (scope: "one" | "all") => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/calendar/events/delete", {
        calendar: event.source,
        ref: event.ref,
        instance: event.instance,
        etag: event.etag,
        scope,
      });
      toast(scope === "one" ? "That time is deleted" : "Event deleted");
      await qc.invalidateQueries({ queryKey: calendarKey });
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  // One time of a repeating CalDAV event can't be taken out from here.
  const canOne = event.repeating && calendar?.kind !== "caldav";
  return (
    <Modal open onClose={onClose} title={event.title}>
      <div className="grid gap-3 text-[14px]">
        <p className="flex items-start gap-2.5">
          <Clock className="mt-0.5 size-4 flex-none text-muted" />
          <span>
            {whenText(event)}
            {event.repeating ? (
              <span className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted">
                <Repeat className="size-3.5" />
                {event.repeat ? REPEAT_WORDS[event.repeat] : "Repeats"}
              </span>
            ) : null}
          </span>
        </p>
        <p className="flex items-center gap-2.5">
          <span
            className="ml-1 size-2.5 flex-none rounded-full"
            style={{ background: calendar?.color ?? "var(--c-muted)" }}
          />
          <span>
            {calendar?.name ?? "A calendar"}
            {owner && !calendar?.mine ? (
              <span className="text-muted"> · {owner.name}'s</span>
            ) : null}
          </span>
        </p>
        {event.location ? (
          <p className="flex items-start gap-2.5">
            <MapPin className="mt-0.5 size-4 flex-none text-muted" /> {event.location}
          </p>
        ) : null}
        {event.notes ? (
          <p className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13.5px] whitespace-pre-wrap">
            {event.notes}
          </p>
        ) : null}
        {tagged.length ? (
          <div className="flex items-center gap-2.5">
            <Users className="size-4 flex-none text-muted" />
            <span className="flex flex-wrap gap-1.5">
              {tagged.map((p) => (
                <span key={p.id} className="flex items-center gap-1 text-[13px] font-semibold">
                  <Avatar p={p} size="xs" /> {p.name}
                </span>
              ))}
            </span>
          </div>
        ) : null}
        {!event.canEdit ? (
          <p className="flex items-center gap-2 text-[12.5px] text-muted">
            <Lock className="size-3.5 flex-none" />
            {event.readOnlyReason ??
              (owner && !calendar?.mine
                ? `${owner.name} shared this with you to see.`
                : "This calendar can't be changed from Hearth.")}
          </p>
        ) : null}
        <ErrorNote error={error} />
        {event.canEdit ? (
          confirm ? (
            <div className="grid gap-2 rounded-xl border border-bad/40 p-3">
              <p className="font-semibold">
                {event.repeating ? "Delete which times?" : "Delete this event?"}
              </p>
              <div className="flex flex-wrap gap-2">
                {canOne ? (
                  <Button variant="danger" busy={busy} onClick={() => remove("one")}>
                    Just this time
                  </Button>
                ) : null}
                <Button variant="danger" busy={busy} onClick={() => remove("all")}>
                  {event.repeating ? "Every time" : "Delete"}
                </Button>
                <Button variant="ghost" onClick={() => setConfirm(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            // Edit comes first, so it's what has focus when the dialog opens.
            <div className="flex flex-row-reverse flex-wrap justify-start gap-2">
              <Button variant="primary" onClick={onEdit}>
                <Pencil className="size-4" /> Edit
              </Button>
              <Button variant="danger" onClick={() => setConfirm(true)}>
                <Trash2 className="size-4" /> Delete
              </Button>
            </div>
          )
        ) : null}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Making or changing one

interface Draft {
  title: string;
  allDay: boolean;
  startDay: string;
  startTime: string;
  endDay: string;
  endTime: string;
  repeat: RepeatKind | "";
  until: string;
  calendar: string;
  location: string;
  notes: string;
  people: string[];
}

function draftFrom(e: CalEvent): Draft {
  const s = parseWhen(e.start);
  const end = parseWhen(e.end);
  // An all-day event's last day is the day before its end.
  const last = e.allDay ? addDays(end, -1) : end;
  return {
    title: e.title,
    allDay: e.allDay,
    startDay: dayKey(s),
    startTime: e.allDay ? "09:00" : timeKey(s),
    endDay: dayKey(new Date(Math.max(last.getTime(), s.getTime()))),
    endTime: e.allDay ? "10:00" : timeKey(end),
    repeat: e.repeat ?? "",
    until: "",
    calendar: e.source,
    location: e.location ?? "",
    notes: e.notes ?? "",
    people: e.people,
  };
}

function draftNew(day: Date, hour: number | undefined, calendar: string): Draft {
  const h = hour ?? 9;
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h + 1);
  return {
    title: "",
    allDay: false,
    startDay: dayKey(day),
    startTime: `${String(h).padStart(2, "0")}:00`,
    endDay: dayKey(end),
    endTime: timeKey(end),
    repeat: "",
    until: "",
    calendar,
    location: "",
    notes: "",
    people: [],
  };
}

const at = (day: string, time: string) => new Date(`${day}T${time}`);

function toInput(d: Draft): EventInput {
  return {
    calendar: d.calendar,
    title: d.title.trim(),
    allDay: d.allDay,
    start: d.allDay ? d.startDay : at(d.startDay, d.startTime).toISOString(),
    end: d.allDay ? dayKey(addDays(parseWhen(d.endDay), 1)) : at(d.endDay, d.endTime).toISOString(),
    timeZone: localZone(),
    location: d.location.trim() || undefined,
    notes: d.notes.trim() || undefined,
    repeat: d.repeat || undefined,
    until: d.repeat && d.until ? d.until : undefined,
    people: d.people,
  };
}

export function EventEditor({
  event,
  start,
  calendars,
  defaultCalendar,
  people,
  me,
  onClose,
}: {
  /** Changing this one; or a new one starting at `start`. */
  event?: CalEvent;
  start?: { day: Date; hour?: number };
  calendars: CalendarInfo[];
  defaultCalendar?: string;
  people: PublicProfile[];
  me: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const writable = calendars.filter((c) => c.canWrite);
  const first =
    defaultCalendar && writable.some((c) => c.id === defaultCalendar)
      ? defaultCalendar
      : (writable.find((c) => c.mine && c.kind === "hearth")?.id ?? writable[0]?.id ?? "");
  const [d, setD] = useState<Draft>(() =>
    event ? draftFrom(event) : draftNew(start?.day ?? new Date(), start?.hour, first),
  );
  const [scope, setScope] = useState<"one" | "all">("all");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const cal = writable.find((c) => c.id === d.calendar);
  const kind = cal?.kind;
  // Google changes one time of a repeating event at a time from here; Hearth can do either.
  const askScope = event?.repeating && kind === "hearth";
  const oneOnly = event?.repeating && kind === "google";

  /** Moving the start keeps the length; moving the end before the start moves it along. */
  const moveStart = (day: string, time: string) => {
    const was = at(d.startDay, d.startTime).getTime();
    const len = Math.max(at(d.endDay, d.endTime).getTime() - was, d.allDay ? 0 : 30 * 60_000);
    const next = at(day, time);
    const end = new Date(next.getTime() + len);
    setD((x) => ({
      ...x,
      startDay: day,
      startTime: time,
      endDay: dayKey(end),
      endTime: timeKey(end),
    }));
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!d.title.trim()) {
      setError(new Error("Give it a name."));
      return;
    }
    const input = toInput(d);
    if (new Date(input.end).getTime() <= new Date(input.start).getTime() && !d.allDay) {
      setError(new Error("It has to end after it starts."));
      return;
    }
    setBusy(true);
    try {
      if (event)
        await api.put("/api/calendar/events", {
          at: {
            calendar: event.source,
            ref: event.ref,
            instance: event.instance,
            etag: event.etag,
            scope: oneOnly ? "one" : askScope ? scope : "all",
          },
          event: askScope && scope === "one" ? { ...input, repeat: undefined } : input,
        });
      else await api.post("/api/calendar/events", input);
      local.set("hearth:calendar-last", d.calendar);
      toast(event ? "Saved" : "Added to the calendar");
      await qc.invalidateQueries({ queryKey: calendarKey });
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  if (!writable.length)
    return (
      <Modal open onClose={onClose} title="New event">
        <p className="text-muted">There's no calendar here you can add to.</p>
      </Modal>
    );

  const others = people.filter((p) => p.id !== me);
  return (
    <Modal
      open
      onClose={onClose}
      title={event ? "Change the event" : "New event"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="event-form" busy={busy}>
            {event ? "Save" : "Add"}
          </Button>
        </>
      }
    >
      <form id="event-form" onSubmit={save} className="grid gap-3.5">
        <Field label="What">
          {(id) => (
            <Input
              id={id}
              value={d.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Dentist, Ava's party, bins out"
              maxLength={200}
              required
            />
          )}
        </Field>
        <Toggle label="All day" checked={d.allDay} onChange={(v) => set("allDay", v)} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <Field label="Starts">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={d.startDay}
                onChange={(e) => e.target.value && moveStart(e.target.value, d.startTime)}
                required
              />
            )}
          </Field>
          {!d.allDay ? (
            <Field label="At">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  value={d.startTime}
                  onChange={(e) => e.target.value && moveStart(d.startDay, e.target.value)}
                  required
                />
              )}
            </Field>
          ) : null}
          <Field label={d.allDay ? "Last day" : "Ends"}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={d.endDay}
                min={d.startDay}
                onChange={(e) => e.target.value && set("endDay", e.target.value)}
                required
              />
            )}
          </Field>
          {!d.allDay ? (
            <Field label="At">
              {(id) => (
                <Input
                  id={id}
                  type="time"
                  value={d.endTime}
                  onChange={(e) => e.target.value && set("endTime", e.target.value)}
                  required
                />
              )}
            </Field>
          ) : null}
        </div>
        {!(event?.repeating && scope === "one") && !oneOnly ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="Repeats">
              {(id) => (
                <Select
                  id={id}
                  value={d.repeat}
                  onChange={(e) => set("repeat", e.target.value as RepeatKind | "")}
                >
                  <option value="">Doesn't repeat</option>
                  {(Object.keys(REPEAT_WORDS) as RepeatKind[]).map((r) => (
                    <option key={r} value={r}>
                      {REPEAT_WORDS[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {d.repeat ? (
              <Field label="Until" hint="Leave empty to keep going">
                {(id) => (
                  <Input
                    id={id}
                    type="date"
                    value={d.until}
                    min={d.startDay}
                    onChange={(e) => set("until", e.target.value)}
                  />
                )}
              </Field>
            ) : null}
          </div>
        ) : null}
        {askScope ? (
          <Field label="Change">
            {() => (
              <Segmented
                label="Which times to change"
                value={scope}
                onChange={setScope}
                options={[
                  { value: "one", label: "Just this time" },
                  { value: "all", label: "Every time" },
                ]}
              />
            )}
          </Field>
        ) : null}
        {oneOnly ? (
          <p className="text-[12.5px] text-muted">
            This changes just this time. Change every time in Google Calendar.
          </p>
        ) : null}
        <Field label="Calendar">
          {(id) => (
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-3 flex-none rounded-full"
                style={{ background: cal?.color }}
              />
              <Select
                id={id}
                value={d.calendar}
                onChange={(e) => set("calendar", e.target.value)}
                className="grow"
              >
                {writable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.account ? ` (${c.account.name})` : c.mine ? "" : " (shared)"}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </Field>
        <Field label="Where" hint="Optional">
          {(id) => (
            <Input
              id={id}
              value={d.location}
              onChange={(e) => set("location", e.target.value)}
              maxLength={300}
            />
          )}
        </Field>
        <Field label="Notes" hint="Optional">
          {(id) => (
            <textarea
              id={id}
              rows={2}
              value={d.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={4000}
              className="min-h-16 w-full rounded-xl border border-line bg-(--c-background) px-3 py-2 text-[14px] text-ink focus:border-accent focus:ring-4 focus:ring-(--c-accent-soft) focus:outline-none"
            />
          )}
        </Field>
        {others.length ? (
          <div className="grid gap-1.5">
            <p className="text-[13px] font-semibold">Share with</p>
            <PeopleChips
              label="Share with"
              people={others}
              value={d.people}
              onChange={(v) => set("people", v)}
            />
            <p className="text-[12px] text-muted">
              They'll see it on their calendar, even if this calendar isn't shared with them.
            </p>
          </div>
        ) : null}
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}

/** Everything on one day, from the month's "more". */
export function DayList({
  title,
  events,
  colorOf,
  onOpen,
  onNew,
  onClose,
}: {
  title: string;
  events: CalEvent[];
  colorOf: (e: CalEvent) => string;
  onOpen: (e: CalEvent) => void;
  onNew?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal open onClose={onClose} title={title}>
      <ul className="grid gap-1">
        {events.map((e) => (
          <li key={e.key}>
            <button
              type="button"
              onClick={() => onOpen(e)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left hover:bg-(--c-surface-2)"
            >
              <span
                className="size-2.5 flex-none rounded-full"
                style={{ background: colorOf(e) }}
              />
              <span className="grow truncate font-semibold">{e.title}</span>
              <span className="flex-none text-[12.5px] text-muted">
                {whenText(e).split(", ").pop()}
              </span>
            </button>
          </li>
        ))}
        {!events.length ? <li className="text-muted">Nothing on.</li> : null}
      </ul>
      {onNew ? (
        <Button className="mt-3 w-full" onClick={onNew}>
          <CalendarDays className="size-4" /> Add something this day
        </Button>
      ) : null}
    </Modal>
  );
}
