/**
 * Under the top bar: "Away from home: this is Hearth as of 3:40 pm" when what's on screen is a
 * kept copy, and the offer to install Hearth as an app where the browser makes one.
 */
import { CloudOff, Download, X } from "lucide-react";
import { useState } from "react";
import { local } from "../lib/api";
import { useLive } from "../lib/live";
import { useInstall, useKeptCopy } from "../lib/pwa";

const INSTALL_DISMISSED = "hearth.install-dismissed";
/** After "Not now", ask again in a month. */
const QUIET_FOR = 30 * 24 * 3600 * 1000;

function when(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return today
    ? time
    : `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
}

export function AppBanner() {
  const keptCopy = useKeptCopy();
  const live = useLive();
  const install = useInstall();
  const [, redraw] = useState(0);
  const savedAt = keptCopy ? Date.parse(keptCopy) : live.keptAt;
  const dismissed = local.get<number>(INSTALL_DISMISSED, 0);
  return (
    <>
      {savedAt ? (
        <div className="shell">
          <div
            role="status"
            className="mb-3 flex items-center gap-3 rounded-2xl border border-line bg-(--c-surface-2) px-4 py-2.5 text-[13.5px]"
          >
            <CloudOff className="size-4 flex-none text-muted" />
            <span className="grow">
              <b>Away from home.</b> This is Hearth as of {when(savedAt)}. Links to the home's
              services open once you're back on the home network.
            </span>
          </div>
        </div>
      ) : null}
      {install.can && !savedAt && Date.now() - dismissed > QUIET_FOR ? (
        <div className="shell">
          <div className="mb-3 flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/8 px-4 py-2.5 text-[13.5px]">
            <Download className="size-4 flex-none text-accent" />
            <span className="grow">
              <b>Install Hearth</b> on this device: it opens like an app, and still shows the last
              page when you're away from home.
            </span>
            <button
              type="button"
              onClick={() => void install.install()}
              className="rounded-full bg-accent px-3 py-1 text-[13px] font-semibold text-white"
            >
              Install
            </button>
            <button
              type="button"
              aria-label="Not now"
              title="Not now"
              onClick={() => {
                local.set(INSTALL_DISMISSED, Date.now());
                redraw((n) => n + 1);
              }}
              className="grid size-7 place-items-center rounded-full text-muted hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
