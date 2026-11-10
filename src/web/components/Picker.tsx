/** "Who's here?", with a PIN pad for locked profiles. */
import { Delete, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PublicProfile } from "../../shared/api";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { useRefresh } from "../lib/queries";
import { Button } from "./ui";

export function Avatar({
  p,
  size = "sm",
}: {
  p: Pick<PublicProfile, "name" | "avatar" | "color">;
  size?: "xs" | "sm" | "lg";
}) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-grid flex-none place-items-center rounded-full font-bold select-none",
        size === "lg"
          ? "size-[92px] text-[46px]"
          : size === "xs"
            ? "size-6 text-[13px]"
            : "size-8 text-[17px]",
      )}
      style={{
        background: `color-mix(in oklab, ${p.color} 26%, var(--c-surface))`,
        boxShadow: `0 0 0 2px color-mix(in oklab, ${p.color} 70%, transparent)`,
      }}
    >
      {p.avatar ?? p.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Picker({
  profiles,
  current,
  dismissable,
  onClose,
  title,
}: {
  profiles: PublicProfile[];
  current: string | null;
  dismissable: boolean;
  onClose: () => void;
  title?: string;
}) {
  const refresh = useRefresh();
  const [pinFor, setPinFor] = useState<PublicProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pinFor) setPinFor(null);
      else if (dismissable) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pinFor, dismissable, onClose]);

  const choose = async (p: PublicProfile | null) => {
    if (p?.hasPin && p.id !== current) {
      setPinFor(p);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/profile", { id: p?.id ?? null });
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Who's here?"
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--c-background)_80%,transparent)] p-6 backdrop-blur-xl fade-in"
    >
      {pinFor ? (
        <PinPad
          profile={pinFor}
          onBack={() => setPinFor(null)}
          onDone={async () => {
            await refresh();
            onClose();
          }}
        />
      ) : (
        <div className="flex w-full max-w-3xl flex-col items-center text-center">
          <h2 className="mb-8 font-heading text-[clamp(28px,6vw,42px)] font-bold tracking-tight">
            {title ?? "Who's here?"}
          </h2>
          <div className="mb-8 flex flex-wrap justify-center gap-x-6 gap-y-5">
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => choose(p)}
                className={cx(
                  "group relative flex w-[118px] flex-col items-center gap-2.5 rounded-3xl px-2 py-3 transition hover:-translate-y-1 hover:bg-surface",
                  p.id === current && "bg-surface",
                )}
              >
                <Avatar p={p} size="lg" />
                <span className="flex items-center gap-1 font-semibold">
                  {p.name}
                  {p.hasPin ? <Lock className="size-3.5 text-muted" aria-label="PIN" /> : null}
                </span>
              </button>
            ))}
          </div>
          {error ? (
            <p role="alert" className="mb-4 text-sm font-semibold text-bad">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => choose(null)} busy={busy}>
              Just visiting
            </Button>
            {dismissable ? (
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function PinPad({
  profile,
  onBack,
  onDone,
}: {
  profile: PublicProfile;
  onBack: () => void;
  onDone: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/profile", { id: profile.id, pin: value });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setPin("");
    } finally {
      setBusy(false);
    }
  };
  const press = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pin.length >= 4) void submit(pin);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="flex w-full max-w-xs flex-col items-center text-center">
      <Avatar p={profile} size="lg" />
      <h2 className="mt-3 text-2xl font-bold">{profile.name}</h2>
      <p className="mt-1 text-sm text-muted">Enter your PIN</p>
      <div
        className="my-5 flex h-4 gap-3"
        aria-live="polite"
        role="status"
        aria-label={`${pin.length} digits entered`}
      >
        {Array.from({ length: Math.max(4, pin.length) }, (_, i) => (
          <span
            key={i}
            className={cx(
              "size-3.5 rounded-full border-2 border-[var(--c-line-strong)]",
              i < pin.length && "border-accent bg-accent",
            )}
          />
        ))}
      </div>
      {error ? <p className="mb-3 text-sm font-semibold text-bad">{error}</p> : null}
      <div className="grid grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            className="card size-[68px] text-2xl font-semibold hover:brightness-110"
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setPin((p) => p.slice(0, -1))}
          aria-label="Delete"
          className="grid size-[68px] place-items-center text-muted"
        >
          <Delete className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => press("0")}
          className="card size-[68px] text-2xl font-semibold"
        >
          0
        </button>
        <button
          type="button"
          disabled={pin.length < 4 || busy}
          onClick={() => submit(pin)}
          className="size-[68px] rounded-[var(--radius)] bg-accent text-sm font-bold text-white disabled:opacity-40"
        >
          Open
        </button>
      </div>
      <Button variant="ghost" className="mt-5" onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
