# Changelog

All notable changes to Hearth are listed here. Versions follow [Semantic Versioning](https://semver.org/): a new major version can need you to do something when you upgrade, minor versions add features, and patches fix things. Hearth upgrades an older configuration by itself when it starts, and keeps the old file beside it.

## [Unreleased]

## [1.0.0] - 2026-11-11

The first release: a start page for the whole family.

### Added

- **Sections and links** for every service, with a bundled library of over 7,000 logos, symbols and emoji, the site's own icon, or an upload.
- **Live status** for every service on the home network, checked every 30 seconds.
- **Edit mode:** press Edit to add, rename and drag sections and links, and choose who sees each one: everyone, adults, only the admin, some people, or just you.
- **Find services:** scan the network, and Hearth recognises about 100 apps and devices. Teach it more with a file in `data/catalog/`.
- **A page for each person:** "Who's here?", PINs, roles for adults and children, locked pages, set-up links, and each person's own links, sections, favourites and widgets.
- **The command center** layout: everything on one screen, with search (Ctrl+K), favourites on the number keys, and short links like `start.home/plex`.
- **Your look:** themes, layouts, backgrounds, fonts and your own CSS, per person.
- **Widgets:** built-in ones (services, notes, countdowns, clocks, the calendar, AI servers, ask), ready-made ones for popular apps, your own from HTTP and WebSocket sources with formulas, and an AI designer. Live over one connection per page.
- **Calendar:** everyone's own, with Hearth calendars, calendar links, CalDAV accounts and two-way Google; sharing whole calendars or tagging people on one event; month, week and list views, and a widget.
- **Import and download calendar files:** bring an `.ics` file into any calendar you can add to, with its repeat rules and moved or cancelled times kept and nothing added twice, and download a Hearth calendar as `.ics` for other apps.
- **Children's pages are always locked:** a child can't add or remove links, sections, widgets or favourites, or change their look; the admin sets their page up.
- **The admin sign-in** shows only on a page with the admin role (and on a new install), not for adults, children or guests.
- **Devices** (its own page, for the admin): every device on the network, from AdGuard Home and from the browsers that open Hearth, with whose each one is or that it's always allowed. The groundwork for internet controls; it changes nothing on the network yet.
- **The Family page**, for the admin and the parents they choose (each with a PIN): every child at a glance (what's in effect and what changes next, the last active device, today's sites and blocks by hour), a **Needs a look** list of blocked sites to allow or dismiss, and each child's page with activity by day and by device, and their rules.
- **Internet controls:** per child, the whole internet, only the sites on their page (and what those sites need), or paused; schedules like a school-night bedtime; pause; **Try a site**. Hearth writes AdGuard Home's rules for each child's devices and touches only its own lines. Settings → Internet turns it on, sets how long activity is kept, and chooses the parents. A device newly marked as a child's has its recent past read back. Grown-ups' activity is never kept.
- **Single sign-on** with Pocket ID, Authentik or any OpenID Connect provider: **Sign in with …** on Who's here?, accounts linked to people in Settings → People, an admin group that also gets the admin's session. Authorization code flow with PKCE; Hearth checks each ID token itself.
- **Your own device opens your page:** a device saved as someone's opens their page by itself (or their PIN pad), marked **This device** on Who's here?.
- **The trust page** (`start.home/trust`): the steps to trust your home's own certificate authority on the device it's opened on (iPhone and iPad with a profile, Android, Windows, Mac, Chromebook, Linux), the download, the fingerprint, a QR code to open it on a phone, and a live check. Pages opened over `http://` by name move to `https://` on devices that trust it, and show a banner on devices that don't.
- **Guest pass**: on the family network, devices Hearth doesn't know get no internet until they have a guest pass, from the house password on the welcome page or a parent on the Family page (**Asking for a guest pass**). Turning it on gives one to everything already there, and it can all be set up before then. Optionally, phones' "Sign in to network" page opens the welcome page by itself.
- **Safety for children, whatever the mode:** safe search (Google, Bing, DuckDuckGo and others, YouTube Restricted Mode), AdGuard Home's adult-content filter, and blocked apps and services picked from AdGuard Home's list (TikTok, Roblox, Discord…).
- **Children can ask:** **Ask** on their device for more time or a site, with a note. Parents answer at the top of the Family page (**Yes** unlocks the device for that long, **Allow** allows the site), the menu shows how many are waiting, and parents with Hearth open get a message.
- **Alerts on your phone:** send requests (and, if you like, the first block of a new site each day) to a web address such as an ntfy topic, Home Assistant or Gotify.
- **A grown-up can unlock a child's device:** on the device, a strip says what rules it follows; **Grown-up? Unlock** takes an adult's own face and PIN and lifts the rules on that device for 30 minutes to 4 hours. They come back by themselves.
- **New devices** (Devices → Setup): leave them for the admin, or save them as always allowed by themselves; and networks (an IoT Wi-Fi) where every device is always allowed.
- **Devices say what they are:** Hearth asks each device on the network (Google Cast, Bonjour, Roku, Sonos, Hue, Shelly, WLED, Tasmota) and shows its own name and model, like "Living Room display, Google Nest Hub", then suggests a name and type from it. Devices that don't answer get a better guess from what they look up (a Nest under Google, a Ring under Amazon, Nanit, Wyze, ecobee and more).
- **AI:** any Ollama or OpenAI-compatible server on your network, and chat for the roles you allow.
- **Import from Heimdall**, with icons.
- **Secrets** encrypted with `HEARTH_SECRET_KEY`, and nothing fetched from the internet unless the admin allows it.
- **Search the web** from the search box: when what you type isn't one of the home's links, **Enter** searches Google, DuckDuckGo, Bing, Brave, Startpage, Ecosia, Kagi or your own (SearXNG, Whoogle). The admin picks the home's engine in **Settings → General**, and each person can pick their own in **Look**. An address typed in (`nas.home:5000`, `example.com`) offers to open it. The browser goes to the search engine itself; a search never passes through Hearth's server.
- **Update check:** **Settings → General → Updates** shows the version you're running and, once you turn it on (or press **Check now**), whether a newer release is out, with what's new and how to update. The admin's **Settings** link gets a dot when there's one. Hearth never updates itself.
- **Ready-made images** for amd64 and arm64 on GitHub (`ghcr.io/mikedmor/hearth`), so installing no longer needs the source.
- **`.local` names work** (`http://motioneye.local`): links to them get a real status dot, and camera widgets show their pictures. Hearth's container can't use the multicast lookup browsers do, so Hearth asks the devices on your network directly which one has the name, and remembers the answer.
- **Camera widgets** show a still picture or a live video stream (MJPEG, like motionEye's), one picture at a time. When the camera stops answering, the last picture stays, dimmed and marked **Offline** with how long ago it was taken, and it comes back by itself.
- **An open tab knows when Hearth was updated** and offers to reload.
- **What people can use:** Settings → People has one grid for which roles may use Files, the calendar and chat. Files starts off for children; the menu and the server both follow it.
- **Files:** the NAS's shared folders in Hearth (Synology for now). Each person connects their own NAS account, so the NAS decides what they see; browse, download a file or a folder as a zip, and **Map** a share on Windows (a ready-made script), a Mac, an iPhone or Android. Needs a PIN on the profile. See [Files](guides/files.md).
- **Keep sections and widgets together:** in Edit mode, drop one on the middle of another, or use the chain button, to link them (two camera views, a widget beside its app's links). Linked ones stay together on every screen size, a phone included; the group moves by its **Together** handle, and one item can still be dragged within it or out of it.
- **Widget settings in Edit mode:** each widget has a settings button for the admin, like a section's: its name, who sees it, a built-in one's options, and Delete, with **Open the designer** for what a custom one shows.
- **The Devices page** keeps an eye on the house, laid out like it: new devices to sort with one tap, the network (router, access points, servers), each person with their devices and whether they're home, then entertainment, computers and smart home. It shows the services each device runs (from your tiles, your AI servers and port checks that recognise the apps Hearth knows) and what needs a look, which you can dismiss until it's up again. A device opens in a panel beside the page, with its details to change right there. It takes the place of the AI computers page.
- **AI computers on their devices:** an AI server that shares several computers and lists them for apps shows each one on its device: what it's doing, its loaded model, how fast it answers, and its processor, memory and graphics cards.
- **Pinball tables:** a table running VPin Studio shows what's being played, the latest high scores and the players' ranking, with the admin's controls (start a table, mute, restart the frontend, shut down), and a **Pinball** widget for the start page.
- **Watch a device or a service:** Hearth sends an alert when it's been offline or down for three minutes, and when it's back.
- **Which devices trust the home's certificate**, as each one's browser found out, on the Devices page.
- **The network map:** who's connected to what, from a GL.iNet router: what's wired to it, what's on each Wi-Fi band, and each mesh node with its own devices, drawn as a chart.
- **More charts for widgets:** columns, area, pie, treemap, heat map, scatter, waterfall and a month calendar, from the same chart kit as Muny, in the theme's colors. The AI designer knows them too.
- **3D printers and cameras:** print-status widgets for PrusaLink (Prusa MK4, XL, MINI, CORE One) and OctoPrint, and a motionEye camera widget. Widget sources can sign in with HTTP Digest, as PrusaLink asks.
- **Every kind of device can be changed:** the built-in kinds are listed with your own in **Kinds of device**, to rename, give another icon, move to another part of the page, reset, or delete (and bring back).
- **The PrusaLink widget** shows the printer's name (and where it is), its state in words ("Idle", "Needs attention"), and a target temperature only while it's heating.
- **Add a service** has a search over every app Hearth knows, with their logos.
- **Your own links get status dots too:** a personal link to a service on the home network is checked like the house's, and its status goes only to your own page.
- **Suggested links:** **Add a link** and **Settings → Links** offer the services on your network that no link leads to yet, filled in with one tap.
- **Give Hearth access to your services** from the Devices page's **Services** tab, and **Add a service** the port checks didn't find: each app found on the network says whether Hearth can read it, and **Give access** takes an API key, a user and password, or a token, checked before it's kept. Widgets for that app and the designer read it through Hearth, holding no key. PrusaLink takes its API key or the printer's user and password; a key already given to an app's widget is used, and AdGuard Home and the smart-home hubs connect there too.
- **Widgets can read your home with no keys:** new sources for Hearth's own data (devices and who's home, the network map, the AI computers, the pinball table, the smart home) and for systems connected in Settings (AdGuard Home, Home Assistant, openHAB, the AI servers), signed in by Hearth and read-only. **Build → Data** lists them all, one click each, and the AI designer uses them too.
- **A better Pinball widget:** the table's wheel art for what's on and for each high score (shrunk and kept by Hearth), clean scores with the table's own titles ("Grand champion"), the players' podium, and for the admin **Play again** and a table search that's ready straight away.
- **The AI server's widget** is named after your server in **Your apps** and shows each computer it shares work with as a card: its graphics card and memory, what it's answering, and how many answers and how fast.
- **Build a widget by hand:** the widget editor opens on **Build**: blocks to click or drag onto the card, the card live with real data (click a block to change it, drag to reorder), its settings and width beside it, your sources' fields and every function a click away from the formula box, and undo and redo.
- **The AI servers widget** lists the computers a shared AI server lends work to: online, busy, and what's loaded.
- **The Pinball widget** has the admin's controls: start a table, mute, restart the frontend.
- **Coming up** also shows what's next on each person's own calendar (it can be turned off).
- **Your apps finds what your home has:** widgets for apps on your tiles (by logo, name or address) and apps found on the network, with addresses and known sign-ins filled in; the Pinball and AI servers widgets are offered there too. New widgets for openHAB and step-ca.
- **Your own kinds of device** ("Pinball table", "Home lab"), each with an icon from the library and the part of the Devices page it shows under.
- **Merge a device on two addresses** (wired and Wi-Fi) into one, suggested when both have the same name on the network.
- **Widgets among your sections:** on the Command center, widgets can now sit in the same columns as your link sections, in the order you drag them in Edit mode, instead of a rail at one side (Look → Widgets).
- **Smart home on the Devices page:** connect openHAB or Home Assistant, and each device they know shows its readings (leak sensor dry, the thermostat's temperature) and switches. Matched by address or hardware id, or linked by hand.
- **Shared devices:** a device several people use (the school PC) lists who; with children among them it follows the strictest of their rules, and its sites show in each child's history.
- **More kinds of device** (3D printers, thermostats, smart appliances, sensors and detectors) and **Not sure yet**, with help working out what one is: everything Hearth noticed, asking it again, and "unplug it and watch".
