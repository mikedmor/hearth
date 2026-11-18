/**
 * Notifications on this device: the house's alerts (a child asking, someone at the front door, a
 * watched device going offline) as notifications, through the browser's push service. For the
 * admin, every device that gets them, to take one off.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BellRing, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { inAndroidApp } from "../lib/appShell";
import { type PushState, pushState, testPush, turnPushOff, turnPushOn } from "../lib/pwa";
import { Button, ErrorNote, useToast } from "./ui";

interface PushDeviceRow {
  id: string;
  who: string;
  label: string;
  added: string;
  lastOk?: string;
  lastError?: string;
}

const SAY: Record<PushState, string> = {
  unsupported: "This browser can't show notifications from a web page.",
  "needs-https":
    "Notifications need Hearth opened over https: this device has to trust the home's certificate first.",
  blocked:
    "Notifications are blocked for Hearth in this browser. Allow them in the site's settings (the padlock by the address), then come back.",
  off: "Get the house's alerts on this device: a child asking for more time, someone at the front door, a watched device going offline.",
  on: "This device gets the house's alerts.",
};

export function NotificationsCard({ admin }: { admin: boolean }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const check = () =>
    pushState()
      .then(setState)
      .catch(() => setState("off"));
  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState("off"));
  }, []);
  const list = useQuery({
    queryKey: ["admin", "push"],
    queryFn: () => api.get<{ devices: PushDeviceRow[] }>("/api/admin/push"),
    enabled: admin,
  });
  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(done);
      await check();
      await qc.invalidateQueries({ queryKey: ["admin", "push"] });
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  return (
    <section className="card p-5" aria-label="Notifications">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold">
            <BellRing className="size-4.5 text-accent" /> Notifications on this device
          </h2>
          <p className="mt-0.5 text-[13.5px] text-muted">
            {state === "unsupported" && inAndroidApp()
              ? "This copy of the app can't get notifications (it was built without them), or the app didn't answer."
              : state
                ? SAY[state]
                : "Checking…"}
            {state === "needs-https" ? (
              <>
                {" "}
                <Link to="/trust" className="font-semibold text-accent hover:underline">
                  The trust page
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {state === "off" ? (
            <Button
              variant="primary"
              size="sm"
              busy={busy}
              onClick={() => act(turnPushOn, "Notifications are on for this device")}
            >
              Turn on
            </Button>
          ) : null}
          {state === "on" ? (
            <>
              <Button size="sm" busy={busy} onClick={() => act(testPush, "Sent: look for it")}>
                Send a test
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => act(turnPushOff, "Notifications are off for this device")}
              >
                Turn off
              </Button>
            </>
          ) : null}
        </div>
      </div>
      {state === "off" || state === "on" ? (
        <p className="mt-2 text-[12.5px] text-muted">
          {inAndroidApp()
            ? "In the app they come through Google Play services (or the UnifiedPush app chosen in the app's Server and lock settings), encrypted so only this phone can read them. They arrive away from home too."
            : "They're sent through this browser's push service (Google's, for Chrome on Android), encrypted so only this device can read them. They arrive away from home too."}
        </p>
      ) : null}
      <div className="mt-2">
        <ErrorNote error={error} />
      </div>
      {admin && list.data?.devices.length ? (
        <div className="mt-4">
          <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wider text-muted">
            Devices that get alerts
          </h3>
          <ul className="grid gap-1.5">
            {list.data.devices.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-(--c-surface-2) px-3 py-1.5 text-[13px]"
              >
                <span className="min-w-0">
                  <span className="font-semibold">{d.label || "A device"}</span>
                  <span className="ml-1.5 text-muted">
                    {d.who}
                    {d.lastError ? ` · ${d.lastError}` : ""}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={`Stop alerts to ${d.label}`}
                  title="Stop alerts to this device"
                  onClick={() =>
                    act(async () => {
                      await api.del(`/api/admin/push/${encodeURIComponent(d.id)}`);
                    }, "Taken off")
                  }
                  className="grid size-7 flex-none place-items-center rounded-full text-muted hover:text-bad"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
