/**
 * Settings → Calendars (the admin's part): whether calendars may reach the internet, and
 * the Google client that two-way Google Calendar signs in with. The admin sees nobody's calendar.
 *
 * Google has two setups. With a return page (public-site/ on a free host), the client is a "Web
 * application", the app can be published, and Google brings the browser back by itself. Without
 * one, it's a "Desktop app" left in testing: people paste an address back, and sign in again
 * every 7 days.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { Button, ErrorNote, Field, Input, Segmented, Toggle, useToast } from "../ui";

interface CalendarAdmin {
  allowInternet: boolean;
  googleClientId: string;
  googleSecret: boolean;
  googleReturnPage: string;
}

function A({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-0.5 font-semibold text-accent"
    >
      {children} <ExternalLink className="size-3" />
    </a>
  );
}

export function CalendarAdminPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({
    queryKey: ["admin-calendar"],
    queryFn: () => api.get<CalendarAdmin>("/api/admin/calendar"),
  });
  const [internet, setInternet] = useState(false);
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [returnPage, setReturnPage] = useState("");
  const [mode, setMode] = useState<"return" | "paste">("return");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!q.data) return;
    setInternet(q.data.allowInternet);
    setClientId(q.data.googleClientId);
    setReturnPage(q.data.googleReturnPage);
    if (q.data.googleClientId && !q.data.googleReturnPage) setMode("paste");
  }, [q.data]);
  if (!q.data) return <div className="skeleton h-64" />;

  const save = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/admin/calendar", body);
      toast(done);
      setSecret("");
      await qc.invalidateQueries({ queryKey: ["admin-calendar"] });
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  // The site's address, from the return page: https://you.github.io/hearth-public/
  const site =
    returnPage.trim().replace(/google\/?$/, "") || "https://YOU.github.io/hearth-public/";
  const domain = (() => {
    try {
      return new URL(site).hostname;
    } catch {
      return "YOU.github.io";
    }
  })();

  return (
    <div className="grid gap-5">
      <div className="card p-5">
        <h2 className="text-lg font-bold">Calendars</h2>
        <p className="mt-0.5 mb-4 text-[13.5px] text-muted">
          Everyone has their own calendar on the Calendar page, and adds their own sources there.
          Their passwords and links are kept encrypted and aren't shown to you.
        </p>
        <Toggle
          label="Calendars can reach the internet"
          hint="Needed for Google, and for calendar links and CalDAV servers outside the house (iCloud, a school's). Off: only calendars on the home network."
          checked={internet}
          onChange={(v) => {
            setInternet(v);
            void save(
              { allowInternet: v },
              v ? "Calendars can reach the internet" : "Home network only",
            );
          }}
        />
      </div>

      <div className="card p-5">
        <h2 className="text-lg font-bold">Google Calendar, both ways</h2>
        <p className="mt-0.5 mb-4 text-[13.5px] text-muted">
          So people can sign in with Google and add events to their Google calendars, Hearth needs a
          Google sign-in client of its own. It's free, and set up once. (Without it, a Google
          calendar can still be added read-only, from its secret iCal address.)
        </p>
        <div className="mb-4">
          <Segmented
            label="How Google signs in"
            value={mode}
            onChange={setMode}
            options={[
              { value: "return", label: "With a return page" },
              { value: "paste", label: "Without a website" },
            ]}
          />
        </div>
        {mode === "return" ? (
          <p className="mb-3 text-[13px] text-muted">
            Recommended. A tiny public site (Hearth's <code>public-site</code> folder, free on
            GitHub Pages) gives Google the home page and privacy policy it wants before it lets you
            publish, and brings the sign-in back to Hearth by itself. It only forwards the browser
            home; it never sees anything that opens a calendar, and nothing at home is opened to the
            internet.
          </p>
        ) : (
          <p className="mb-3 text-[13px] text-muted">
            No website: Google won't publish the app, so it stays in testing. People paste back the
            address Google sends them to, and sign in again every 7 days.
          </p>
        )}
        <ol className="mb-5 grid list-decimal gap-2 pl-5 text-[13.5px]">
          {mode === "return" ? (
            <li>
              Put the <code>public-site</code> folder on GitHub Pages (its README has the steps).
              Check {site} opens.
            </li>
          ) : null}
          <li>
            In the <A href="https://console.cloud.google.com/projectcreate">Google Cloud console</A>
            , make a project (call it Hearth), and under APIs & Services → Library turn on the{" "}
            <b>Google Calendar API</b>.
          </li>
          {mode === "return" ? (
            <li>
              Under Google Auth Platform → <b>Branding</b>: a name and your email, no logo (a logo
              needs Google's review), the home page <code>{site}</code>, the privacy policy{" "}
              <code>{site}privacy.html</code>, the terms of service <code>{site}terms.html</code>,
              and the authorized domain <code>{domain}</code>. Save. If Google asks you to prove the
              domain is yours, use{" "}
              <A href="https://search.google.com/search-console">Search Console</A> with the HTML
              tag method (the README says where it goes). Then under <b>Audience</b>, choose{" "}
              <b>Publish app</b>.
            </li>
          ) : (
            <li>
              Under Google Auth Platform → <b>Branding</b>: a name and your email, nothing else.
              Under <b>Audience</b>, add each person's Google address as a <b>test user</b>.
            </li>
          )}
          <li>
            Under <b>Clients</b>, create an OAuth client of type{" "}
            {mode === "return" ? (
              <>
                <b>Web application</b>, with the authorized redirect URI <code>{site}google/</code>
              </>
            ) : (
              <b>Desktop app</b>
            )}
            . Copy its client ID and secret here.
          </li>
        </ol>
        <p className="mb-4 text-[12.5px] text-muted">
          Google will call the app unverified, which is fine for a home's own app: the first time
          each person connects, they choose Advanced, then continue.
        </p>
        <div className="grid gap-3">
          {mode === "return" ? (
            <Field label="Return page" hint="The public site's google/ page, exactly as in Google.">
              {(id) => (
                <Input
                  id={id}
                  value={returnPage}
                  placeholder="https://you.github.io/hearth-public/google/"
                  onChange={(e) => setReturnPage(e.target.value)}
                />
              )}
            </Field>
          ) : null}
          <Field label="Client ID">
            {(id) => (
              <Input
                id={id}
                value={clientId}
                placeholder="1234-abc.apps.googleusercontent.com"
                onChange={(e) => setClientId(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Client secret"
            hint={
              q.data.googleSecret ? "Saved. Type a new one to replace it." : "Kept as a secret."
            }
          >
            {(id) => (
              <Input
                id={id}
                type="password"
                autoComplete="off"
                value={secret}
                placeholder={q.data.googleSecret ? "••••••••" : "GOCSPX-…"}
                onChange={(e) => setSecret(e.target.value)}
              />
            )}
          </Field>
          {!internet && clientId ? (
            <p className="text-[12.5px] text-warn">
              Google needs the internet: turn that on above as well.
            </p>
          ) : null}
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              busy={busy}
              onClick={() =>
                save(
                  {
                    googleClientId: clientId.trim(),
                    googleReturnPage: mode === "return" ? returnPage.trim() : "",
                    ...(secret.trim() ? { googleSecret: secret.trim() } : {}),
                  },
                  "Google sign-in is set up",
                )
              }
            >
              Save
            </Button>
            {q.data.googleClientId || q.data.googleSecret ? (
              <Button
                variant="danger"
                onClick={() =>
                  save(
                    { googleClientId: "", googleSecret: null, googleReturnPage: "" },
                    "Google sign-in is removed",
                  )
                }
              >
                Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
