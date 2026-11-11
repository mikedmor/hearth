/**
 * Settings → People → Single sign-on: Hearth signs people in through the home's identity provider
 * (Pocket ID, Authentik, any OpenID Connect provider), and each person's account is linked here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Unlink } from "lucide-react";
import { useEffect, useState } from "react";
import type { PublicProfile, SsoAdmin } from "../../shared/api";
import { api } from "../lib/api";
import { Avatar } from "./Picker";
import { Button, ErrorNote, Field, Input, useToast } from "./ui";

const KEY = ["admin-sso"] as const;

export function SsoCard({ profiles }: { profiles: PublicProfile[] }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: KEY, queryFn: () => api.get<SsoAdmin>("/api/admin/sso") });
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [label, setLabel] = useState("Pocket ID");
  const [adminGroup, setAdminGroup] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const v = q.data;
  useEffect(() => {
    if (!v) return;
    setIssuer(v.issuer ?? "");
    setClientId(v.clientId ?? "");
    setLabel(v.label);
    setAdminGroup(v.adminGroup ?? "");
  }, [v]);
  if (!v) return q.error ? <ErrorNote error={q.error} /> : <div className="skeleton h-40" />;

  const callback = `https://${location.hostname}/api/sso/callback`;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/admin/sso", {
        issuer: issuer.trim(),
        clientId: clientId.trim(),
        label: label.trim() || "Pocket ID",
        adminGroup: adminGroup.trim(),
        ...(secret ? { clientSecret: secret } : {}),
      });
      setSecret("");
      await qc.invalidateQueries({ queryKey: KEY });
      await qc.invalidateQueries({ queryKey: ["sso"] });
      toast(issuer.trim() ? "Single sign-on is set up" : "Single sign-on is off");
    } catch (err) {
      setError(err);
    }
    setBusy(false);
  };
  const linkOf = (id: string) => v.links.find((l) => l.profile === id);
  const on = Boolean(v.issuer && v.clientId);

  return (
    <div className="card grid gap-4 p-5">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <KeyRound className="size-5 text-accent" /> Single sign-on
        </h2>
        <p className="mt-0.5 text-[13.5px] text-muted">
          Sign in with the home's own identity provider (Pocket ID, Authentik, or any OpenID Connect
          provider): one account and passkey for Hearth and the family's other apps. A linked
          person's page opens with no PIN and stays open on that device, and people in the admin
          group also get the admin's session.
        </p>
      </div>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        <Field label="Provider's address" hint="Like https://id.home">
          {(id) => (
            <Input
              id={id}
              value={issuer}
              placeholder="https://id.home"
              onChange={(e) => setIssuer(e.target.value)}
            />
          )}
        </Field>
        <Field label="Client ID" hint="From the client you made for Hearth there.">
          {(id) => <Input id={id} value={clientId} onChange={(e) => setClientId(e.target.value)} />}
        </Field>
        <Field
          label="Client secret"
          hint={
            v.secretSaved
              ? "Saved. Type a new one to change it."
              : "Leave empty for a public client (with PKCE)."
          }
        >
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete="off"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Admin group (optional)"
          hint="People in this group there also get the admin's session."
        >
          {(id) => (
            <Input
              id={id}
              value={adminGroup}
              placeholder="hearth_admins"
              onChange={(e) => setAdminGroup(e.target.value)}
            />
          )}
        </Field>
        <Field label="The button says “Sign in with …”">
          {(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}
        </Field>
        <div className="grid content-end">
          <Button type="submit" variant="primary" busy={busy}>
            Save
          </Button>
        </div>
      </form>
      <p className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13px]">
        In the provider, make a client for Hearth with this <b>callback URL</b>:{" "}
        <code className="break-all">{callback}</code>
        {location.protocol !== "https:" ? " (the https address: passkeys need it)" : ""}.
      </p>
      <ErrorNote error={error} />

      {on ? (
        <div className="grid gap-2">
          <span className="text-[14px] font-semibold">Linked accounts</span>
          <p className="text-[12.5px] text-muted">
            Linking opens the provider: whoever signs in there is tied to that person here. Do it
            with them, on their device, or let them do it from their own page.
          </p>
          <ul className="grid gap-1.5">
            {profiles.map((p) => {
              const l = linkOf(p.id);
              return (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-line px-3 py-2 text-[13.5px]"
                >
                  <Avatar p={p} size="xs" />
                  <span className="grow">
                    <b>{p.name}</b>{" "}
                    <span className="text-muted">
                      {l ? `linked${l.label ? ` to ${l.label}` : ""}` : "not linked"}
                    </span>
                  </span>
                  {l ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api.del(`/api/admin/sso/links/${encodeURIComponent(p.id)}`);
                        await qc.invalidateQueries({ queryKey: KEY });
                        toast(`${p.name} isn't linked any more`);
                      }}
                    >
                      <Unlink className="size-4" /> Unlink
                    </Button>
                  ) : (
                    <a
                      href={`/api/sso/start?intent=link&profile=${encodeURIComponent(p.id)}&returnTo=${encodeURIComponent("/settings?tab=profiles")}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-accent hover:underline"
                    >
                      <Link2 className="size-4" /> Link {p.name}'s account
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
