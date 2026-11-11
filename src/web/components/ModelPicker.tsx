import { useId } from "react";
import type { AiModel } from "../../shared/api";
import { cx } from "../lib/format";

/**
 * A model name: pick one the server listed, or type any other (a server that's busy or needs its
 * key can't list its models, but can still be asked by name).
 */
export function ModelPicker({
  value,
  onChange,
  models,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  models: AiModel[];
  className?: string;
}) {
  const listId = useId();
  return (
    <>
      <input
        aria-label="Model"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Model name"
        spellCheck={false}
        className={cx(
          "rounded-xl border border-line bg-page px-3 text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none",
          className,
        )}
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m.name} value={m.name} />
        ))}
      </datalist>
    </>
  );
}
