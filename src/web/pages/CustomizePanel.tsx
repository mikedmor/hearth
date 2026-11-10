/** "Look": how this page looks, previewed live as you change it, saved after a pause. */
import { useQueryClient } from "@tanstack/react-query";
import { Check, ImageUp, Lock, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { HomeView } from "../../shared/api";
import {
  BACKGROUNDS,
  BUILTIN_THEMES,
  CLOCKS,
  DEFAULT_LOOK,
  DENSITIES,
  FONT_STACKS,
  FONTS,
  ICON_STYLES,
  type Look,
  SYSTEM_THEME,
  type Theme,
  TILE_SIZES,
  TILE_STYLES,
  WIDTHS,
} from "../../shared/themes";

import {
  Button,
  Drawer,
  ErrorNote,
  Field,
  Input,
  Segmented,
  TextArea,
  Toggle,
  useToast,
} from "../components/ui";
import { api } from "../lib/api";
import { cx } from "../lib/format";
import { applyLook } from "../lib/look";
import { keys } from "../lib/queries";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function CustomizePanel({
  open,
  onClose,
  view,
}: {
  open: boolean;
  onClose: () => void;
  view: HomeView;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [look, setLook] = useState<Look>(view.look);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<number | undefined>(undefined);
  const dirty = useRef(false);

  useEffect(() => {
    if (open) {
      setLook(view.look);
      dirty.current = false;
    }
  }, [open, view.look]);

  const update = (patch: Partial<Look>) => {
    const next = { ...look, ...patch };
    setLook(next);
    applyLook(document.documentElement, next, view.themes);
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(next), 600);
  };

  const save = async (next: Look) => {
    setError(null);
    try {
      await api.put("/api/me/look", next);
      dirty.current = false;
      await qc.invalidateQueries({ queryKey: keys.home });
    } catch (e) {
      setError(e);
    }
  };

  const close = () => {
    if (dirty.current) {
      clearTimeout(timer.current);
      void save(look);
    }
    onClose();
  };

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await api.post<{ file: string }>("/api/me/background", form);
      update({ background: "image", backgroundImage: r.file });
      toast("Background added");
    } catch (e) {
      setError(e);
    }
  };

  const themes: Theme[] = [...BUILTIN_THEMES, ...view.themes];

  return (
    <Drawer
      open={open}
      onClose={close}
      title={`Look${view.profile ? ` for ${view.profile.name}` : " for guests"}`}
    >
      <div className="grid gap-6 pb-6">
        <ErrorNote error={error} />

        <Group title="Layout">
          <Segmented
            label="Layout"
            value={look.layout}
            onChange={(v) => update({ layout: v })}
            options={[
              { value: "command", label: "Command center" },
              { value: "classic", label: "Classic" },
            ]}
          />
          <p className="text-[12.5px] text-muted">
            {look.layout === "command"
              ? "Everything on one screen: services in the middle, widgets in a side rail, favourites in a dock. On phones, swipe between Apps and Widgets."
              : "One long page of sections, in the order you arrange."}
          </p>
          {look.layout === "command" ? (
            <>
              <Segmented
                label="Services as"
                value={look.launcher}
                onChange={(v) => update({ launcher: v })}
                options={[
                  { value: "rows", label: "Rows" },
                  { value: "icons", label: "Icons" },
                  { value: "cards", label: "Cards" },
                ]}
              />
              <Segmented
                label="Widget rail"
                value={look.rail}
                onChange={(v) => update({ rail: v })}
                options={[
                  { value: "right", label: "Right" },
                  { value: "left", label: "Left" },
                  { value: "off", label: "Off" },
                ]}
              />
              {look.rail !== "off" ? (
                <Segmented
                  label="Rail width"
                  value={look.railWidth}
                  onChange={(v) => update({ railWidth: v })}
                  options={[
                    { value: "narrow", label: "Narrow rail" },
                    { value: "wide", label: "Wide rail" },
                  ]}
                />
              ) : null}
              <Toggle
                label="Favourites dock on phones"
                hint="Your favourites at the bottom of the screen, under your thumb."
                checked={look.dock}
                onChange={(v) => update({ dock: v })}
              />
            </>
          ) : null}
        </Group>

        <Group title="Theme">
          <div className="grid grid-cols-3 gap-2">
            <ThemeSwatch
              active={look.theme === SYSTEM_THEME}
              name="Follow device"
              onClick={() => update({ theme: SYSTEM_THEME })}
              colors={["#f6f1ea", "#14100e", "#e8743b"]}
            />
            {themes.map((t) => (
              <ThemeSwatch
                key={t.id}
                active={look.theme === t.id}
                name={t.name}
                onClick={() => update({ theme: t.id })}
                colors={[t.colors.background, t.colors.surface, t.colors.accent]}
              />
            ))}
          </div>
          <p className="text-[12.5px] text-muted">
            The admin can make new themes in Settings → Themes.
          </p>
        </Group>

        <Group title="Background">
          <Segmented
            label="Background"
            value={look.background}
            onChange={(v) => update({ background: v })}
            options={BACKGROUNDS.map((b) => ({ value: b, label: cap(b) }))}
          />
          {look.background !== "solid" && look.background !== "image" ? (
            <Slider
              label="Glow"
              value={look.glow}
              min={0}
              max={100}
              onChange={(v) => update({ glow: v })}
            />
          ) : null}
          {look.background === "image" ? (
            <>
              <label className="card flex cursor-pointer items-center justify-center gap-2 border-dashed px-4 py-3 text-sm font-semibold text-muted hover:text-ink">
                <ImageUp className="size-4" />{" "}
                {look.backgroundImage ? "Choose another picture" : "Choose a picture"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className="sr-only"
                  onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
                />
              </label>
              <Slider
                label="Dim"
                value={look.backgroundDim}
                min={0}
                max={90}
                onChange={(v) => update({ backgroundDim: v })}
              />
              <Slider
                label="Blur"
                value={look.backgroundBlur}
                min={0}
                max={40}
                onChange={(v) => update({ backgroundBlur: v })}
              />
            </>
          ) : null}
        </Group>

        <Group title="Tiles">
          <Segmented
            label="Tile style"
            value={look.tileStyle}
            onChange={(v) => update({ tileStyle: v })}
            options={TILE_STYLES.map((s) => ({ value: s, label: cap(s) }))}
          />
          <Segmented
            label="Tile size"
            value={look.tileSize}
            onChange={(v) => update({ tileSize: v })}
            options={TILE_SIZES.map((s) => ({
              value: s,
              label: { sm: "Small", md: "Medium", lg: "Large" }[s],
            }))}
          />
          <Segmented
            label="Icons"
            value={look.iconStyle}
            onChange={(v) => update({ iconStyle: v })}
            options={ICON_STYLES.map((s) => ({ value: s, label: cap(s) }))}
          />
          <Toggle
            label="Descriptions"
            hint="The small line under each tile's name."
            checked={look.descriptions}
            onChange={(v) => update({ descriptions: v })}
          />
        </Group>

        <Group title="Shape and space">
          <Slider
            label="Corners"
            value={look.radius}
            min={0}
            max={32}
            suffix="px"
            onChange={(v) => update({ radius: v })}
          />
          <Segmented
            label="Spacing"
            value={look.density}
            onChange={(v) => update({ density: v })}
            options={DENSITIES.map((s) => ({ value: s, label: cap(s) }))}
          />
          <Segmented
            label="Page width"
            value={look.width}
            onChange={(v) => update({ width: v })}
            options={WIDTHS.map((s) => ({ value: s, label: cap(s) }))}
          />
        </Group>

        <Group title="Type">
          <FontPicker label="Text" value={look.font} onChange={(v) => update({ font: v })} />
          <FontPicker
            label="Headings"
            value={look.headingFont}
            onChange={(v) => update({ headingFont: v })}
          />
        </Group>

        <Group title="Top of the page">
          <Toggle
            label="Greeting"
            checked={look.greeting}
            onChange={(v) => update({ greeting: v })}
          />
          <Segmented
            label="Clock"
            value={look.clock}
            onChange={(v) => update({ clock: v })}
            options={CLOCKS.map((s) => ({ value: s, label: cap(s) }))}
          />
          <Segmented
            label="Align"
            value={look.align}
            onChange={(v) => update({ align: v })}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Centre" },
            ]}
          />
        </Group>

        <Group title="Your own CSS">
          <CssEditor value={look.css} onSave={(css) => update({ css })} />
        </Group>

        {view.profile && view.canEdit ? <PinSetting hasPin={view.profile.hasPin} /> : null}

        <Button variant="ghost" onClick={() => update({ ...DEFAULT_LOOK, css: look.css })}>
          <RotateCcw className="size-4" /> Back to the standard look
        </Button>
      </div>
    </Drawer>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-[12px] font-bold uppercase tracking-[0.1em] text-muted">{title}</h3>
      {children}
    </section>
  );
}

function ThemeSwatch({
  name,
  colors,
  active,
  onClick,
}: {
  name: string;
  colors: string[];
  active: boolean;
  onClick: () => void;
}) {
  const [bg, surface, accent] = colors;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "relative overflow-hidden rounded-2xl border-2 text-left transition",
        active ? "border-accent" : "border-line hover:border-[var(--c-line-strong)]",
      )}
    >
      <span className="block h-14 p-2" style={{ background: bg }}>
        <span
          className="block h-full rounded-lg"
          style={{ background: surface, boxShadow: `inset 0 -6px 0 ${accent}` }}
        />
      </span>
      <span className="block truncate px-2 py-1.5 text-[12px] font-semibold">{name}</span>
      {active ? (
        <Check className="absolute top-1.5 right-1.5 size-4 rounded-full bg-accent p-0.5 text-white" />
      ) : null}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  suffix = "",
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="flex justify-between text-[13px] font-semibold">
        {label}{" "}
        <span className="text-muted tabular-nums">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="accent-[var(--c-accent)]"
      />
    </label>
  );
}

function FontPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Look["font"];
  onChange: (v: Look["font"]) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-[13px] font-semibold">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {FONTS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onChange(f)}
            aria-pressed={value === f}
            className={cx(
              "rounded-xl border px-2 py-2 text-[14px] transition",
              value === f
                ? "border-accent bg-accent/10"
                : "border-line hover:border-[var(--c-line-strong)]",
            )}
            style={{ fontFamily: FONT_STACKS[f] }}
          >
            {cap(f)}
          </button>
        ))}
      </div>
    </div>
  );
}

function CssEditor({ value, onSave }: { value: string; onSave: (css: string) => void }) {
  const [css, setCss] = useState(value);
  useEffect(() => setCss(value), [value]);
  return (
    <div className="grid gap-2">
      <TextArea
        value={css}
        onChange={(e) => setCss(e.target.value)}
        placeholder={".tile { border-width: 2px; }\n.card { backdrop-filter: blur(20px); }"}
        spellCheck={false}
        className="min-h-32"
        aria-label="Your own CSS"
      />
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-muted">
          Applies to your page only. It can't load anything from outside.
        </p>
        <Button size="sm" onClick={() => onSave(css)} disabled={css === value}>
          Apply
        </Button>
      </div>
    </div>
  );
}

function PinSetting({ hasPin }: { hasPin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.put("/api/me/pin", { pin: value });
      setPin("");
      toast(value ? "PIN set" : "PIN removed");
      await qc.invalidateQueries({ queryKey: keys.home });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title="PIN">
      <p className="flex items-center gap-2 text-[13px] text-muted">
        <Lock className="size-4" />{" "}
        {hasPin
          ? "Your page needs a PIN to open."
          : "Anyone can open your page. Add a PIN to keep it yours."}
      </p>
      <div className="flex gap-2">
        <Field label={hasPin ? "New PIN" : "PIN"} className="grow">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              pattern="\d{4,8}"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="4 to 8 digits"
            />
          )}
        </Field>
        <Button
          className="self-end"
          onClick={() => save(pin)}
          disabled={pin.length < 4}
          busy={busy}
        >
          Save
        </Button>
      </div>
      {hasPin ? (
        <Button variant="danger" size="sm" onClick={() => save(null)} busy={busy}>
          Remove PIN
        </Button>
      ) : null}
      <ErrorNote error={error} />
    </Group>
  );
}
