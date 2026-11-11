/**
 * Files: the NAS's shared folders, as you. You connect your own NAS account once; Hearth
 * browses as you, so you see what the NAS lets you see. Each share can be mapped on a device.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Copy,
  Download,
  File,
  Folder,
  HardDrive,
  LogOut,
  MonitorSmartphone,
  Search,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { Entry, FilesStatus, Share } from "../../shared/files";
import {
  Button,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Spinner,
  useToast,
} from "../components/ui";
import { ApiError, api } from "../lib/api";
import { bytes, cx } from "../lib/format";
import { useHome } from "../lib/queries";

const STATUS = ["files"] as const;

export function FilesPage() {
  const { data: view } = useHome();
  const status = useQuery({
    queryKey: STATUS,
    queryFn: () => api.get<FilesStatus>("/api/files"),
  });
  const s = status.data;
  return (
    <main className="shell pt-6 pb-16">
      <div className="mb-5">
        <h1 className="font-heading text-3xl font-bold tracking-tight">Files</h1>
        <p className="mt-1 text-muted">
          The NAS's shared folders, as you: you see what your NAS account may.
        </p>
      </div>
      {!s ? (
        status.error ? (
          <ErrorNote error={status.error} />
        ) : (
          <Spinner />
        )
      ) : !s.configured ? (
        <p className="card p-6 text-muted">
          Files isn't set up yet.{" "}
          {view?.session.admin ? (
            <>
              Add the NAS's address in{" "}
              <Link to="/settings" className="font-semibold text-accent">
                Settings
              </Link>
              .
            </>
          ) : (
            "Ask the admin to add the NAS's address in Settings."
          )}
        </p>
      ) : !s.allowed ? (
        <p className="card p-6 text-muted">{s.reason}</p>
      ) : !s.connected ? (
        <Connect />
      ) : (
        <Browser status={s} />
      )}
    </main>
  );
}

/** Sign in with your NAS account (and its two-step code, when it asks). */
function Connect() {
  const qc = useQueryClient();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [askCode, setAskCode] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/files/connect", {
        account,
        password,
        ...(askCode && code ? { code } : {}),
      });
      setPassword("");
      await qc.invalidateQueries({ queryKey: STATUS });
    } catch (e) {
      if (e instanceof ApiError && e.data.needsCode) setAskCode(true);
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="card grid max-w-md gap-4 p-6"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <div>
        <h2 className="text-lg font-bold">Connect your NAS account</h2>
        <p className="mt-1 text-[13.5px] text-muted">
          The account you use for the NAS itself (DSM), not Hearth's. Hearth keeps it on the server,
          encrypted, and never shows it in the page.
        </p>
      </div>
      <Field label="NAS account">
        {(id) => (
          <Input
            id={id}
            autoComplete="username"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        )}
      </Field>
      <Field label="Password">
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        )}
      </Field>
      {askCode ? (
        <Field label="Code" hint="From your authenticator app. The NAS then trusts Hearth.">
          {(id) => (
            <Input
              id={id}
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            />
          )}
        </Field>
      ) : null}
      {error ? <ErrorNote error={error} /> : null}
      <Button variant="primary" type="submit" busy={busy} disabled={!account || !password}>
        Connect
      </Button>
    </form>
  );
}

/** Shares, then folders: breadcrumbs, a filter, and a download for each file. */
function Browser({ status }: { status: FilesStatus }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [path, setPath] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [mapping, setMapping] = useState<Share | null>(null);
  const shares = useQuery({
    queryKey: ["files", "shares"],
    queryFn: () => api.get<{ shares: Share[] }>("/api/files/shares"),
  });
  const list = useQuery({
    queryKey: ["files", "list", path],
    queryFn: () =>
      api.get<{ entries: Entry[]; total: number }>(
        `/api/files/list?path=${encodeURIComponent(path ?? "/")}`,
      ),
    enabled: path !== null,
  });
  const open = (p: string | null) => {
    setPath(p);
    setQ("");
  };
  const parts = path ? path.split("/").filter(Boolean) : [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list.data?.entries ?? []).filter(
      (e) => !needle || e.name.toLowerCase().includes(needle),
    );
  }, [list.data, q]);
  const disconnect = async () => {
    await api.del("/api/files/connect");
    toast("Disconnected from the NAS");
    await qc.invalidateQueries({ queryKey: ["files"] });
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
        <HardDrive className="size-4" />
        Signed in to the NAS as <b className="text-ink">{status.account}</b>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void disconnect()}>
          <LogOut className="size-4" /> Disconnect
        </Button>
      </div>

      <nav aria-label="Folder" className="flex flex-wrap items-center gap-1 text-[14px]">
        <button
          type="button"
          onClick={() => open(null)}
          className={cx("rounded-lg px-2 py-1 font-semibold", path ? "text-accent" : "text-ink")}
        >
          Shares
        </button>
        {parts.map((name, i) => {
          const to = `/${parts.slice(0, i + 1).join("/")}`;
          const last = i === parts.length - 1;
          return (
            <span key={to} className="flex items-center gap-1">
              <ChevronRight className="size-4 text-muted" />
              <button
                type="button"
                onClick={() => open(to)}
                disabled={last}
                className={cx(
                  "rounded-lg px-2 py-1 font-semibold",
                  last ? "text-ink" : "text-accent",
                )}
              >
                {name}
              </button>
            </span>
          );
        })}
      </nav>

      {path === null ? (
        shares.error ? (
          <ErrorNote error={shares.error} />
        ) : !shares.data ? (
          <Spinner />
        ) : shares.data.shares.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {shares.data.shares.map((sh) => (
              <li key={sh.path} className="card flex items-center gap-3 p-3">
                <button
                  type="button"
                  onClick={() => open(sh.path)}
                  className="flex min-w-0 grow items-center gap-3 text-left"
                >
                  <span className="grid size-10 flex-none place-items-center rounded-xl bg-accent/12 text-accent">
                    <Folder className="size-5" />
                  </span>
                  <span className="grid min-w-0">
                    <span className="truncate font-semibold">{sh.name}</span>
                    <span className="text-[12px] text-muted">
                      {sh.readOnly ? "You can look, not change" : "Shared folder"}
                    </span>
                  </span>
                </button>
                <Button size="sm" onClick={() => setMapping(sh)}>
                  <MonitorSmartphone className="size-4" /> Map
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="card p-6 text-muted">Your NAS account can't open any shared folders.</p>
        )
      ) : list.error ? (
        <ErrorNote error={list.error} />
      ) : !list.data ? (
        <Spinner />
      ) : (
        <div className="card p-2">
          <div className="flex items-center gap-2 p-2">
            <Search className="size-4 text-muted" />
            <input
              aria-label="Find in this folder"
              placeholder="Find in this folder"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-9 grow bg-transparent text-[14px] outline-none"
            />
            <span className="text-[12px] text-muted">
              {list.data.total.toLocaleString()} item{list.data.total === 1 ? "" : "s"}
            </span>
          </div>
          <ul className="divide-y divide-line">
            {shown.map((e) => (
              <li key={e.path} className="flex items-center gap-3 px-2 py-1.5">
                {e.dir ? (
                  <button
                    type="button"
                    onClick={() => open(e.path)}
                    className="flex min-w-0 grow items-center gap-3 rounded-lg py-1 text-left hover:text-accent"
                  >
                    <Folder className="size-5 flex-none text-accent" />
                    <span className="truncate font-semibold">{e.name}</span>
                  </button>
                ) : (
                  <a
                    href={`/api/files/download?path=${encodeURIComponent(e.path)}`}
                    download={e.name}
                    className="flex min-w-0 grow items-center gap-3 rounded-lg py-1 hover:text-accent"
                  >
                    <File className="size-5 flex-none text-muted" />
                    <span className="truncate">{e.name}</span>
                  </a>
                )}
                <span className="hidden flex-none text-[12px] text-muted tabular-nums sm:block">
                  {e.mtime ? new Date(e.mtime * 1000).toLocaleDateString() : ""}
                </span>
                <span className="w-20 flex-none text-right text-[12px] text-muted tabular-nums">
                  {e.dir ? "" : bytes(e.size)}
                </span>
                <a
                  href={`/api/files/download?path=${encodeURIComponent(e.path)}`}
                  download={e.dir ? `${e.name}.zip` : e.name}
                  aria-label={e.dir ? `Download ${e.name} as a zip` : `Download ${e.name}`}
                  title={e.dir ? "Download as a zip" : "Download"}
                  className="grid size-8 flex-none place-items-center rounded-full text-muted hover:bg-(--c-surface-2) hover:text-ink"
                >
                  <Download className="size-4" />
                </a>
              </li>
            ))}
            {shown.length ? null : (
              <li className="px-2 py-6 text-center text-[13px] text-muted">
                {q ? "Nothing called that here." : "This folder is empty."}
              </li>
            )}
          </ul>
        </div>
      )}

      {mapping ? (
        <MapShare
          share={mapping}
          host={status.smbHost ?? "nas"}
          account={status.account}
          onClose={() => setMapping(null)}
        />
      ) : null}
    </div>
  );
}

type Device = "windows" | "mac" | "iphone" | "android";

/** How to reach a share from a device: the steps, the address, and for Windows a ready script. */
function MapShare({
  share,
  host,
  account,
  onClose,
}: {
  share: Share;
  host: string;
  account?: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [device, setDevice] = useState<Device>(guessDevice());
  const [letter, setLetter] = useState("Z");
  const name = share.path.replace(/^\//, "");
  const unc = `\\\\${host}\\${name}`;
  const smb = `smb://${host}/${encodeURI(name)}`;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied");
    } catch {
      toast("Couldn't copy: select it and copy it yourself", "bad");
    }
  };
  const script = [
    "@echo off",
    `rem Maps the NAS's "${name}" share as ${letter}: (made by Hearth).`,
    `rem Windows asks for your NAS password the first time and can remember it.`,
    `net use ${letter}: "${unc}"${account ? ` /user:${account}` : ""} /persistent:yes`,
    `if errorlevel 1 pause & exit /b 1`,
    `start "" ${letter}:\\`,
    "",
  ].join("\r\n");
  const saveScript = () => {
    const url = URL.createObjectURL(new Blob([script], { type: "application/octet-stream" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-${name}.bat`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <Modal open onClose={onClose} title={`Map "${share.name}" on a device`}>
      <div className="grid gap-4">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["windows", "Windows"],
              ["mac", "Mac"],
              ["iphone", "iPhone, iPad"],
              ["android", "Android"],
            ] as const
          ).map(([d, label]) => (
            <button
              key={d}
              type="button"
              aria-pressed={device === d}
              onClick={() => setDevice(d)}
              className={cx(
                "h-8 rounded-full px-3 text-[13px] font-semibold",
                device === d
                  ? "bg-accent text-white"
                  : "border border-line text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-muted">
          Sign in with your NAS account{account ? ` (${account})` : ""} when it asks. The device
          must be on the home network.
        </p>
        {device === "windows" ? (
          <div className="grid gap-3 text-[14px]">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Drive letter">
                {(id) => (
                  <Select id={id} value={letter} onChange={(e) => setLetter(e.target.value)}>
                    {"ZYXWVUTSRQPONMLKJIHGFE".split("").map((l) => (
                      <option key={l} value={l}>
                        {l}:
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button variant="primary" onClick={saveScript}>
                <Download className="size-4" /> Download the script
              </Button>
            </div>
            <p className="text-muted">
              Run the script (double-click it) and the share shows up as {letter}: in File Explorer,
              every time you sign in. Or do it by hand: File Explorer → This PC → Map network drive,
              and paste:
            </p>
            <Address text={unc} onCopy={copy} />
          </div>
        ) : device === "mac" ? (
          <div className="grid gap-3 text-[14px]">
            <p className="text-muted">
              In Finder, choose Go → Connect to Server (⌘K), paste this, and press Connect. Add it
              to Favorites to keep it in the sidebar.
            </p>
            <Address text={smb} onCopy={copy} />
          </div>
        ) : device === "iphone" ? (
          <div className="grid gap-3 text-[14px]">
            <p className="text-muted">
              In the Files app, open Browse, tap ⋯ at the top, then Connect to Server. Paste this,
              and choose Registered User.
            </p>
            <Address text={smb} onCopy={copy} />
          </div>
        ) : (
          <div className="grid gap-3 text-[14px]">
            <p className="text-muted">
              Android has no built-in way to open a shared folder. A file manager with network
              shares does it (Material Files, CX File Explorer, Solid Explorer): add an SMB share
              with the NAS's name and the share, and sign in.
            </p>
            <Address text={host} onCopy={copy} />
            <Address text={name} onCopy={copy} />
          </div>
        )}
      </div>
    </Modal>
  );
}

/** An address to paste, with a copy button. */
function Address({ text, onCopy }: { text: string; onCopy: (text: string) => Promise<void> }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-(--c-surface-2) px-3 py-2">
      <code className="grow truncate text-[13.5px]">{text}</code>
      <IconButton label="Copy" className="size-7" onClick={() => void onCopy(text)}>
        <Copy className="size-3.5" />
      </IconButton>
    </div>
  );
}

function guessDevice(): Device {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iphone|ipad/i.test(ua)) return "iphone";
  if (/mac os/i.test(ua)) return "mac";
  return "windows";
}
