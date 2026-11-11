/**
 * Enough Markdown for chat answers: paragraphs, headings, lists, code blocks, `code`, **bold**,
 * *italic* and links. Built as React elements, never as HTML, so an answer can't inject anything.
 */
import type { ReactNode } from "react";

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r/g, "").split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).startsWith("```"))
        code.push(lines[i++] as string);
      i++;
      blocks.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-xl bg-page p-3 text-[12.5px] leading-relaxed ring-1 ring-line"
        >
          {lang ? (
            <span className="mb-1 block text-[11px] font-semibold uppercase text-muted">
              {lang}
            </span>
          ) : null}
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={key++} className="mt-3 mb-1 font-bold">
          {inline(heading[2] as string)}
        </p>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i] as string))
        items.push((lines[i++] as string).replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List
          key={key++}
          className={`my-1.5 grid gap-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((it, n) => (
            <li key={n}>{inline(it)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      (lines[i] as string).trim() &&
      !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s)/.test(lines[i] as string)
    )
      para.push(lines[i++] as string);
    blocks.push(
      <p key={key++} className="my-1.5 leading-relaxed">
        {inline(para.join("\n"))}
      </p>,
    );
  }
  return <div className="text-[15px]">{blocks}</div>;
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(re)) {
    const t = m[0];
    if ((m.index ?? 0) > last) out.push(text.slice(last, m.index));
    if (t.startsWith("`"))
      out.push(
        <code key={k++} className="rounded bg-(--c-surface-2) px-1 py-0.5 text-[0.9em]">
          {t.slice(1, -1)}
        </code>,
      );
    else if (t.startsWith("**")) out.push(<strong key={k++}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("[")) {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(t);
      out.push(
        <a
          key={k++}
          href={link?.[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-accent underline"
        >
          {link?.[1]}
        </a>,
      );
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = (m.index ?? 0) + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** An answer from a thinking model: its reasoning folded away above the answer itself. */
export function Answer({ text }: { text: string }) {
  const thoughts: string[] = [];
  let rest = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_m, t: string) => {
    if (t.trim()) thoughts.push(t.trim());
    return "";
  });
  const open = /<think>([\s\S]*)$/i.exec(rest);
  if (open) {
    if (open[1]?.trim()) thoughts.push(open[1].trim());
    rest = rest.slice(0, open.index);
  }
  return (
    <>
      {thoughts.length ? (
        <details className="mb-1.5 text-[13px] text-muted">
          <summary className="cursor-pointer select-none font-semibold">
            {open && !rest.trim() ? "Thinking…" : "Thought it through"}
          </summary>
          <div className="mt-1 border-l-2 border-line pl-3 whitespace-pre-wrap">
            {thoughts.join("\n\n")}
          </div>
        </details>
      ) : null}
      {rest.trim() ? <Markdown text={rest.trim()} /> : null}
    </>
  );
}
