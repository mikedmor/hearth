import { randomBytes } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GOOGLE_CLIENT_SECRET, secretOf } from "../../shared/calendar";
import { type Profile, ProfileSchema, SettingsSchema } from "../../shared/config";
import { SecretStore } from "../secrets";
import { CalendarService, expandHearth } from "./service";
import { CalendarStore } from "./store";

const people: Profile[] = [
  ProfileSchema.parse({ id: "alex", name: "Alex", role: "admin", color: "#e8590c" }),
  ProfileSchema.parse({ id: "sam", name: "Sam", color: "#1c7ed6" }),
  ProfileSchema.parse({ id: "ava", name: "Ava", role: "child", locked: true }),
];
const [alex, sam, ava] = people as [Profile, Profile, Profile];

type Handler = (req: {
  url: URL;
  method: string;
  headers: Headers;
  body: string;
}) => Response | Promise<Response>;

async function setup(
  opts: { internet?: boolean; handler?: Handler; google?: boolean; returnPage?: string } = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "hearth-cal-"));
  const store = new CalendarStore(dir);
  const secrets = new SecretStore(dir, randomBytes(32));
  const settings = SettingsSchema.parse({
    calendar: {
      allowInternet: opts.internet ?? false,
      googleClientId: opts.google ? "123.apps.googleusercontent.com" : undefined,
      googleReturnPage: opts.returnPage,
    },
  });
  if (opts.google) await secrets.set(GOOGLE_CLIENT_SECRET, "shh");
  const calls: { method: string; url: string; body: string; headers: Headers }[] = [];
  const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === "string" ? init.body : "";
    calls.push({ method, url: url.href, body, headers });
    if (!opts.handler) return new Response("no", { status: 500 });
    return opts.handler({ url, method, headers, body });
  }) as typeof fetch;
  let now = Date.parse("2026-11-10T12:00:00Z");
  const service = new CalendarService({
    store,
    secrets,
    settings: () => settings,
    profiles: () => people,
    fetch: fakeFetch,
    now: () => now,
  });
  return { service, store, secrets, calls, tick: (ms: number) => (now += ms) };
}

const NOV = [Date.parse("2026-11-01T00:00:00Z"), Date.parse("2026-12-01T00:00:00Z")] as const;
const event = (calendar: string, extra: Record<string, unknown> = {}) => ({
  calendar,
  title: "Dentist",
  start: "2026-11-12T15:00:00.000Z",
  end: "2026-11-12T16:00:00.000Z",
  allDay: false,
  timeZone: "America/New_York",
  people: [] as string[],
  ...extra,
});

describe("everyone's own calendar", () => {
  it("is made the first time someone looks, in their colour", async () => {
    const { service } = await setup();
    const v = await service.view(alex, ...NOV, false);
    expect(v.calendars).toMatchObject([
      { id: "alex-own", name: "Alex", color: "#e8590c", mine: true, on: true, canWrite: true },
    ]);
    expect(v.noPin).toBe(true);
    expect(v.events).toEqual([]);
  });

  it("adds, changes and deletes events", async () => {
    const { service } = await setup();
    await service.ensureOwn(alex);
    const { ref } = await service.createEvent(alex, event("alex-own"));
    let v = await service.view(alex, ...NOV, true);
    expect(v.events).toMatchObject([
      { title: "Dentist", start: "2026-11-12T15:00:00.000Z", canEdit: true, calendar: "alex-own" },
    ]);
    await service.updateEvent(
      alex,
      { calendar: "alex-own", ref, scope: "all" },
      event("alex-own", {
        title: "Dentist (moved)",
        start: "2026-11-13",
        end: "2026-11-14",
        allDay: true,
      }),
    );
    v = await service.view(alex, ...NOV, true);
    expect(v.events.map((e) => [e.title, e.start, e.allDay])).toEqual([
      ["Dentist (moved)", "2026-11-13", true],
    ]);
    await service.deleteEvent(alex, { calendar: "alex-own", ref, scope: "all" });
    expect((await service.view(alex, ...NOV, true)).events).toEqual([]);
  });

  it("repeats at the same time of day, and can skip or change one time", async () => {
    const { service } = await setup();
    await service.ensureOwn(alex);
    const { ref } = await service.createEvent(
      alex,
      event("alex-own", {
        title: "Swim",
        start: "2026-10-26T13:00:00.000Z",
        end: "2026-10-26T14:00:00.000Z",
        repeat: "weekly",
      }),
    );
    const starts = async () =>
      (await service.view(alex, ...NOV, true)).events.map((e) => [e.title, e.start]);
    // 9:00 in New York every Monday, after the clocks went back on 1 November.
    expect(await starts()).toEqual([
      ["Swim", "2026-11-02T14:00:00.000Z"],
      ["Swim", "2026-11-09T14:00:00.000Z"],
      ["Swim", "2026-11-16T14:00:00.000Z"],
      ["Swim", "2026-11-23T14:00:00.000Z"],
      ["Swim", "2026-11-30T14:00:00.000Z"],
    ]);
    await service.deleteEvent(alex, {
      calendar: "alex-own",
      ref,
      instance: "2026-11-09T14:00:00.000Z",
      scope: "one",
    });
    await service.updateEvent(
      alex,
      { calendar: "alex-own", ref, instance: "2026-11-16T14:00:00.000Z", scope: "one" },
      event("alex-own", {
        title: "Swim (late)",
        start: "2026-11-16T20:00:00.000Z",
        end: "2026-11-16T21:00:00.000Z",
      }),
    );
    expect(await starts()).toEqual([
      ["Swim", "2026-11-02T14:00:00.000Z"],
      ["Swim (late)", "2026-11-16T20:00:00.000Z"],
      ["Swim", "2026-11-23T14:00:00.000Z"],
      ["Swim", "2026-11-30T14:00:00.000Z"],
    ]);
  });

  it("expands all-day repeats up to their last day", () => {
    const list = expandHearth(
      {
        id: "b",
        calendar: "c",
        title: "Bins",
        start: "2026-11-03",
        end: "2026-11-04",
        allDay: true,
        repeat: "weekly",
        until: "2026-11-17",
        except: [],
        createdBy: "alex",
        updated: "",
      },
      ...NOV,
    );
    expect(list.map((o) => o.start)).toEqual(["2026-11-03", "2026-11-10", "2026-11-17"]);
  });
});

describe("sharing", () => {
  it("shows a shared calendar to the people it's shared with, who can turn it off", async () => {
    const { service } = await setup();
    const family = await service.createCalendar(alex, {
      kind: "hearth",
      name: "Family",
      color: "#2f9e44",
      shareWith: ["sam", "ava"],
      shareEdit: false,
    });
    await service.createEvent(alex, event(family.id, { title: "Grandma's" }));
    const samView = await service.view(sam, ...NOV, true);
    const shared = samView.calendars.find((c) => c.id === family.id);
    expect(shared).toMatchObject({ mine: false, on: true, canWrite: false, owner: "alex" });
    expect(shared?.shareWith).toBeUndefined();
    expect(samView.events.map((e) => [e.title, e.canEdit])).toEqual([["Grandma's", false]]);
    await expect(service.createEvent(sam, event(family.id))).rejects.toThrow(/not add to it/);

    await service.setOff(sam, [family.id]);
    expect((await service.view(sam, ...NOV, true)).events).toEqual([]);
    // Turning it off is Sam's alone.
    expect((await service.view(ava, ...NOV, true)).events).toHaveLength(1);
  });

  it("lets people add to a calendar shared for editing", async () => {
    const { service } = await setup();
    const family = await service.createCalendar(alex, {
      kind: "hearth",
      name: "Family",
      color: "#2f9e44",
      shareWith: ["sam"],
      shareEdit: true,
    });
    await service.createEvent(sam, event(family.id, { title: "Football" }));
    const v = await service.view(alex, ...NOV, true);
    expect(v.events.map((e) => [e.title, e.canEdit])).toEqual([["Football", true]]);
  });

  it("shows a tagged event, and only that one, under From <owner>", async () => {
    const { service } = await setup();
    await service.ensureOwn(alex);
    await service.createEvent(alex, event("alex-own", { title: "Private" }));
    await service.createEvent(
      alex,
      event("alex-own", { title: "Parents' evening", people: ["sam"] }),
    );
    const v = await service.view(sam, ...NOV, true);
    expect(v.calendars.find((c) => c.kind === "tagged")).toMatchObject({
      id: "from:alex",
      name: "From Alex",
      on: true,
    });
    expect(v.events.map((e) => [e.title, e.calendar, e.canEdit])).toEqual([
      ["Parents' evening", "from:alex", false],
    ]);
    // Alex sees who's tagged.
    const mine = await service.view(alex, ...NOV, true);
    expect(mine.events.find((e) => e.title === "Parents' evening")?.people).toEqual(["sam"]);
  });

  it("keeps a locked page from adding calendars, but not from its own events", async () => {
    const { service } = await setup();
    await expect(
      service.createCalendar(ava, {
        kind: "hearth",
        name: "Mine",
        color: "#2f9e44",
        shareWith: [],
        shareEdit: false,
      }),
    ).rejects.toThrow(/locked/);
    await service.ensureOwn(ava);
    await service.createEvent(ava, event("ava-own", { title: "Party" }));
    expect((await service.view(ava, ...NOV, true)).events).toHaveLength(1);
  });

  it("forgets someone who's taken out of Hearth", async () => {
    const { service, store } = await setup();
    const c = await service.createCalendar(sam, {
      kind: "hearth",
      name: "Sam's",
      color: "#2f9e44",
      shareWith: ["alex"],
      shareEdit: false,
    });
    await service.createEvent(sam, event(c.id, { people: ["alex"] }));
    await service.forget("sam");
    expect(store.get().calendars.some((x) => x.owner === "sam")).toBe(false);
    expect(store.get().events).toEqual([]);
    expect(store.get().tags).toEqual([]);
  });
});

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:school-1",
  "DTSTART;VALUE=DATE:20261126",
  "DTEND;VALUE=DATE:20261128",
  "SUMMARY:Thanksgiving break",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("calendar links", () => {
  it("reads a link, and keeps its address secret", async () => {
    let served = 0;
    const { service, secrets, store, tick } = await setup({
      handler: () => {
        served++;
        return new Response(ICS, { headers: { "content-type": "text/calendar" } });
      },
    });
    const c = await service.createCalendar(alex, {
      kind: "ics",
      name: "School",
      color: "#9c36b5",
      url: "http://school.home/cal.ics?token=abc",
      shareWith: [],
      shareEdit: false,
    });
    expect(JSON.stringify(store.get())).not.toContain("token=abc");
    expect(secrets.get(secretOf(c.id))).toBe("http://school.home/cal.ics?token=abc");
    const v = await service.view(alex, ...NOV, true);
    const e = v.events.find((x) => x.title === "Thanksgiving break");
    expect(e).toMatchObject({ allDay: true, start: "2026-11-26", canEdit: false });
    expect(v.calendars.find((x) => x.id === c.id)?.readOnly).toBe(true);
    // Cached for its refresh time (an hour for links).
    await service.view(alex, ...NOV, true);
    expect(served).toBe(2); // once to check it, once to show it
    tick(61 * 60_000);
    await service.view(alex, ...NOV, true);
    expect(served).toBe(3);
  });

  it("doesn't reach the internet unless the admin allowed it", async () => {
    const { service } = await setup({ handler: () => new Response(ICS) });
    await expect(
      service.createCalendar(alex, {
        kind: "ics",
        name: "Holidays",
        color: "#9c36b5",
        url: "https://calendar.google.com/calendar/ical/x/basic.ics",
        shareWith: [],
        shareEdit: false,
      }),
    ).rejects.toThrow(/on the internet/);
  });

  it("shows the last good copy, with the problem, when a link stops answering", async () => {
    let up = true;
    const { service, tick } = await setup({
      handler: () => (up ? new Response(ICS) : new Response("gone", { status: 500 })),
    });
    const c = await service.createCalendar(alex, {
      kind: "ics",
      name: "School",
      color: "#9c36b5",
      url: "http://school.home/cal.ics",
      shareWith: [],
      shareEdit: false,
    });
    await service.view(alex, ...NOV, true);
    up = false;
    tick(2 * 3600_000);
    const v = await service.view(alex, ...NOV, true);
    expect(v.calendars.find((x) => x.id === c.id)?.error).toMatch(/500/);
    expect(v.events.some((e) => e.title === "Thanksgiving break")).toBe(true);
  });
});

/** A small CalDAV server: one account, one calendar, objects kept in memory. */
function davServer() {
  const objects = new Map<string, { ics: string; etag: number }>();
  const ms = (body: string) =>
    new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${body}</d:multistatus>`,
      {
        status: 207,
        headers: { "content-type": "application/xml" },
      },
    );
  const handler: Handler = ({ url, method, headers, body }) => {
    if (headers.get("authorization") !== `Basic ${Buffer.from("alex:pw").toString("base64")}`)
      return new Response("", { status: 401 });
    const path = url.pathname;
    if (method === "PROPFIND" && path === "/dav/")
      return ms(
        `<d:response><d:href>/dav/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/dav/principals/alex/</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    if (method === "PROPFIND" && path === "/dav/principals/alex/")
      return ms(
        `<d:response><d:href>/dav/principals/alex/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/dav/calendars/alex/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    if (method === "PROPFIND" && path === "/dav/calendars/alex/")
      return ms(
        `<d:response><d:href>/dav/calendars/alex/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          `<d:response><d:href>/dav/calendars/alex/home/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname><x:calendar-color xmlns:x="http://apple.com/ns/ical/">#FF2968FF</x:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set><d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege></d:current-user-privilege-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          `<d:response><d:href>/dav/calendars/alex/tasks/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Tasks</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
      );
    if (method === "REPORT" && path === "/dav/calendars/alex/home/")
      return ms(
        [...objects]
          .map(
            ([href, o]) =>
              `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>"${o.etag}"</d:getetag><c:calendar-data>${o.ics.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`,
          )
          .join(""),
      );
    if (method === "PUT" && path.startsWith("/dav/calendars/alex/home/")) {
      const had = objects.get(path);
      if (headers.get("if-none-match") === "*" && had) return new Response("", { status: 412 });
      if (headers.get("if-match") && had && headers.get("if-match") !== `"${had.etag}"`)
        return new Response("", { status: 412 });
      const etag = (had?.etag ?? 0) + 1;
      objects.set(path, { ics: body, etag });
      return new Response(null, { status: had ? 204 : 201, headers: { etag: `"${etag}"` } });
    }
    if (method === "DELETE") {
      objects.delete(path);
      return new Response(null, { status: 204 });
    }
    return new Response("", { status: 404 });
  };
  return { handler, objects };
}

describe("CalDAV", () => {
  it("finds the account's event calendars, and saves events to them", async () => {
    const dav = davServer();
    const { service, store, secrets } = await setup({ handler: dav.handler });
    const { account, calendars } = await service.addCalDav(alex, {
      url: "http://nas.home:5000/dav/",
      username: "alex",
      password: "pw",
    });
    expect(calendars).toEqual([
      {
        remote: "http://nas.home:5000/dav/calendars/alex/home/",
        name: "Home",
        color: "#FF2968",
        readOnly: false,
        added: false,
      },
    ]);
    expect(JSON.stringify(store.get())).not.toContain('"pw"');
    expect(secrets.get(secretOf(account.id))).toContain("pw");
    await service.addFromAccount(alex, account.id, calendars);
    const cal = store.get().calendars.find((c) => c.kind === "caldav");
    expect(cal).toMatchObject({ name: "Home", color: "#FF2968" });

    const { ref } = await service.createEvent(alex, event(cal?.id as string, { title: "Vet" }));
    expect(ref).toMatch(/^http:\/\/nas\.home:5000\/dav\/calendars\/alex\/home\/.+\.ics$/);
    let v = await service.view(alex, ...NOV, true);
    const vet = v.events.find((e) => e.title === "Vet");
    expect(vet).toMatchObject({ start: "2026-11-12T15:00:00.000Z", canEdit: true, etag: '"1"' });

    await service.updateEvent(
      alex,
      { calendar: cal?.id as string, ref, etag: vet?.etag, scope: "all" },
      event(cal?.id as string, { title: "Vet (Rex)" }),
    );
    v = await service.view(alex, ...NOV, true);
    expect(v.events.map((e) => e.title)).toContain("Vet (Rex)");
    await service.deleteEvent(alex, { calendar: cal?.id as string, ref, scope: "all" });
    expect(dav.objects.size).toBe(0);
  });

  it("says plainly when the password is wrong", async () => {
    const { service } = await setup({ handler: davServer().handler });
    await expect(
      service.addCalDav(alex, {
        url: "http://nas.home:5000/dav/",
        username: "alex",
        password: "x",
      }),
    ).rejects.toThrow(/didn't accept that username and password/);
  });
});

describe("Google", () => {
  const google: Handler = ({ url, method, body }) => {
    if (url.href === "https://oauth2.googleapis.com/token") {
      const form = new URLSearchParams(body);
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "good-code")
        return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.pathname === "/calendar/v3/users/me/calendarList")
      return Response.json({
        items: [
          {
            id: "alex@example.com",
            summary: "alex@example.com",
            primary: true,
            accessRole: "owner",
            backgroundColor: "#9fe1e7",
          },
          {
            id: "en.usa#holiday@group.v.calendar.google.com",
            summary: "Holidays",
            accessRole: "reader",
          },
        ],
      });
    if (url.pathname.endsWith("/events") && method === "GET")
      return Response.json({
        items: [
          {
            id: "abc_20261112T150000Z",
            recurringEventId: "abc",
            originalStartTime: { dateTime: "2026-11-12T10:00:00-05:00" },
            summary: "Piano",
            description: "<b>Bring</b> the book",
            start: { dateTime: "2026-11-12T10:00:00-05:00" },
            end: { dateTime: "2026-11-12T11:00:00-05:00" },
          },
          { id: "gone", status: "cancelled" },
        ],
      });
    if (url.pathname.endsWith("/events") && method === "POST")
      return Response.json({ id: "new-1", ...JSON.parse(body) });
    return new Response("", { status: 404 });
  };

  it("connects an account from the pasted address, then reads and writes it", async () => {
    const { service, secrets, store, calls } = await setup({
      internet: true,
      google: true,
      handler: google,
    });
    const { url } = service.googleStart(alex);
    const start = new URL(url);
    expect(start.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:53682/");
    expect(start.searchParams.get("code_challenge_method")).toBe("S256");
    const state = start.searchParams.get("state");

    // Someone else can't finish Alex's sign-in.
    await expect(
      service.googleFinish(sam, `http://127.0.0.1:53682/?state=${state}&code=good-code`),
    ).rejects.toThrow(/isn't yours/);

    const { account, calendars } = await service.googleFinish(
      alex,
      `http://127.0.0.1:53682/?state=${state}&code=good-code&scope=x`,
    );
    expect(account.name).toBe("alex@example.com");
    expect(calendars.map((c) => [c.name, c.readOnly])).toEqual([
      ["alex@example.com", false],
      ["Holidays", true],
    ]);
    expect(JSON.parse(secrets.get(secretOf(account.id)) as string)).toEqual({ refresh: "rt" });
    const exchange = calls.find((c) => c.url === "https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(exchange?.body).get("code_verifier")).toBeTruthy();

    await service.addFromAccount(alex, account.id, calendars.slice(0, 1));
    const cal = store.get().calendars.find((c) => c.kind === "google");
    const v = await service.view(alex, ...NOV, true);
    expect(v.events.find((e) => e.title === "Piano")).toMatchObject({
      start: "2026-11-12T15:00:00.000Z",
      series: "abc",
      repeating: true,
      notes: "Bring the book",
      canEdit: true,
    });
    await service.createEvent(alex, event(cal?.id as string, { title: "Lunch", repeat: "weekly" }));
    const made = calls.find((c) => c.method === "POST" && c.url.endsWith("/events"));
    expect(JSON.parse(made?.body ?? "{}")).toMatchObject({
      summary: "Lunch",
      start: { dateTime: "2026-11-12T15:00:00.000Z", timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY"],
    });
    expect(made?.headers.get("authorization")).toBe("Bearer at");

    // Signing in again (a test app's sign-in runs out after 7 days) renews the same account.
    const again = new URL(service.googleStart(alex).url).searchParams.get("state");
    const renewed = await service.googleFinish(
      alex,
      `http://127.0.0.1:53682/?state=${again}&code=good-code`,
    );
    expect(renewed.account.id).toBe(account.id);
    expect(store.get().accounts).toHaveLength(1);
    expect(renewed.calendars.map((c) => c.added)).toEqual([true, false]);
  });

  it("comes back through a return page, to the address Hearth was opened at", async () => {
    const page = "https://you.github.io/hearth-public/google/";
    const { service, calls } = await setup({
      internet: true,
      google: true,
      handler: google,
      returnPage: page,
    });
    const started = service.googleStart(alex, "https://start.home");
    expect(started.returns).toBe(true);
    const url = new URL(started.url);
    expect(url.searchParams.get("redirect_uri")).toBe(page);
    const state = url.searchParams.get("state") as string;
    // The return page reads the home address from the state.
    expect(Buffer.from(state.split(".")[1] as string, "base64url").toString()).toBe(
      "https://start.home",
    );
    const { account } = await service.googleFinish(alex, `?code=good-code&state=${state}`);
    expect(account.kind).toBe("google");
    const exchange = calls.find((c) => c.url === "https://oauth2.googleapis.com/token");
    expect(new URLSearchParams(exchange?.body).get("redirect_uri")).toBe(page);

    // Without the page's own address (an old browser), it falls back to pasting.
    expect(service.googleStart(alex).returns).toBe(false);
  });

  it("waits for the admin: Google's client, and the internet allowed", async () => {
    const noClient = (await setup({ internet: true })).service;
    expect(() => noClient.googleStart(alex)).toThrow(/hasn't set up Google/);
    const noInternet = (await setup({ google: true })).service;
    expect(() => noInternet.googleStart(alex)).toThrow(/can't reach the internet/);
  });
});
