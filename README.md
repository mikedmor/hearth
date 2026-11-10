<div align="center">

<img src="src/web/public/icon.png" alt="" width="96" height="96" />

# Hearth

**The front door to your home network: a start page for the whole family.**

Every service in the house one tap away with a live status dot, a page for each person, widgets for what the home runs, and everyone's own calendar.
Self-hosted in one container. Nothing leaves your network unless you decide it should.

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE)
[![Support development](https://img.shields.io/badge/support-PayPal-00457C?logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/mikedmor)

[Quick start](#quick-start) · [Features](#features) · [Documentation](guides/README.md) · [Changelog](CHANGELOG.md) · [Support](#support-the-project)

</div>

## Why Hearth

A home with a NAS soon runs a dozen services, each at its own address and port, and nobody but the person who set them up remembers where they are. A list of links helps, but it's the same list for everyone, it doesn't know what's up or down, and it's awkward on a phone.

- **One address for everything.** Open `start.home` (or whatever you call it), tap your face, tap what you want. Every service on the home network gets a live dot.
- **Everyone's own.** Each person has their own page: their links and sections, favourites, widgets, colours and theme. A child's page shows what's right for them; a parent's can hold things nobody else sees, behind a PIN.
- **Knows the house.** Widgets show what the home runs right now, from ready-made ones for popular self-hosted apps to your own, designed with your AI server's help.
- **Yours.** It runs on your own hardware with plain JSON files. No account with anyone, no telemetry, nothing fetched from the internet unless you turn it on.

## Quick start

You need Docker on any amd64 or arm64 machine. Hearth is built from source:

```sh
mkdir -p hearth/data && cd hearth
git clone https://github.com/mikedmor/hearth.git src
cp src/docker/compose.yaml .
umask 077; printf "HEARTH_SECRET_KEY=%s\n" "$(openssl rand -base64 32)" > .env
docker compose up -d --build
```

Open **http://localhost:8082**. The first visit asks for a setup code, which is in the container's log (`docker logs hearth`), and then for the admin password you choose.

> [!IMPORTANT]
> Keep a copy of `.env` somewhere safe, such as a password manager. `HEARTH_SECRET_KEY` encrypts widget keys, AI keys and calendar sign-ins, and without it you'd have to enter them again.

For Synology, a name like `start.home`, and every setting, see the **[install guide](guides/install.md)**. Then read **[getting started](guides/getting-started.md)**.

## Features

<table>
<tr>
<td width="50%" valign="top">

### The start page

- **Sections and links** for every service, with icons from a bundled library of over 7,000 logos, symbols and emoji, or the site's own icon
- **Live status:** each service on the home network checked every 30 seconds
- **Edit in place:** press Edit, then drag sections and links, add and rename them, and choose who sees what
- **Find services:** scan the network, and Hearth recognises about 100 apps and devices
- **Search and jump** with Ctrl+K, favourites on the number keys, and short links like `start.home/plex`

</td>
<td width="50%" valign="top">

### Everyone's own page

- **Who's here?** Tap your face; a PIN keeps a page private
- **Roles:** the admin, adults and children, each seeing what's meant for them
- **Your own links and sections** alongside the house's, which only you see
- **Your look:** themes, layouts, backgrounds, fonts, even your own CSS
- **A set-up link** that opens one person's page on a shared tablet

</td>
</tr>
<tr>
<td width="50%" valign="top">

### Widgets

- **Built in:** service health, a note for the family, countdowns, clocks, the calendar, AI servers
- **Ready-made widgets** for Plex, Jellyfin, Radarr, Pi-hole, Portainer, Nextcloud, Frigate and more
- **Your own:** pull JSON, XML, RSS or WebSocket data and lay it out with formulas
- **An AI designer** that drafts a widget from a sentence and fixes it until it works
- **Live:** one connection per page, updated as the data changes

</td>
<td width="50%" valign="top">

### Calendar

- **Everyone gets one**, as a month, a week or a list, and a widget for the start page
- **Add sources:** Hearth's own calendars, calendar links (`.ics`), CalDAV (Synology Calendar, iCloud, Nextcloud, Fastmail) and Google, both ways
- **Share** a whole calendar (let others add to a family one), or tag people on one event
- **Turn calendars on and off** on your own page

</td>
</tr>
<tr>
<td width="50%" valign="top">

### AI, on your own server

- **Any Ollama or OpenAI-compatible server** on your network
- **Chat** for the roles you allow, with children's answers kept simple and safe
- **AI computers:** what each server is doing, its models and what's loaded

</td>
<td width="50%" valign="top">

### Private and safe

- **Plain files** in one data folder: back it up with the rest of your NAS
- **Secrets encrypted** with AES-256-GCM; passwords and PINs hashed
- **Nothing private for visitors:** guests see only what's meant for everyone
- **No outbound calls** unless you allow them, each one documented

</td>
</tr>
</table>

Coming next: a guide that teaches each device to trust your home's own certificate authority (`start.home/trust`), and parental controls the family can use.

## Documentation

All guides are in **[guides/](guides/README.md)**:

- [Install](guides/install.md) · [Getting started](guides/getting-started.md) · [Finding services](guides/finding-services.md)
- [Widgets](guides/widgets.md) · [Calendar](guides/calendar.md) · [AI](guides/ai.md)
- [Troubleshooting and FAQ](guides/troubleshooting.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Support the project

Hearth is free and open source. If it's useful to you, you can [support its development on PayPal](https://www.paypal.com/paypalme/mikedmor). Bug reports and ideas are just as welcome in [GitHub issues](https://github.com/mikedmor/hearth/issues).

## Third-party icons and libraries

Hearth bundles these icon sets at build time. It never fetches icons from the internet.

| Set                                     | What                         | License                                                    |
| --------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| [Simple Icons](https://simpleicons.org) | App and brand logos          | CC0 1.0. The logos themselves are their owners' trademarks |
| [Lucide](https://lucide.dev)            | Symbols                      | ISC                                                        |
| [Emojibase](https://emojibase.dev)      | Emoji names and search words | MIT                                                        |

Calendars use [ical.js](https://github.com/kewisch/ical.js) (MPL 2.0, unchanged) to read and write iCalendar files.

## License

Hearth is licensed under the [GNU Affero General Public License v3.0](LICENSE). You're free to use, modify and self-host it. If you run a modified version as a network service for other people, you must make your source code available to them.
