import { describe, expect, it } from "vitest";
import { eventIcs, occurrences, offsetAt, vtimezone, wallToUtc } from "./ics";

const cal = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");
const ev = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const range = (a: string, b: string) => [Date.parse(a), Date.parse(b)] as const;

describe("reading calendars", () => {
  it("reads one-off, all-day and floating events in a range", () => {
    const ics = cal(
      ev("UID:a", "DTSTART:20261110T150000Z", "DTEND:20261110T160000Z", "SUMMARY:Dentist"),
      ev("UID:b", "DTSTART;VALUE=DATE:20261111", "SUMMARY:Holiday"),
      ev("UID:c", "DTSTART:20261112T090000", "DTEND:20261112T100000", "SUMMARY:Here"),
      ev("UID:d", "DTSTART:20270101T090000Z", "DTEND:20270101T100000Z", "SUMMARY:Later"),
    );
    const list = occurrences(ics, ...range("2026-11-01T00:00:00Z", "2026-12-01T00:00:00Z"));
    expect(list.map((o) => [o.title, o.start, o.end, o.allDay])).toEqual([
      ["Dentist", "2026-11-10T15:00:00.000Z", "2026-11-10T16:00:00.000Z", false],
      // No end: it lasts the day.
      ["Holiday", "2026-11-11", "2026-11-12", true],
      // No zone: a time of day, read in the viewer's zone.
      ["Here", "2026-11-12T09:00:00", "2026-11-12T10:00:00", false],
    ]);
  });

  it("expands repeats, with skipped, moved and cancelled times", () => {
    const ics = cal(
      ev(
        "UID:w",
        "DTSTART;TZID=America/New_York:20261019T090000",
        "DTEND;TZID=America/New_York:20261019T100000",
        "RRULE:FREQ=WEEKLY;COUNT=5",
        "EXDATE;TZID=America/New_York:20261026T090000",
        "SUMMARY:Standup",
      ),
      ev(
        "UID:w",
        "RECURRENCE-ID;TZID=America/New_York:20261102T090000",
        "DTSTART;TZID=America/New_York:20261102T110000",
        "DTEND;TZID=America/New_York:20261102T120000",
        "SUMMARY:Standup (moved)",
      ),
      ev(
        "UID:w",
        "RECURRENCE-ID;TZID=America/New_York:20261109T090000",
        "DTSTART;TZID=America/New_York:20261109T090000",
        "STATUS:CANCELLED",
        "SUMMARY:Standup",
      ),
    );
    const list = occurrences(ics, ...range("2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z"));
    expect(list.map((o) => [o.title, o.start])).toEqual([
      // 9:00 in New York is 13:00 UTC in summer time…
      ["Standup", "2026-10-19T13:00:00.000Z"],
      ["Standup (moved)", "2026-11-02T16:00:00.000Z"],
      // …and 14:00 UTC after the clocks go back (1 November 2026).
      ["Standup", "2026-11-16T14:00:00.000Z"],
    ]);
    expect(list.every((o) => o.repeating && o.repeat === "weekly")).toBe(true);
    expect(list[1]?.instance).toBe("2026-11-02T14:00:00.000Z");
  });

  it("uses the file's own zone when it isn't an IANA name (Outlook)", () => {
    const ics = cal(
      [
        "BEGIN:VTIMEZONE",
        "TZID:Pacific Standard Time",
        "BEGIN:STANDARD",
        "DTSTART:16010101T020000",
        "TZOFFSETFROM:-0700",
        "TZOFFSETTO:-0800",
        "RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11",
        "END:STANDARD",
        "BEGIN:DAYLIGHT",
        "DTSTART:16010101T020000",
        "TZOFFSETFROM:-0800",
        "TZOFFSETTO:-0700",
        "RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3",
        "END:DAYLIGHT",
        "END:VTIMEZONE",
      ].join("\r\n"),
      ev(
        "UID:o",
        "DTSTART;TZID=Pacific Standard Time:20261210T090000",
        "DTEND;TZID=Pacific Standard Time:20261210T093000",
        "SUMMARY:Review",
      ),
    );
    const [o] = occurrences(ics, ...range("2026-12-01T00:00:00Z", "2027-01-01T00:00:00Z"));
    expect(o?.start).toBe("2026-12-10T17:00:00.000Z");
  });

  it("stops a runaway rule and refuses what isn't a calendar", () => {
    const ics = cal(
      ev("UID:s", "DTSTART:20260101T000000Z", "DTEND:20260101T000001Z", "RRULE:FREQ=SECONDLY"),
    );
    expect(
      occurrences(ics, ...range("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")).length,
    ).toBeLessThanOrEqual(20_000);
    expect(() => occurrences("<html>nope</html>", 0, 1)).toThrow(/isn't a calendar/);
  });
});

describe("zones", () => {
  it("turns a time of day in a zone into an instant, both sides of a clock change", () => {
    expect(new Date(wallToUtc(Date.UTC(2026, 6, 1, 9), "Europe/London")).toISOString()).toBe(
      "2026-07-01T08:00:00.000Z",
    );
    expect(new Date(wallToUtc(Date.UTC(2026, 11, 1, 9), "Europe/London")).toISOString()).toBe(
      "2026-12-01T09:00:00.000Z",
    );
    expect(offsetAt("Asia/Kolkata", Date.UTC(2026, 0, 1))).toBe(5.5 * 3600_000);
  });

  it("describes a zone's clock changes for CalDAV servers", () => {
    const text = vtimezone("America/New_York", 2026).toString();
    expect(text).toContain("TZID:America/New_York");
    expect(text).toMatch(/BEGIN:DAYLIGHT[\s\S]*RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU/);
    expect(text).toMatch(/BEGIN:STANDARD[\s\S]*RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU/);
    expect(vtimezone("Asia/Tokyo", 2026).toString()).not.toContain("DAYLIGHT");
  });
});

describe("writing events", () => {
  const from = Date.parse("2026-10-01T00:00:00Z");
  const to = Date.parse("2026-12-01T00:00:00Z");

  it("writes an event that reads back the same", () => {
    const ics = eventIcs(
      {
        title: "Piano, Ava",
        start: "2026-11-10T22:00:00.000Z",
        end: "2026-11-10T23:00:00.000Z",
        allDay: false,
        location: "Music school; room 2",
        notes: "Bring the book",
      },
      "u1@hearth",
    );
    expect(ics).toContain("UID:u1@hearth");
    const [o] = occurrences(ics, from, to);
    expect(o).toMatchObject({
      uid: "u1@hearth",
      title: "Piano, Ava",
      start: "2026-11-10T22:00:00.000Z",
      location: "Music school; room 2",
      notes: "Bring the book",
    });
  });

  it("keeps a weekly time of day across the clock change, with the zone described", () => {
    const ics = eventIcs(
      {
        title: "Swim",
        start: "2026-10-26T13:00:00.000Z",
        end: "2026-10-26T14:00:00.000Z",
        allDay: false,
        timeZone: "America/New_York",
        repeat: "weekly",
        until: "2026-11-09",
      },
      "u2@hearth",
    );
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("DTSTART;TZID=America/New_York:20261026T090000");
    expect(occurrences(ics, from, to).map((o) => o.start)).toEqual([
      "2026-10-26T13:00:00.000Z",
      "2026-11-02T14:00:00.000Z",
      "2026-11-09T14:00:00.000Z",
    ]);
  });

  it("changes only what Hearth edits in an existing event", () => {
    const existing = cal(
      ev(
        "UID:x",
        "DTSTART:20261110T150000Z",
        "DTEND:20261110T160000Z",
        "SUMMARY:Old",
        "SEQUENCE:2",
        "BEGIN:VALARM",
        "TRIGGER:-PT15M",
        "ACTION:DISPLAY",
        "END:VALARM",
      ),
    );
    const ics = eventIcs(
      { title: "New", start: "2026-11-11", end: "2026-11-12", allDay: true },
      "x",
      existing,
    );
    expect(ics).toContain("SUMMARY:New");
    expect(ics).toContain("DTSTART;VALUE=DATE:20261111");
    expect(ics).toContain("SEQUENCE:3");
    expect(ics).toContain("BEGIN:VALARM");
  });
});
