/**
 * On a page opened over plain http by name: a device that trusts the home's root quietly moves to
 * https; one that doesn't sees a small banner leading to the trust page. Never on an address
 * (192.168…) or localhost, and never on the trust page itself.
 */
import { Link, useRouterState } from "@tanstack/react-router";
import { ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";
import { local } from "../lib/api";
import { checkableHost, probeHttps, useTrustInfo } from "../lib/trust";

const DISMISSED = "hearth.trust-nudge-dismissed";
const QUIET_FOR = 30 * 86_400_000;

export function TrustNudge() {
  const info = useTrustInfo();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const [untrusted, setUntrusted] = useState(false);
  const plain = location.protocol === "http:" && checkableHost();
  const available = Boolean(info.data?.available);
  const redirect = Boolean(info.data?.redirect);

  useEffect(() => {
    if (!plain || !available) return;
    let live = true;
    void probeHttps().then((ok) => {
      if (!live) return;
      if (ok && redirect)
        location.replace(
          `https://${location.hostname}${location.pathname}${location.search}${location.hash}`,
        );
      else if (!ok) setUntrusted(true);
    });
    return () => {
      live = false;
    };
  }, [plain, available, redirect]);

  const dismissedAt = local.get<number>(DISMISSED, 0);
  if (!untrusted || path.startsWith("/trust") || Date.now() - dismissedAt < QUIET_FOR) return null;
  return (
    <div className="shell">
      <div className="mb-3 flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-[13.5px]">
        <ShieldAlert className="size-4 flex-none text-warn" />
        <span className="grow">
          This device doesn't trust the home's sites yet, so they show warnings.{" "}
          <Link to="/trust" className="font-semibold text-accent hover:underline">
            Fix it in a minute
          </Link>
        </span>
        <button
          type="button"
          aria-label="Not now"
          onClick={() => {
            local.set(DISMISSED, Date.now());
            setUntrusted(false);
          }}
          className="grid size-7 place-items-center rounded-full text-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
