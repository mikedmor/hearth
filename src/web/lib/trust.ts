/**
 * Does this device trust the home's root? A browser that doesn't refuses an https page before
 * anything loads, so the only way to know is to try: fetch Hearth's own https address. With
 * `no-cors` a trusted answer comes back opaque, and an untrusted one fails at the handshake.
 */
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { TrustInfo } from "../../shared/api";
import { api, local } from "./api";

export const trustKey = ["trust"] as const;

export function useTrustInfo() {
  return useQuery({
    queryKey: trustKey,
    queryFn: () => api.get<TrustInfo>("/api/trust"),
    staleTime: 5 * 60_000,
  });
}

/** A name worth checking: "start.home", not an address, not localhost. */
export function checkableHost(hostname = location.hostname): boolean {
  return (
    hostname.includes(".") &&
    !/^[\d.]+$/.test(hostname) &&
    !hostname.includes(":") &&
    !/^localhost$|\.localhost$/.test(hostname)
  );
}

/** Try this name over https. True: trusted. False: refused. */
export async function probeHttps(hostname = location.hostname, timeoutMs = 4000): Promise<boolean> {
  try {
    await fetch(`https://${hostname}/api/trust/ping?t=${Date.now()}`, {
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return true;
  } catch {
    return false;
  }
}

export type TrustState = "trusted" | "not-trusted" | "checking" | "unknown";

/** This device's trust, checked now and again on `recheck()`. */
export function useTrusted(): { state: TrustState; recheck: () => void } {
  const [state, setState] = useState<TrustState>("checking");
  const [round, setRound] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: round re-runs the check
  useEffect(() => {
    if (location.protocol === "https:") return setState("trusted");
    if (!checkableHost()) return setState("unknown");
    let live = true;
    setState("checking");
    void probeHttps().then((ok) => {
      if (live) setState(ok ? "trusted" : "not-trusted");
    });
    return () => {
      live = false;
    };
  }, [round]);
  return { state, recheck: () => setRound((r) => r + 1) };
}

export type Platform = "iphone" | "android" | "windows" | "mac" | "chromeos" | "linux";

/** Which steps fit the device this page is open on. */
export function platformOf(ua = navigator.userAgent, touch = navigator.maxTouchPoints): Platform {
  if (/iPhone|iPad|iPod/.test(ua)) return "iphone";
  // iPadOS asks for desktop pages as a Mac, but a Mac has no touch screen.
  if (/Macintosh/.test(ua) && touch > 1) return "iphone";
  if (/Android/.test(ua)) return "android";
  if (/CrOS/.test(ua)) return "chromeos";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  return "linux";
}

// v2: reports from before Hearth kept them with each sighting were lost; send them again.
const REPORTED = "hearth.trust-reported.v2";
const REPORT_EVERY = 12 * 3600_000;

/**
 * Tell Hearth whether this browser trusts the home's certificate, so its device on the Devices
 * page can say so. Only by a name (start.home); at most twice a day unless it changed, or
 * whenever Hearth says it doesn't know (`known` false: it lost it, or never got it).
 */
export function useReportTrust(known: boolean | undefined): void {
  useEffect(() => {
    if (!checkableHost() || known === undefined) return;
    let live = true;
    const https = location.protocol === "https:";
    void (https ? Promise.resolve(true) : probeHttps()).then((ok) => {
      if (!live) return;
      const last = local.get<{ ok: boolean; at: number } | null>(REPORTED, null);
      if (known && last && last.ok === ok && Date.now() - last.at < REPORT_EVERY) return;
      void api
        .post<{ kept?: boolean }>("/api/trust/seen", { trusted: ok })
        // Not kept (the page had no device cookie yet): the next page load says it again.
        .then((r) => (r.kept === false ? undefined : local.set(REPORTED, { ok, at: Date.now() })))
        .catch(() => {});
    });
    return () => {
      live = false;
    };
  }, [known]);
}
