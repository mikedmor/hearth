/**
 * start.home/trust: getting a device to trust the home's own certificate, so `.home` sites open
 * with a padlock instead of a warning. The steps for the device it's opened on, the download, the
 * fingerprint to compare, a QR code to open it on a phone, and a live check.
 */
import {
  CircleCheck,
  CircleHelp,
  Download,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { Button, Segmented } from "../components/ui";
import { cx } from "../lib/format";
import { type Platform, platformOf, useTrusted, useTrustInfo } from "../lib/trust";

const PLATFORMS: { value: Platform; label: string }[] = [
  { value: "iphone", label: "iPhone / iPad" },
  { value: "android", label: "Android" },
  { value: "windows", label: "Windows" },
  { value: "mac", label: "Mac" },
  { value: "chromeos", label: "Chromebook" },
  { value: "linux", label: "Linux" },
];

const CRT = "/trust/home-root-ca.crt";
const PROFILE = "/trust/home-certificate.mobileconfig";

function Get({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      download
      className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-white hover:brightness-110"
    >
      <Download className="size-4" /> {children}
    </a>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-(--c-surface-2) px-3 py-2 text-[12.5px] leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="grid gap-3">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 text-[14px]">
          <span className="grid size-6 flex-none place-items-center rounded-full bg-accent/15 text-[12.5px] font-bold text-accent">
            {i + 1}
          </span>
          <div className="grid min-w-0 gap-2 pt-0.5">{s}</div>
        </li>
      ))}
    </ol>
  );
}

/** A list of steps (passed one by one, so they need no keys). */
const steps = (...items: ReactNode[]): ReactNode[] => items;

function stepsFor(p: Platform, name: string): ReactNode[] {
  switch (p) {
    case "iphone":
      return steps(
        <>
          <span>
            In <b>Safari</b> (other browsers can't install it), download the profile and press{" "}
            <b>Allow</b>.
          </span>
          <Get href={PROFILE}>Download the profile</Get>
        </>,
        <span>
          Open <b>Settings</b>: <b>Profile Downloaded</b> is near the top (or General → VPN &amp;
          Device Management). Press <b>Install</b>, type your passcode, and <b>Install</b> again. It
          says "Not Verified": that's expected for a home's own certificate.
        </span>,
        <span>
          Then <b>Settings → General → About → Certificate Trust Settings</b>, and turn on{" "}
          <b>{name}</b>. Without this step it's installed but not trusted.
        </span>,
        <span>Come back to this page: the check at the top turns green.</span>,
      );
    case "android":
      return steps(
        <>
          <span>Download the certificate.</span>
          <Get href={CRT}>Download the certificate</Get>
        </>,
        <span>
          Open <b>Settings</b> and search for <b>CA certificate</b> (usually Security &amp; privacy
          → More security settings → Encryption &amp; credentials → Install a certificate →{" "}
          <b>CA certificate</b>). Press <b>Install anyway</b> and choose <b>home-root-ca.crt</b>{" "}
          from Downloads.
        </span>,
        <span>
          Chrome trusts it straight away. In <b>Firefox</b>: Settings → About Firefox, tap the logo
          five times, then Settings → Secret settings → turn on{" "}
          <b>Use third party CA certificates</b>.
        </span>,
        <span>
          Android may show "Network may be monitored" afterwards. It only means a certificate was
          added; nobody is watching.
        </span>,
      );
    case "windows":
      return steps(
        <>
          <span>Download the certificate.</span>
          <Get href={CRT}>Download the certificate</Get>
        </>,
        <span>
          Open it, press <b>Install Certificate…</b>, choose <b>Local Machine</b> (or Current User),
          then <b>Place all certificates in the following store</b> → Browse →{" "}
          <b>Trusted Root Certification Authorities</b> → Finish → Yes.
        </span>,
        <>
          <span>Or, in PowerShell as administrator:</span>
          <Code>{`Import-Certificate -FilePath "$env:USERPROFILE\\Downloads\\home-root-ca.crt" -CertStoreLocation Cert:\\LocalMachine\\Root`}</Code>
        </>,
        <span>Close and reopen the browser, then come back to this page.</span>,
      );
    case "mac":
      return steps(
        <>
          <span>Download the profile.</span>
          <Get href={PROFILE}>Download the profile</Get>
        </>,
        <span>
          Open <b>System Settings → Privacy &amp; Security → Profiles</b> (or the "Profile
          Downloaded" item at the top of System Settings), double-click it and press <b>Install</b>.
        </span>,
        <>
          <span>Or download the certificate and trust it in Terminal:</span>
          <Get href={CRT}>Download the certificate</Get>
          <Code>
            {
              "sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/Downloads/home-root-ca.crt"
            }
          </Code>
        </>,
        <span>Close and reopen the browser, then come back to this page.</span>,
      );
    case "chromeos":
      return steps(
        <>
          <span>Download the certificate.</span>
          <Get href={CRT}>Download the certificate</Get>
        </>,
        <span>
          Open <b>chrome://certificate-manager</b> (or Settings → Privacy and security → Security →
          Manage certificates), go to <b>Authorities</b> (or "Custom" → Installed by you) and{" "}
          <b>Import</b> home-root-ca.crt.
        </span>,
        <span>
          Tick <b>Trust this certificate for identifying websites</b> and press OK.
        </span>,
      );
    case "linux":
      return steps(
        <>
          <span>Download the certificate.</span>
          <Get href={CRT}>Download the certificate</Get>
        </>,
        <>
          <span>Add it to the system (Debian, Ubuntu and similar):</span>
          <Code>
            {
              "sudo cp ~/Downloads/home-root-ca.crt /usr/local/share/ca-certificates/\nsudo update-ca-certificates"
            }
          </Code>
          <span>Fedora and similar:</span>
          <Code>
            {
              "sudo cp ~/Downloads/home-root-ca.crt /etc/pki/ca-trust/source/anchors/\nsudo update-ca-trust"
            }
          </Code>
        </>,
        <span>
          Browsers keep their own list on Linux: in Chrome, Settings → Privacy and security →
          Security → Manage certificates → Authorities → Import; in Firefox, Settings → Privacy
          &amp; Security → View Certificates → Authorities → Import, and tick "Trust this CA to
          identify websites".
        </span>,
      );
  }
}

function Qr({ text }: { text: string }) {
  const svg = useMemo(
    () =>
      renderSVG(text, {
        border: 2,
        whiteColor: "#ffffff",
        blackColor: "#111111",
      }),
    [text],
  );
  return (
    <div
      className="size-40 overflow-hidden rounded-xl bg-white p-1 [&>svg]:size-full"
      role="img"
      aria-label={`QR code for ${text}`}
      // Our own SVG, made here from the page's address.
      // biome-ignore lint/security/noDangerouslySetInnerHtml: generated locally by uqr
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function TrustPage() {
  const info = useTrustInfo();
  const { state, recheck } = useTrusted();
  const [platform, setPlatform] = useState<Platform>(() => platformOf());
  const firefox = /Firefox\//.test(navigator.userAgent);
  const here = `http://${location.host}/trust`;
  const t = info.data;

  return (
    <main className="shell grid max-w-3xl gap-5 pb-24">
      <div>
        <h1 className="font-heading text-2xl font-bold">Trust this home's websites</h1>
        <p className="mt-1 text-[14px] text-muted">
          The home's own sites (like this one, and the other <code>.home</code> names) use a
          certificate from the home's own certificate authority. Once a device trusts it, they open
          with a padlock instead of a warning. It's done once per device, in a minute or two.
        </p>
      </div>

      <div
        className={cx(
          "flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3 text-[14px]",
          state === "trusted"
            ? "border-good/40 bg-good/10"
            : state === "not-trusted"
              ? "border-warn/40 bg-warn/10"
              : "border-line bg-surface",
        )}
        aria-live="polite"
      >
        {state === "trusted" ? (
          <CircleCheck className="size-5 flex-none text-good" />
        ) : state === "checking" ? (
          <Loader2 className="size-5 flex-none animate-spin text-muted" />
        ) : state === "not-trusted" ? (
          <ShieldAlert className="size-5 flex-none text-warn" />
        ) : (
          <CircleHelp className="size-5 flex-none text-muted" />
        )}
        <span className="grow font-semibold">
          {state === "trusted"
            ? "This device trusts the home. You're all set."
            : state === "checking"
              ? "Checking this device…"
              : state === "not-trusted"
                ? "This device doesn't trust the home yet. Follow the steps below."
                : "Open this page by its name (like start.home/trust) to check this device."}
        </span>
        {state !== "checking" && state !== "unknown" ? (
          <Button size="sm" variant="ghost" onClick={recheck}>
            <RefreshCw className="size-4" /> Check again
          </Button>
        ) : null}
      </div>

      {t && !t.available ? (
        <p className="rounded-xl bg-(--c-surface-2) px-4 py-3 text-[14px]">
          {t.error ??
            "No certificate is set up yet. The admin mounts the certificate authority's public root (root_ca.crt) into Hearth; see the install guide."}
        </p>
      ) : null}

      {t?.available ? (
        <>
          <section className="card grid gap-4 p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-bold">Steps for this device</h2>
              <span className="text-[12.5px] text-muted">Not this one? Pick another.</span>
            </div>
            <Segmented label="Device" value={platform} onChange={setPlatform} options={PLATFORMS} />
            <Steps items={stepsFor(platform, t.name ?? "the home's certificate")} />
            {firefox && platform !== "android" ? (
              <p className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[13px]">
                <b>Firefox</b> usually uses the system's certificates on Windows and Mac. If it
                still warns, import it in Firefox too: Settings → Privacy &amp; Security → View
                Certificates → Authorities → Import, and tick "Trust this CA to identify websites".
              </p>
            ) : null}
          </section>

          <section className="card grid gap-4 p-5 sm:grid-cols-[1fr_auto]">
            <div className="grid content-start gap-2">
              <h2 className="text-lg font-bold">Check it's the right one</h2>
              <p className="text-[13.5px] text-muted">
                When your device shows the certificate's details, its <b>SHA-256 fingerprint</b>{" "}
                should match this. Comparing the first and last few pairs is enough.
              </p>
              <p className="text-[13.5px]">
                <b>{t.name}</b>
                {t.validTo
                  ? `, valid until ${new Date(t.validTo).toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}`
                  : ""}
              </p>
              <code className="rounded-xl bg-(--c-surface-2) px-3 py-2 text-[12.5px] leading-relaxed break-all">
                {t.fingerprint}
              </code>
              {t.expiresSoon ? (
                <p className="text-[13px] text-warn">
                  It runs out within six months; the admin will need to make a new one.
                </p>
              ) : null}
            </div>
            <div className="grid content-start justify-items-center gap-2">
              <Qr text={here} />
              <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                <QrCode className="size-4" /> Open this page on a phone
              </span>
            </div>
          </section>
        </>
      ) : null}
    </main>
  );
}
