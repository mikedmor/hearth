/**
 * Formulas for custom widgets: `round($nas.cpu.load, 1)`, `$plex.sessions > 0 ? "On" : "Off"`,
 * and templates like `"{{ $nas.temp }} °C"`.
 *
 * A small parser and evaluator, never `eval`: only the operators and functions below exist, member
 * access reads own data properties only, and size, depth and work are capped. Widgets are run on
 * the server, so a browser only ever gets the finished values.
 */

export const MAX_EXPR_LENGTH = 2000;
const MAX_DEPTH = 48;
const MAX_ARRAY = 10_000;
const MAX_STEPS = 200_000;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export class ExprError extends Error {
  constructor(
    message: string,
    readonly at?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Tokens

type Tok =
  | { t: "num"; v: number; at: number }
  | { t: "str"; v: string; at: number }
  | { t: "id"; v: string; at: number }
  | { t: "ref"; v: string; at: number }
  | { t: "op"; v: string; at: number }
  | { t: "end"; at: number };

const OPS = [
  "??",
  "==",
  "!=",
  "<=",
  ">=",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  ">",
  "!",
  "?",
  ":",
  "(",
  ")",
  "[",
  "]",
  ",",
  ".",
];

function tokenize(src: string): Tok[] {
  if (src.length > MAX_EXPR_LENGTH)
    throw new ExprError(`Formula is longer than ${MAX_EXPR_LENGTH} characters`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      const text = m?.[0] ?? c;
      out.push({ t: "num", v: Number(text), at });
      i += text.length;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = "";
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === "\\" && i + 1 < src.length) {
          const n = src[i + 1] as string;
          s += n === "n" ? "\n" : n === "t" ? "\t" : n;
          i += 2;
        } else s += src[i++];
      }
      if (src[i] !== c) throw new ExprError("A text value is missing its closing quote", at);
      i++;
      out.push({ t: "str", v: s, at });
      continue;
    }
    if (c === "$") {
      const m = /^\$([A-Za-z_][\w-]*)/.exec(src.slice(i));
      if (!m) throw new ExprError("$ must be followed by a name, like $nas", at);
      out.push({ t: "ref", v: m[1] as string, at });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: "id", v: m[0], at });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Unexpected "${c}"`, at);
    out.push({ t: "op", v: op, at });
    i += op.length;
  }
  out.push({ t: "end", at: src.length });
  return out;
}

// ---------------------------------------------------------------------------
// Syntax tree

export type Node =
  | { k: "lit"; v: unknown }
  | { k: "ref"; name: string }
  | { k: "member"; obj: Node; key: Node }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "unary"; op: string; arg: Node }
  | { k: "binary"; op: string; a: Node; b: Node }
  | { k: "cond"; test: Node; yes: Node; no: Node }
  | { k: "array"; items: Node[] };

const BINARY: Record<string, number> = {
  "??": 1,
  "||": 2,
  "&&": 3,
  "==": 4,
  "!=": 4,
  "<": 5,
  "<=": 5,
  ">": 5,
  ">=": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "%": 7,
};

export function parse(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  let depth = 0;
  const peek = () => toks[p] as Tok;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === "op" && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Expected "${v}"`, peek().at);
    p++;
  };

  const expr = (minPrec = 0): Node => {
    if (++depth > MAX_DEPTH) throw new ExprError("Formula is nested too deeply");
    let left = unary();
    for (;;) {
      const t = peek();
      if (t.t === "op" && t.v === "?" && minPrec === 0) {
        p++;
        const yes = expr();
        expect(":");
        const no = expr();
        left = { k: "cond", test: left, yes, no };
        continue;
      }
      const prec = t.t === "op" ? BINARY[t.v] : undefined;
      if (prec === undefined || prec <= minPrec - 1 || prec < minPrec) break;
      p++;
      const right = expr(prec + 1);
      left = { k: "binary", op: (t as { v: string }).v, a: left, b: right };
    }
    depth--;
    return left;
  };

  const unary = (): Node => {
    if (isOp("!") || isOp("-")) {
      const op = (toks[p++] as { v: string }).v;
      return { k: "unary", op, arg: unary() };
    }
    return postfix(primary());
  };

  const postfix = (node: Node): Node => {
    for (;;) {
      if (isOp(".")) {
        p++;
        const t = peek();
        if (t.t !== "id" && t.t !== "num") throw new ExprError('Expected a name after "."', t.at);
        p++;
        node = { k: "member", obj: node, key: { k: "lit", v: String(t.v) } };
      } else if (isOp("[")) {
        p++;
        const key = expr();
        expect("]");
        node = { k: "member", obj: node, key };
      } else return node;
    }
  };

  const primary = (): Node => {
    const t = peek();
    p++;
    switch (t.t) {
      case "num":
      case "str":
        return { k: "lit", v: t.v };
      case "ref":
        return { k: "ref", name: t.v };
      case "id": {
        if (t.v === "true") return { k: "lit", v: true };
        if (t.v === "false") return { k: "lit", v: false };
        if (t.v === "null") return { k: "lit", v: null };
        if (!isOp("(")) {
          throw new ExprError(`"${t.v}" isn't known. Values start with $, like $${t.v}`, t.at);
        }
        if (!(t.v in FUNCTIONS)) throw new ExprError(`There's no function called ${t.v}()`, t.at);
        p++;
        const args: Node[] = [];
        if (!isOp(")")) {
          do args.push(expr());
          while (isOp(",") && ++p);
        }
        expect(")");
        return { k: "call", fn: t.v, args };
      }
      case "op":
        if (t.v === "(") {
          const inner = expr();
          expect(")");
          return inner;
        }
        if (t.v === "[") {
          const items: Node[] = [];
          if (!isOp("]")) {
            do items.push(expr());
            while (isOp(",") && ++p);
          }
          expect("]");
          return { k: "array", items };
        }
        throw new ExprError(`Unexpected "${t.v}"`, t.at);
      case "end":
        throw new ExprError("The formula ends too soon", t.at);
    }
  };

  const node = expr();
  if (peek().t !== "end")
    throw new ExprError(`Unexpected "${String((peek() as { v?: unknown }).v ?? "")}"`, peek().at);
  return node;
}

// ---------------------------------------------------------------------------
// Evaluation

export interface ExprContext {
  /** `$name` values. */
  vars: Record<string, unknown>;
  locale?: string;
  timeZone?: string;
  now?: () => number;
}

interface Run {
  ctx: ExprContext;
  steps: number;
}

export function evaluate(node: Node, ctx: ExprContext): unknown {
  return ev(node, { ctx, steps: 0 });
}

/** Parse and run in one go. Throws ExprError with a readable message. */
export function run(src: string, ctx: ExprContext): unknown {
  return evaluate(parse(src), ctx);
}

function ev(n: Node, r: Run): unknown {
  if (++r.steps > MAX_STEPS) throw new ExprError("The formula does too much work");
  switch (n.k) {
    case "lit":
      return n.v;
    case "ref":
      return Object.hasOwn(r.ctx.vars, n.name) ? r.ctx.vars[n.name] : undefined;
    case "array":
      return n.items.map((i) => ev(i, r));
    case "member":
      return member(ev(n.obj, r), ev(n.key, r));
    case "unary": {
      const v = ev(n.arg, r);
      return n.op === "!" ? !truthy(v) : -num(v);
    }
    case "cond":
      return truthy(ev(n.test, r)) ? ev(n.yes, r) : ev(n.no, r);
    case "binary": {
      if (n.op === "&&") {
        const a = ev(n.a, r);
        return truthy(a) ? ev(n.b, r) : a;
      }
      if (n.op === "||") {
        const a = ev(n.a, r);
        return truthy(a) ? a : ev(n.b, r);
      }
      if (n.op === "??") {
        const a = ev(n.a, r);
        return a === null || a === undefined ? ev(n.b, r) : a;
      }
      const a = ev(n.a, r);
      const b = ev(n.b, r);
      switch (n.op) {
        case "+":
          return typeof a === "string" || typeof b === "string"
            ? `${str(a)}${str(b)}`
            : num(a) + num(b);
        case "-":
          return num(a) - num(b);
        case "*":
          return num(a) * num(b);
        case "/":
          return num(b) === 0 ? null : num(a) / num(b);
        case "%":
          return num(b) === 0 ? null : num(a) % num(b);
        case "==":
          return loose(a) === loose(b);
        case "!=":
          return loose(a) !== loose(b);
        case "<":
          return compare(a, b) < 0;
        case "<=":
          return compare(a, b) <= 0;
        case ">":
          return compare(a, b) > 0;
        case ">=":
          return compare(a, b) >= 0;
      }
      throw new ExprError(`Unknown operator ${n.op}`);
    }
    case "call": {
      const fn = FUNCTIONS[n.fn] as Fn;
      const args = n.args.map((a) => ev(a, r));
      return fn.run(args, r);
    }
  }
}

function member(obj: unknown, key: unknown): unknown {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) {
    if (key === "length") return obj.length;
    const i = Number(key);
    if (!Number.isInteger(i)) return undefined;
    return obj[i < 0 ? obj.length + i : i];
  }
  if (typeof obj === "string" && key === "length") return obj.length;
  if (typeof obj !== "object") return undefined;
  const k = String(key);
  if (BLOCKED_KEYS.has(k) || !Object.hasOwn(obj, k)) return undefined;
  return (obj as Record<string, unknown>)[k];
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isNaN(n) ? Number.NaN : n;
  }
  return Number.NaN;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function loose(v: unknown): unknown {
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return v ?? null;
}

function compare(a: unknown, b: unknown): number {
  const x = num(a);
  const y = num(b);
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  return str(a).localeCompare(str(b));
}

const list = (v: unknown): unknown[] => {
  if (!Array.isArray(v)) return v === null || v === undefined ? [] : [v];
  if (v.length > MAX_ARRAY) return v.slice(0, MAX_ARRAY);
  return v;
};

const field = (item: unknown, f: unknown): unknown =>
  f === undefined || f === null || f === ""
    ? item
    : String(f)
        .split(".")
        .reduce<unknown>((o, k) => member(o, k), item);

const nums = (arr: unknown, f?: unknown) =>
  list(arr)
    .map((x) => num(field(x, f)))
    .filter((x) => !Number.isNaN(x));

// ---------------------------------------------------------------------------
// Functions

interface Fn {
  args: string;
  doc: string;
  run: (a: unknown[], r: Run) => unknown;
}

const fmtNumber = (x: number, digits: number, r: Run) =>
  new Intl.NumberFormat(r.ctx.locale ?? "en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(x);

const toTime = (v: unknown): number | null => {
  if (typeof v === "number") return v < 1e12 ? v * 1000 : v; // seconds or ms
  if (typeof v === "string" && v) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

export const FUNCTIONS: Record<string, Fn> = {
  round: {
    args: "x, digits?",
    doc: "Round to so many decimals.",
    run: ([x, d]) => {
      const n = num(x);
      const f = 10 ** Math.max(0, Math.min(10, num(d ?? 0) || 0));
      return Number.isNaN(n) ? null : Math.round(n * f) / f;
    },
  },
  floor: { args: "x", doc: "Round down.", run: ([x]) => Math.floor(num(x)) },
  ceil: { args: "x", doc: "Round up.", run: ([x]) => Math.ceil(num(x)) },
  abs: { args: "x", doc: "Without its sign.", run: ([x]) => Math.abs(num(x)) },
  min: {
    args: "a, b… or list",
    doc: "The smallest.",
    run: (a) => {
      const v = a.length === 1 ? nums(a[0]) : nums(a);
      return v.length ? Math.min(...v) : null;
    },
  },
  max: {
    args: "a, b… or list",
    doc: "The largest.",
    run: (a) => {
      const v = a.length === 1 ? nums(a[0]) : nums(a);
      return v.length ? Math.max(...v) : null;
    },
  },
  clamp: {
    args: "x, low, high",
    doc: "Keep x between low and high.",
    run: ([x, lo, hi]) => Math.min(num(hi), Math.max(num(lo), num(x))),
  },
  sum: {
    args: "list, field?",
    doc: "Add up a list (or one field of each item).",
    run: ([l, f]) => nums(l, f).reduce((s, x) => s + x, 0),
  },
  avg: {
    args: "list, field?",
    doc: "The average.",
    run: ([l, f]) => {
      const v = nums(l, f);
      return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    },
  },
  count: { args: "list", doc: "How many items.", run: ([l]) => list(l).length },
  len: {
    args: "list or text",
    doc: "Length of a list or text.",
    run: ([x]) => (typeof x === "string" ? x.length : list(x).length),
  },
  pct: {
    args: "part, whole",
    doc: "part as a percentage of whole.",
    run: ([a, b]) => (num(b) ? (num(a) / num(b)) * 100 : null),
  },
  pluck: {
    args: "list, field",
    doc: "One field from each item.",
    run: ([l, f]) => list(l).map((x) => field(x, f)),
  },
  first: { args: "list", doc: "The first item.", run: ([l]) => list(l)[0] },
  last: { args: "list", doc: "The last item.", run: ([l]) => list(l).at(-1) },
  take: {
    args: "list, n",
    doc: "The first n items (negative: the last n).",
    run: ([l, n]) => {
      const k = num(n);
      return k < 0 ? list(l).slice(k) : list(l).slice(0, k);
    },
  },
  sort: {
    args: 'list, field?, "asc"|"desc"',
    doc: "Sort a list.",
    run: ([l, f, dir]) => {
      const sign = dir === "desc" ? -1 : 1;
      return [...list(l)].sort((a, b) => sign * compare(field(a, f), field(b, f)));
    },
  },
  filter: {
    args: "list, field, op, value",
    doc: "Items where field op value (op: ==, !=, <, >, <=, >=, contains).",
    run: ([l, f, op, v]) =>
      list(l).filter((x) => {
        const a = field(x, f);
        switch (op) {
          case "==":
            return loose(a) === loose(v);
          case "!=":
            return loose(a) !== loose(v);
          case "<":
            return compare(a, v) < 0;
          case "<=":
            return compare(a, v) <= 0;
          case ">":
            return compare(a, v) > 0;
          case ">=":
            return compare(a, v) >= 0;
          case "contains":
            return str(a).toLowerCase().includes(str(v).toLowerCase());
          default:
            throw new ExprError(`filter() doesn't know the operator "${str(op)}"`);
        }
      }),
  },
  find: {
    args: "list, field, value",
    doc: "The first item whose field equals value.",
    run: ([l, f, v]) => list(l).find((x) => loose(field(x, f)) === loose(v)),
  },
  keys: {
    args: "object",
    doc: "An object's names.",
    run: ([o]) =>
      o && typeof o === "object" && !Array.isArray(o)
        ? Object.keys(o).filter((k) => !BLOCKED_KEYS.has(k))
        : [],
  },
  values: {
    args: "object",
    doc: "An object's values.",
    run: ([o]) =>
      o && typeof o === "object"
        ? Object.entries(o)
            .filter(([k]) => !BLOCKED_KEYS.has(k))
            .map(([, v]) => v)
        : [],
  },
  entries: {
    args: "object",
    doc: "An object as a list of {key, value}.",
    run: ([o]) =>
      o && typeof o === "object" && !Array.isArray(o)
        ? Object.entries(o)
            .filter(([k]) => !BLOCKED_KEYS.has(k))
            .map(([key, value]) => ({ key, value }))
        : [],
  },
  join: {
    args: "list, separator?",
    doc: "Join a list into text.",
    run: ([l, s]) =>
      list(l)
        .map(str)
        .join(s === undefined ? ", " : str(s)),
  },
  split: {
    args: "text, separator",
    doc: "Split text into a list.",
    run: ([t, s]) => str(t).split(str(s)),
  },
  upper: { args: "text", doc: "UPPER CASE.", run: ([t]) => str(t).toUpperCase() },
  lower: { args: "text", doc: "lower case.", run: ([t]) => str(t).toLowerCase() },
  trim: { args: "text", doc: "Without spaces at the ends.", run: ([t]) => str(t).trim() },
  replace: {
    args: "text, find, with",
    doc: "Replace every find with with.",
    run: ([t, a, b]) => str(t).split(str(a)).join(str(b)),
  },
  contains: {
    args: "text or list, value",
    doc: "Whether it contains value.",
    run: ([h, n]) =>
      Array.isArray(h)
        ? h.some((x) => loose(x) === loose(n))
        : str(h).toLowerCase().includes(str(n).toLowerCase()),
  },
  number: {
    args: "x",
    doc: "As a number.",
    run: ([x]) => {
      const n = num(x);
      return Number.isNaN(n) ? null : n;
    },
  },
  text: { args: "x", doc: "As text.", run: ([x]) => str(x) },
  default: {
    args: "x, fallback",
    doc: "x, or fallback when x is missing or empty.",
    run: ([x, f]) => (x === null || x === undefined || x === "" ? f : x),
  },
  if: {
    args: "test, yes, no",
    doc: "yes when test holds, otherwise no.",
    run: ([t, y, n]) => (truthy(t) ? y : n),
  },
  fmt: {
    args: "x, digits?",
    doc: "A number with thousands separators: 12,345.6",
    run: ([x, d], r) => {
      const n = num(x);
      return Number.isNaN(n) ? "—" : fmtNumber(n, num(d ?? 1) || 0, r);
    },
  },
  bytes: {
    args: "x, digits?",
    doc: "A size in bytes as 1.2 GB.",
    run: ([x, d], r) => {
      let n = num(x);
      if (Number.isNaN(n)) return "—";
      const units = ["B", "KB", "MB", "GB", "TB", "PB"];
      let u = 0;
      while (Math.abs(n) >= 1024 && u < units.length - 1) {
        n /= 1024;
        u++;
      }
      return `${fmtNumber(n, u === 0 ? 0 : num(d ?? 1), r)} ${units[u]}`;
    },
  },
  duration: {
    args: "seconds",
    doc: "A length of time as 3h 12m.",
    run: ([x]) => {
      const s = Math.max(0, Math.round(num(x)));
      if (Number.isNaN(s)) return "—";
      const d = Math.floor(s / 86400);
      const h = Math.floor((s % 86400) / 3600);
      const m = Math.floor((s % 3600) / 60);
      if (d) return `${d}d ${h}h`;
      if (h) return `${h}h ${m}m`;
      if (m) return `${m}m`;
      return `${s}s`;
    },
  },
  ago: {
    args: "time",
    doc: "How long ago a time was: 5 min ago.",
    run: ([t], r) => {
      const at = toTime(t);
      if (at === null) return "—";
      const secs = Math.round(((r.ctx.now ?? Date.now)() - at) / 1000);
      const rtf = new Intl.RelativeTimeFormat(r.ctx.locale ?? "en-US", {
        numeric: "auto",
        style: "short",
      });
      const abs = Math.abs(secs);
      if (abs < 60) return rtf.format(-secs, "second");
      if (abs < 3600) return rtf.format(-Math.round(secs / 60), "minute");
      if (abs < 86400) return rtf.format(-Math.round(secs / 3600), "hour");
      return rtf.format(-Math.round(secs / 86400), "day");
    },
  },
  time: {
    args: "time",
    doc: "The time of day: 2:05 PM.",
    run: ([t], r) => {
      const at = toTime(t);
      return at === null
        ? "—"
        : new Date(at).toLocaleTimeString(r.ctx.locale ?? "en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: r.ctx.timeZone,
          });
    },
  },
  date: {
    args: "time",
    doc: "The date: Nov 10.",
    run: ([t], r) => {
      const at = toTime(t);
      return at === null
        ? "—"
        : new Date(at).toLocaleDateString(r.ctx.locale ?? "en-US", {
            month: "short",
            day: "numeric",
            timeZone: r.ctx.timeZone,
          });
    },
  },
  now: {
    args: "",
    doc: "The time now, in milliseconds.",
    run: (_a, r) => (r.ctx.now ?? Date.now)(),
  },
  json: {
    args: "text",
    doc: "Read text that holds JSON (an API that wraps its answer in a string).",
    run: ([t]) => {
      if (typeof t !== "string") return t ?? null;
      try {
        return JSON.parse(t);
      } catch {
        return null;
      }
    },
  },
  flat: {
    args: "list of lists",
    doc: "One list from a list of lists.",
    run: ([l]) =>
      list(l)
        .flatMap((x) => (Array.isArray(x) ? x : [x]))
        .slice(0, MAX_ARRAY),
  },
  money: {
    args: "amount, currency?",
    doc: 'An amount of money: $1,234.56 (a currency like "EUR"; dollars by default).',
    run: ([x, c], r) => {
      const n = num(x);
      if (Number.isNaN(n)) return "—";
      try {
        return new Intl.NumberFormat(r.ctx.locale ?? "en-US", {
          style: "currency",
          currency: typeof c === "string" && c ? c : "USD",
        }).format(n);
      } catch {
        return fmtNumber(n, 2, r);
      }
    },
  },
  wmo: {
    args: "code",
    doc: "A weather code (WMO, as Open-Meteo gives it) in words, with an emoji: ☀️ Clear.",
    run: ([c]) => {
      const w = weather(num(c));
      return `${w[0]} ${w[1]}`;
    },
  },
  wmoIcon: {
    args: "code",
    doc: "A weather code's emoji.",
    run: ([c]) => weather(num(c))[0],
  },
};

function weather(code: number): [string, string] {
  if (code === 0) return ["☀️", "Clear"];
  if (code === 1) return ["🌤️", "Mainly clear"];
  if (code === 2) return ["⛅", "Partly cloudy"];
  if (code === 3) return ["☁️", "Overcast"];
  if (code === 45 || code === 48) return ["🌫️", "Fog"];
  if (code >= 51 && code <= 57) return ["🌦️", "Drizzle"];
  if (code >= 61 && code <= 67) return ["🌧️", "Rain"];
  if (code >= 71 && code <= 77) return ["🌨️", "Snow"];
  if (code >= 80 && code <= 82) return ["🌦️", "Showers"];
  if (code === 85 || code === 86) return ["🌨️", "Snow showers"];
  if (code >= 95) return ["⛈️", "Thunderstorm"];
  return ["🌡️", "—"];
}

// ---------------------------------------------------------------------------
// Templates

const TEMPLATE = /\{\{([\s\S]+?)\}\}/g;

/** Check a template's formulas; returns the first problem, or null. */
export function checkTemplate(text: string): string | null {
  for (const m of text.matchAll(TEMPLATE)) {
    try {
      parse(m[1] as string);
    } catch (e) {
      return `{{${(m[1] as string).trim()}}}: ${(e as Error).message}`;
    }
  }
  return null;
}

/** Fill `{{ formula }}` parts of a text. A failing part shows as "—". */
export function fillTemplate(text: string, ctx: ExprContext): string {
  return text.replace(TEMPLATE, (_m, src: string) => {
    try {
      return display(run(src, ctx), ctx);
    } catch {
      return "—";
    }
  });
}

/** How a value reads on a card. */
export function display(v: unknown, ctx: Pick<ExprContext, "locale"> = {}): string {
  if (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v))) return "—";
  if (typeof v === "number") {
    return new Intl.NumberFormat(ctx.locale ?? "en-US", {
      maximumFractionDigits: Math.abs(v) < 10 ? 2 : 1,
    }).format(v);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map((x) => display(x, ctx)).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function toNumber(v: unknown): number | null {
  const n = num(v);
  return Number.isFinite(n) ? n : null;
}
