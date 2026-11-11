/**
 * start.home/welcome: what a device Hearth doesn't know sees when the front door stopped it. Type
 * the house password, or ask a parent to let it in. Opens by itself as the phone's "Sign in to
 * network" page when the admin gave Hearth's address.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleCheck, DoorOpen, Hand, KeyRound } from "lucide-react";
import { useState } from "react";
import type { DoorHere } from "../../shared/internet";
import { Button, ErrorNote, Field, Input } from "../components/ui";
import { api } from "../lib/api";

const KEY = ["door-here"] as const;

export function WelcomePage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<DoorHere>("/api/door/here"),
    // While waiting for a parent, look again now and then.
    refetchInterval: (query) => (query.state.data?.asked ? 5000 : 30_000),
  });
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"enter" | "ask" | null>(null);
  const h = q.data;
  const run = async (kind: "enter" | "ask", fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      setError(e);
    }
    setBusy(null);
  };

  return (
    <main className="shell grid max-w-lg gap-5 pb-24">
      <div className="grid justify-items-center gap-2 pt-4 text-center">
        <DoorOpen className="size-10 text-accent" />
        <h1 className="font-heading text-2xl font-bold">Welcome{h ? ` to ${h.home}` : ""}</h1>
      </div>
      {!h ? (
        q.error ? (
          <ErrorNote error={q.error} />
        ) : (
          <div className="skeleton h-40" />
        )
      ) : h.inside ? (
        <section className="card grid justify-items-center gap-3 p-6 text-center">
          <CircleCheck className="size-8 text-good" />
          <p className="text-[15px] font-semibold">This device is on the internet.</p>
          {h.admitted ? (
            <p className="text-[13.5px] text-muted">
              It was let in
              {h.admitted.until
                ? ` until ${new Date(h.admitted.until).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`
                : ""}
              . If a page still won't open, turn Wi-Fi off and on again.
            </p>
          ) : null}
          <Link to="/" className="font-semibold text-accent hover:underline">
            Go to the start page
          </Link>
        </section>
      ) : (
        <>
          <p className="text-center text-[14px] text-muted">
            This device is new to the family network, so it can't use the internet yet. Guests: the
            guest Wi-Fi is the one for you.
          </p>
          {h.passwordSet ? (
            <form
              className="card grid gap-3 p-5"
              onSubmit={(e) => {
                e.preventDefault();
                void run("enter", () => api.post("/api/door/enter", { password }));
              }}
            >
              <h2 className="flex items-center gap-2 font-bold">
                <KeyRound className="size-5 text-accent" /> I know the house password
              </h2>
              <Field label="House password">
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    autoComplete="off"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" busy={busy === "enter"} disabled={!password}>
                Let this device in
              </Button>
            </form>
          ) : null}
          <form
            className="card grid gap-3 p-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run("ask", () => api.post("/api/door/ask", { name: name.trim() || undefined }));
            }}
          >
            <h2 className="flex items-center gap-2 font-bold">
              <Hand className="size-5 text-accent" /> Ask a parent
            </h2>
            {h.asked ? (
              <p className="text-[14px]">
                Asked. A parent sees it on the Family page; this page moves on by itself when they
                let it in.
              </p>
            ) : (
              <>
                <Field label="What is this device? (optional)">
                  {(id) => (
                    <Input
                      id={id}
                      value={name}
                      maxLength={80}
                      placeholder="Grandpa's tablet"
                      onChange={(e) => setName(e.target.value)}
                    />
                  )}
                </Field>
                <Button type="submit" variant="secondary" busy={busy === "ask"}>
                  Ask to be let in
                </Button>
              </>
            )}
          </form>
          <ErrorNote error={error} />
        </>
      )}
    </main>
  );
}
