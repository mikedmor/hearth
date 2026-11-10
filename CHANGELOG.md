# Changelog

All notable changes to Hearth are listed here. Versions follow [Semantic Versioning](https://semver.org/): before 1.0, a minor version can need you to do something when you upgrade, and patches fix things. Hearth upgrades an older configuration by itself when it starts, and keeps the old file beside it.

## [Unreleased]

The first version: a start page for the whole family.

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
- **AI:** any Ollama or OpenAI-compatible server on your network, chat for the roles you allow, and the AI computers page.
- **Import from Heimdall**, with icons.
- **Secrets** encrypted with `HEARTH_SECRET_KEY`, and nothing fetched from the internet unless the admin allows it.
