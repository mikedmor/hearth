# Family and internet controls

The **Family** page (in the menu, for parents) shows each child at a glance: what their devices can reach right now and what changes next, what they've been doing today, and what they tried that was blocked. From there you pause them, unlock a device, allow a site, and set each child's rules and schedules. Hearth does it through [AdGuard Home](devices.md#connecting-adguard-home) on your router, with rules for each child's devices.

Nothing is limited until the admin turns **Internet controls are on** (Settings → Internet). Activity is recorded either way, so you can look first and limit later.

## Before you start

1. **Connect AdGuard Home** in Devices → Setup.
2. **Say which devices are each child's** on the Devices page. A device several children share (the school PC) follows the strictest of their rules. A child's rules and history follow their devices. When a device becomes a child's, Hearth reads back what it looked up in the days AdGuard Home kept, so its history doesn't start empty.
3. **Choose the parents** in Settings → Internet → Parents. The admin always has the Family page; each parent needs a **PIN** (Settings → People), since without one anyone could pick their face.

## The Family page

| Part                | What it shows                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Asking you**      | A child's requests from their device, more time or a site, with **Yes** (or **Allow**) and **Not now**. The **Family** menu item shows how many are waiting |
| **Needs a look**    | Sites any child's devices were blocked from in the last three days, newest first, with the allowed site they were using just before ("while using pbskids.org"). **Allow** it, or **Dismiss** it (it stays blocked and stops showing here) |
| **Each child**      | What's in effect now ("Only their sites", "Bedtime: paused", "Paused by Sam until 4:30 pm") and what changes next, which device was last active, today's sites and blocks, activity by hour, and **Pause** and **Unlock** |

Press a child for **their own page**:

| Section            | What's there                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ |
| **Devices**        | Each of their devices, when it was last active, and **Unlock** or **Lock** for it                                  |
| **Activity**       | Any day Hearth kept (‹ ›), for all their devices or one: activity by hour, and every site with when and how often |
| **Blocked lately** | The last three days' blocks, with **Allow** and **Dismiss** (dismissed ones can be shown again)                    |
| **Rules**          | Their usual mode, their sites, what else a device needs, and schedules                                             |

A lookup is a device asking where a site is. One page can make several, and apps look things up in the background, so activity is a guide to where a device went, not a list of pages. Hearth keeps children's activity for 30 days by default (7 to 90, Settings → Internet). **Grown-ups' activity is never kept.**

## Modes

| Mode                 | What their devices can reach                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Whole internet**   | Everything, with AdGuard Home's usual filtering (the default)                                                              |
| **Only their sites** | The sites on their Hearth page, the extra sites you add, and what a device needs to work. Everything else is blocked       |
| **Paused**           | Nothing on the internet. Your home's own pages (`start.home`, anything `.home` or `.lan`) still open                      |

**Their sites.** Every internet link on their Hearth page counts, with the parts well-known sites need to load (YouTube's video servers, Netflix's, PBS Kids', Khan Academy's and others). A site comes with its subdomains: allowing `pbskids.org` allows `www.pbskids.org`. Add more under **More allowed sites**, or press **Allow** on something that was blocked.

**So the device works.** "Updates, app store, sign-in" also allows the device maker's own services (Apple, Google sign-in and Play, Windows Update), but not web search. "Only the basics" allows just the "is there internet?" checks and the time.

**Try a site** asks AdGuard Home what it would do with a site for one of their devices, right now.

## Safety, whatever the mode

These apply to a child's devices all the time, even on the whole internet (an open weekend, say), but not while a grown-up has unlocked a device.

| Setting                         | What it does                                                                                                         |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Safe search** (on by default) | Google, Bing, DuckDuckGo, Ecosia and others show safe results, and YouTube is in Restricted Mode                      |
| **Block adult sites** (on)      | AdGuard Home's adult-content filter. It checks site names with AdGuard's own service, without saying which device asked |
| **Blocked apps and services**   | Pick from AdGuard Home's list (TikTok, Roblox, Discord, Fortnite, AI chat and about 130 more), grouped by kind        |

Hearth keeps these as one AdGuard Home client per child, named "Hearth: " and their name, holding their devices' addresses. Leave those to Hearth; clients you make yourself are never touched. If one of a child's addresses already belongs to a client you made, Settings → Internet says so.

## Asking for more time, or a site

On a child's device, the strip at the top of Hearth has **Ask**: more time (15 minutes to an hour) or a site (its name, or a pasted link), with a note if they like ("homework"). Parents see it at the top of the Family page and the strip shows the answer. **Yes** unlocks that device for the time asked; **Allow** adds the site to their allowed sites. A device can ask six times an hour.

## Alerts

Parents with Hearth open get a message when a child asks. To get alerts on your phone too, give a web address in **Settings → Internet → Alerts** that takes a message, such as an [ntfy](https://ntfy.sh) topic (its app pushes it to your phone), Home Assistant or Gotify. **Send a test** checks it. Optionally, also get an alert the first time each day a child is blocked from a new site.

A public ntfy topic can be read by anyone who guesses its name: choose a long, unguessable one, or run ntfy on your own network.

## Schedules

A schedule changes a child's mode at set times: **School-night bedtime** (paused 21:00 to 07:00, Sunday to Thursday nights), **Open weekends**, or your own. The first schedule that fits now wins, and a time that ends earlier than it starts runs past midnight. Times are in the home's time zone (Settings → General). The Family page says when the next change happens.

## Pause, unlock and lock

| To                                | Do                                                                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pause a child now**             | Family → **Pause**: 30 minutes, 1 or 2 hours, or until you resume. A pause beats schedules                                                            |
| **Unlock one of their devices**   | Family → **Unlock**: choose the device and how long (30 minutes to 4 hours)                                                                           |
| **Use a child's device yourself** | On their device, open Hearth: a strip at the top says what rules it follows. Press **Grown-up? Unlock**, choose how long, pick your face and type your PIN |
| **Lock it again early**           | **Lock again** on the device, or **Lock** on the Family page                                                                                          |

An unlock lifts the rules on that one device only, and they come back by themselves when the time is up. A child can't unlock their own device: only an adult or the admin, with their own PIN.

## Guest pass

**Settings → Internet → Guest pass** (the admin) asks devices Hearth doesn't know on the family network for a guest pass: they get no internet until they have one. Saved devices (the Devices page) never need one, and the guest Wi-Fi is left alone. Everything can be set up before it's turned on.

1. **Say which network needs them**: the family network, like `192.168.1.0/24` (the networks Hearth has seen are offered). Not the guest Wi-Fi.
2. **Set a house password**, if you want one: anyone who knows it can let their own device in, like the Wi-Fi password. Without one, only a parent can.
3. **Turn it on.** Every device already on the network is let in at that moment, and the one you're using, so nobody is cut off.

A new device after that lands on **start.home/welcome**: type the house password, or **Ask a parent** (saying what it is, like "Grandpa's tablet"). Parents see it on the Family page under **Asking for a guest pass**, with **Let in** and **Not now**, and get an alert if alerts are set up. **A guest pass lasts** until someone removes it, or a day, a week or a month (your choice). Devices with a pass are listed in the Guest pass card; saving one on the Devices page keeps it known for good.

**Opening the welcome page by itself.** A phone checks for internet by asking a known address (Apple's `captive.apple.com`, Android's `connectivitycheck.gstatic.com` and others). Give Hearth's own address on port 80 (the NAS's) under **Open the welcome page by itself**, and a stopped device's check goes to Hearth, which sends it to the welcome page: the phone's "Sign in to network" page opens by itself. For that, the NAS's web server has to pass those names to Hearth. On a Synology NAS: Control Panel → Login Portal → Advanced → Reverse Proxy, add a rule from `http://captive.apple.com` (port 80) to Hearth's port, and the same for each name in the table below. Without it, guest passes still work; people just open start.home themselves.

| Asks for                                          | Which devices      |
| ------------------------------------------------- | ------------------ |
| `captive.apple.com`, `www.appleiphonecell.com`   | iPhone, iPad, Mac  |
| `connectivitycheck.gstatic.com`, `connectivitycheck.android.com`, `clients3.google.com` | Android, Chromebook |
| `www.msftconnecttest.com`, `www.msftncsi.com`     | Windows            |
| `detectportal.firefox.com`                        | Firefox            |
| `nmcheck.gnome.org`, `connectivity-check.ubuntu.com` | Linux           |

> [!WARNING]
> A device's address is how Hearth knows it has a pass. If a known device gets a new address from the router, it's stopped until it's let in again (or opens Hearth, which can't happen while it's stopped). **Reserve your devices' addresses on the router** (DHCP reservations) before turning guest passes on. If anything goes wrong, turn them off: their rules leave AdGuard Home within a second.

## Closing the gaps

DNS rules only work if every device asks AdGuard Home. On your router:

| Gap                                                      | Close it with                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A device set to use its own DNS (like 8.8.8.8)           | Send all DNS to the router. GL.iNet: Network → DNS → **Override DNS Settings for All Clients**                   |
| Encrypted DNS (DNS over TLS, port 853)                   | A firewall rule rejecting port 853 from your network to the internet                                            |
| Encrypted DNS over HTTPS, iCloud Private Relay, VPN apps | **Only their sites** already blocks the names these use. A VPN app that connects by address alone can still get through |

Android's **Private DNS** set to a provider's name stops working once port 853 is blocked; "Automatic" falls back to normal DNS.

> [!TIP]
> AdGuard Home keeps its own query log in memory by default, only the last 1,000 lookups for the whole house. For activity that survives restarts and busy evenings, turn on its log file: AdGuard Home → Settings → General settings → Query logs. Hearth reads it every 20 seconds either way.

## Good to know

- **Changes apply within a second**, but a device remembers recent answers for a few minutes, so a site it just opened can keep working briefly after you block it.
- **If Hearth stops**, AdGuard Home keeps the rules as they were last written. An unlock or schedule change that falls while Hearth is off happens when it starts again.
- **Hearth only changes its own lines** in AdGuard Home's custom filtering rules, between two comment lines it marks. Rules you add yourself are kept.
- **A device's address matters.** Rules follow a device's addresses; if one changes, opening Hearth on it moves it over. Reserving its address on the router (a DHCP reservation) makes it certain.
