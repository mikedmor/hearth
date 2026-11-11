import { describe, expect, it } from "vitest";
import {
  calendarIcs,
  eventIcs,
  occurrences,
  offsetAt,
  readImport,
  vtimezone,
  wallToUtc,
} from "./ics";

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

describe("importing a file", () => {
  const file = cal(
    // Every Tuesday and Thursday at 18:00 in New York, six times; one skipped, one moved, one cancelled.
    ev(
      "UID:club",
      "DTSTART;TZID=America/New_York:20261103T180000",
      "DTEND;TZID=America/New_York:20261103T190000",
      "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6",
      "EXDATE;TZID=America/New_York:20261105T180000",
      "SUMMARY:Chess club",
    ),
    ev(
      "UID:club",
      "RECURRENCE-ID;TZID=America/New_York:20261110T180000",
      "DTSTART;TZID=America/New_York:20261110T200000",
      "DTEND;TZID=America/New_York:20261110T210000",
      "SUMMARY:Chess club (late)",
    ),
    ev("UID:club", "RECURRENCE-ID;TZID=America/New_York:20261112T180000", "STATUS:CANCELLED"),
    ev("UID:bday", "DTSTART;VALUE=DATE:20260314", "RRULE:FREQ=YEARLY", "SUMMARY:Sam's birthday"),
    ev("UID:here", "DTSTART:20261120T093000", "DTEND:20261120T103000", "SUMMARY:No zone"),
    ["BEGIN:VTODO", "UID:t1", "SUMMARY:Buy milk", "END:VTODO"].join("\r\n"),
  );

  it("keeps repeat rules, skipped, moved and cancelled times, and zones", () => {
    const got = readImport(file, "Europe/London");
    const club = got.events.find((e) => e.uid === "club");
    expect(club).toMatchObject({
      start: "2026-11-03T23:00:00.000Z",
      timeZone: "America/New_York",
      rrule: "FREQ=WEEKLY;COUNT=6;BYDAY=TU,TH",
    });
    expect(club?.except.sort()).toEqual([
      "2026-11-05T23:00:00.000Z",
      "2026-11-10T23:00:00.000Z",
      "2026-11-12T23:00:00.000Z",
    ]);
    expect(got.events.find((e) => e.uid.startsWith("club#"))).toMatchObject({
      uid: "club#2026-11-10T23:00:00.000Z",
      title: "Chess club (late)",
      start: "2026-11-11T01:00:00.000Z",
    });
    // A plain yearly repeat becomes Hearth's own "every year".
    const bday = got.events.find((e) => e.uid === "bday");
    expect(bday).toMatchObject({ allDay: true, repeat: "yearly" });
    expect(bday?.rrule).toBeUndefined();
    // No zone: read in the importing person's.
    expect(got.events.find((e) => e.uid === "here")?.start).toBe("2026-11-20T09:30:00.000Z");
    expect(got).toMatchObject({ repeating: 2, changedTimes: 2, first: "2026-03-14", last: "…" });
    expect(got.notes.join(" ")).toMatch(/1 to-do isn't an event/);
    expect(got.objects.map((o) => o.uid)).toEqual(["club", "bday", "here"]);
    expect(got.objects[0]?.ics).toContain("RECURRENCE-ID");
  });

  it("refuses what isn't a calendar", () => {
    expect(() => readImport("hello", "UTC")).toThrow(/isn't a calendar/);
  });
});

describe("downloading a calendar", () => {
  it("writes events that any calendar app reads back the same", () => {
    const ics = calendarIcs("Family", [
      {
        id: "a",
        title: "Swim",
        start: "2026-11-02T14:00:00.000Z",
        end: "2026-11-02T15:00:00.000Z",
        allDay: false,
        timeZone: "America/New_York",
        repeat: "weekly",
        until: "2026-11-16",
        except: ["2026-11-09T14:00:00.000Z"],
        updated: "2026-11-01T00:00:00.000Z",
      },
      {
        id: "b",
        uid: "club",
        title: "Club",
        start: "2026-11-03T23:00:00.000Z",
        end: "2026-11-04T00:00:00.000Z",
        allDay: false,
        timeZone: "America/New_York",
        rrule: "FREQ=WEEKLY;UNTIL=20261117T235959;BYDAY=TU",
        except: [],
        updated: "2026-11-01T00:00:00.000Z",
      },
    ]);
    expect(ics).toContain("X-WR-CALNAME:Family");
    expect(ics).toContain("UID:a@hearth");
    expect(ics).toContain("UID:club");
    // UNTIL goes back to UTC, as the standard wants with a zone.
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261118T045959Z/);
    expect(ics).toMatch(/RRULE:FREQ=WEEKLY;UNTIL=20261117T045959Z/);
    const back = occurrences(
      ics,
      Date.parse("2026-11-01T00:00:00Z"),
      Date.parse("2026-12-01T00:00:00Z"),
    );
    expect(back.map((o) => [o.title, o.start])).toEqual([
      ["Swim", "2026-11-02T14:00:00.000Z"],
      ["Swim", "2026-11-16T14:00:00.000Z"],
      ["Club", "2026-11-03T23:00:00.000Z"],
      ["Club", "2026-11-10T23:00:00.000Z"],
      ["Club", "2026-11-17T23:00:00.000Z"],
    ]);
  });
});

describe("an import's range", () => {
  it("runs to a series' last time, and an all-day event's last day", () => {
    const got = readImport(
      cal(
        ev(
          "UID:c",
          "DTSTART;TZID=America/New_York:20261103T180000",
          "DTEND;TZID=America/New_York:20261103T190000",
          "RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=8",
          "SUMMARY:Club",
        ),
        ev("UID:f", "DTSTART;VALUE=DATE:20261121", "DTEND;VALUE=DATE:20261123", "SUMMARY:Fair"),
      ),
      "UTC",
    );
    expect([got.first, got.last]).toEqual(["2026-11-03", "2026-11-26"]);
  });
});
