# Widgets

Widgets sit beside your links: whether everything is up, what's downloading, the cameras, the weather, your calendar. Each is kept live over one connection per page, and each person chooses which ones are on their own page.

## Putting widgets on your page

Press **Edit**, then **Add a widget**. **On your list** has the widgets that already exist and that you may see: press one to add it. Drag a widget by its handle to reorder, and remove it with ×. That changes only your page.

The admin also sees the gallery of new widgets (below), and manages all of them on the **Widgets** page: who sees each one (everyone, adults or only the admin), its title, and editing or deleting it.

## Built-in widgets

On the **Widgets** page, press **Built-in widget**:

| Widget          | What it shows                                                                    |
| --------------- | -------------------------------------------------------------------------------- |
| Services        | How many services are up, from Hearth's own checks, and which ones aren't        |
| Note            | A line for the family, like "Plex is down tonight"                               |
| Coming up       | Days to birthdays, holidays and trips; yearly ones roll over                     |
| Clock           | The time here, and in other time zones                                           |
| Calendar        | What's on today and this week, from each person's own [calendar](calendar.md)   |
| AI computers    | Your AI servers: up, busy, and what's loaded                                     |
| Ask             | A box to ask the AI, which opens the chat                                        |

## Ready-made widgets for your apps

In **Add a widget**, the admin has three more tabs:

- **Your apps:** widgets for the apps already on your page, with their addresses filled in.
- **All apps:** every app Hearth knows that has widgets: Plex, Jellyfin, Tautulli, Overseerr, Radarr, Lidarr, Prowlarr, SABnzbd, Tdarr, Pi-hole, WireGuard, Glances, Portainer, Nextcloud, Cockpit, Gotify, Frigate, Synology Photos, Grocy and more.
- **General:** not tied to one app: services as lights, this server's load and disks, the weather, a news feed, a camera picture. Weather and news need the internet allowed.

A widget that needs a key (an API key, say) asks for it once. The key is stored encrypted and never sent to a browser.

## Making your own

On the **Widgets** page, **New custom widget** opens the editor. A widget is:

- **Sources**, where data comes from:

  | Source        | What it does                                                                                   |
  | ------------- | ---------------------------------------------------------------------------------------------- |
  | HTTP          | Asks an address every so often, for JSON, XML or RSS/Atom. GET or POST, with headers           |
  | WebSocket     | Keeps a connection open and takes each message, replacing or merging into what it had          |
  | Hearth        | Hearth's own data: service status, the AI servers, the time, or this server's load and disks   |

- **Blocks**, what it shows, on a 12-column grid: headings, text, stats, gauges, progress bars, line charts, bar charts, lists, tables, status lights, label–value pairs, camera pictures and dividers.
- **Formulas** that bind blocks to data: `$sonarr.records`, `round($h.load1, 2)`, `pct($h.memUsed, $h.memTotal)`, `filter($q.items, $item.status == "downloading")`. They include maths, lists, text and conditions; the editor lists every function. Text can hold formulas too: `{{ count($q.items) }} in the queue`.

**Preview** runs the widget once on the server and shows exactly what each source returned, so you can see what to bind to.

### Keys and secrets

Put an API key in **Settings → Secrets** and use it in a source as `{{secret:name}}`, in an address, a header or a body. Hearth fills it in on the server. A secret's value is never shown again, never sent to a browser, and hidden from error messages.

### Camera pictures

An image block whose address is on your network is fetched by Hearth and passed to the page, so a camera's snapshot shows up without exposing the camera or its password.

## The AI designer

With an [AI server](ai.md) set up, the editor's **AI designer** tab drafts a widget from a sentence, like "Sonarr's download queue with progress bars". Hearth runs each draft, sends the model what went wrong, and repeats until it works, then hands it to you to check and save. It never sees the values of your secrets.

## What widgets may reach

Widget sources reach **only the home network** unless the admin turns on **Settings → General → Network → Let widgets reach the internet**. Every redirect is checked again, and answers are limited in size and time. A source starts when the first page shows its widget and stops a minute after the last one closes.
