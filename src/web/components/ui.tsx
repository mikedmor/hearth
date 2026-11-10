/** Small building blocks, styled from the theme tokens. */
import { Loader2, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  createContext,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { ApiError } from "../lib/api";
import { cx } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white shadow-sm hover:brightness-110 border border-transparent",
  secondary: "bg-surface text-ink border border-line hover:border-[var(--c-line-strong)]",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-[var(--c-surface-2)]",
  danger: "bg-transparent text-bad border border-line hover:bg-bad/10",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: "sm" | "md";
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || busy}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        VARIANTS[variant],
        className,
      )}
    >
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        "inline-grid size-9 place-items-center rounded-full text-muted transition hover:bg-[var(--c-surface-2)] hover:text-ink disabled:opacity-40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2 className={cx("size-5 animate-spin text-muted", className)} aria-label="Loading" />
  );
}

// ---------------------------------------------------------------------------
// Forms

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (id: string) => ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("grid gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p className="text-[13px] text-bad">{error}</p>
      ) : hint ? (
        <p className="text-[12.5px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-xl border border-line bg-[var(--c-background)] px-3 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-4 focus:ring-[var(--c-accent-soft)]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputClass, "h-10", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cx(inputClass, "min-h-24 font-mono text-[13px] leading-relaxed", props.className)}
    />
  );
}

export function Select({ children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(inputClass, "h-10 pr-8", props.className)}>
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cx("flex items-start justify-between gap-4", disabled && "opacity-50")}>
      <span className="grid gap-0.5">
        <span className="text-[14px] font-semibold">{label}</span>
        {hint ? <span className="text-[12.5px] text-muted">{hint}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          "relative h-6 w-11 flex-none rounded-full transition",
          checked ? "bg-accent" : "bg-[var(--c-line-strong)]",
        )}
      >
        <span
          className={cx(
            "absolute top-0.5 size-5 rounded-full bg-white shadow transition-all",
            checked ? "left-[22px]" : "left-0.5",
          )}
        />
      </button>
    </label>
  );
}

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex flex-wrap gap-1 rounded-2xl border border-line bg-[var(--c-background)] p-1"
    >
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: styled radio buttons inside a labelled radiogroup
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "min-h-8 flex-1 rounded-xl px-3 text-[13px] font-semibold transition",
            o.value === value
              ? "bg-surface text-ink shadow-sm ring-1 ring-line"
              : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const e = error as Error;
  const issues = e instanceof ApiError ? e.issues : [];
  return (
    <div
      role="alert"
      className="rounded-xl border border-bad/30 bg-bad/10 px-3 py-2 text-[13.5px] text-ink"
    >
      <p className="font-semibold text-bad">{e.message}</p>
      {issues.length ? (
        <ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted">
          {issues.slice(0, 8).map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialogs and drawers

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current
      ?.querySelector<HTMLElement>("input, textarea, select, button:not([data-close])")
      ?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking the dimmed backdrop closes it; Escape does too
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 backdrop-blur-sm fade-in"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "card flex max-h-[90dvh] w-full flex-col overflow-hidden",
          wide ? "max-w-3xl" : "max-w-md",
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <IconButton label="Close" data-close onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    // biome-ignore lint/a11y/noStaticElementInteractions: clicking outside closes it; Escape does too
    <div
      className="fixed inset-0 z-40 flex justify-end"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside
        role="dialog"
        aria-label={title}
        className="card m-2 flex w-full max-w-[420px] flex-col overflow-hidden fade-in"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
        </div>
        <div className="grow overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Toasts

const ToastContext = createContext<(msg: string, tone?: "good" | "bad") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; msg: string; tone: "good" | "bad" }[]>([]);
  const push = useCallback((msg: string, tone: "good" | "bad" = "good") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "card pointer-events-auto px-4 py-2.5 text-sm font-semibold fade-in",
              t.tone === "bad" && "text-bad",
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
