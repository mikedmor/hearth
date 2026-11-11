# Widgets

Widgets sit beside your links: whether everything is up, what's downloading, the cameras, the weather, your calendar. Each is kept live over one connection per page, and each person chooses which ones are on their own page.

## Putting widgets on your page

Press **Edit**, then **Add a widget**. **On your list** shows the widgets already **on this page** (the admin can edit each one, and anyone who can change the page can take one off with −), then the others you may see under **Add to this page**: press one to add it. Drag a widget by its handle to reorder, and remove it with ×. That changes only your page.

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
| AI servers      | Your AI servers: up, busy, and what's loaded                                     |
| Pinball         | A pinball table running VPin Studio: what's being played, high scores, players   |
| Ask             | A box to ask the AI, which opens the chat                                        |

## Ready-made widgets for your apps

In **Add a widget**, the admin has three more tabs:

- **Your apps:** widgets for the apps your home has: the ones on your tiles (by the app they're linked to, their logo, their name or their address) and the ones the Devices page found on your network, with their addresses filled in. If Hearth already signs in to that app (AdGuard Home, openHAB or Home Assistant, from Devices → Setup), it uses that sign-in. Built-in widgets your home can use are here too: the **Pinball** table once one is found, and your **AI servers**.
- **No copies:** adding a widget that's already been made puts that one on your page. The admin can delete a widget for good from **On your list** (it asks twice).
- **All apps:** every app Hearth knows that has widgets: Plex, Jellyfin, Tautulli, Overseerr, Radarr, Lidarr, Prowlarr, SABnzbd, Tdarr, Pi-hole, WireGuard, Glances, Portainer, Nextcloud, Cockpit, Gotify, Frigate, Synology Photos, Grocy and more.
- **General:** not tied to one app: service health, this server's load and disks, the weather, a news feed, a camera picture. Weather and news need the internet allowed.

A widget that needs a key (an API key, say) asks for it once. The key is stored encrypted and never sent to a browser.

## Making your own

On the **Widgets** page, **New custom widget** opens the editor. A widget is:

- **Sources**, where data comes from:

  | Source        | What it does                                                                                   |
  | ------------- | ---------------------------------------------------------------------------------------------- |
  | HTTP          | Asks an address every so often, for JSON, XML or RSS/Atom. GET or POST, with headers           |
  | WebSocket     | Keeps a connection open and takes each message, replacing or merging into what it had          |
  | Hearth        | Hearth's own data, nothing to type: services, devices (and who's home), the network map, the AI servers and their computers, the pinball table, the smart home's readings, this server, the time |
  | Connection    | A system already connected in Settings (AdGuard Home, Home Assistant, openHAB, an AI server): its API, signed in by Hearth. Reading only |

- **Blocks**, what it shows, on a 12-column grid: headings, text, stats, gauges, progress bars, line charts, bar charts, lists, tables, status lights, label–value pairs, camera pictures and dividers. And charts: **columns** and **area** (several series, stacked if you like, each drawn as columns, a line or an area), **pie** (a ring or a full pie), **treemap**, **heat map**, **scatter**, **waterfall** and a month **calendar**. A chart takes a list (`items`), what each item is called (`x`: a date, a month or a name) and up to eight series (a number from each item), and works out the rest: dates sort in order, the theme gives the colors, and a hover shows the values.
- **Formulas** that bind blocks to data: `$sonarr.records`, `round($h.load1, 2)`, `pct($h.memUsed, $h.memTotal)`, `filter($q.items, $item.status == "downloading")`. They include maths, lists, text and conditions; the editor lists every function. Text can hold formulas too: `{{ count($q.items) }} in the queue`.

**Preview** runs the widget once on the server and shows exactly what each source returned, so you can see what to bind to.

### Building it by hand

The editor opens on **Build**, three columns side by side:

| Column              | What's there                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Blocks**          | Every kind of block, grouped (numbers, charts, lists, layout). Click one to add it after the one you picked, or drag it to where it should go on the card                                        |
| **Data**            | Your sources, to add and change. Once a source has run, its fields are listed: click one and it goes into the formula box you were last in, at the cursor. Lists show their items' fields too |
| **Formulas**        | Every function with what it does. Click one to put it in the formula box                                                                                                                         |
| **The card, live**  | The widget as the family will see it, with real data. Click a block to pick it; drag blocks to put them in order. A red outline means it has something to fix                                     |
| **Block**           | The picked block's settings: its width (a quarter, a third, half, two thirds or the whole card), title, tone and its own fields. Move it, duplicate it or remove it                              |
| **Named values**    | Formulas worked out once and used by name, like `$free`                                                                                                                                         |

**Undo** and **Redo** (Ctrl+Z and Ctrl+Y) go back and forward through every change, in any tab. Renaming a source or a value changes the formulas that use it. **AI designer**, **Templates** and **JSON** edit the same widget, so you can start in one and finish in another.

### From your home, with no keys

Under **Build → Data**, **From your home** lists Hearth's own data and **Connected systems** lists the systems you've connected in Settings, each with the useful places to start (AdGuard Home's stats, Home Assistant's states). One click adds it as a source. Hearth adds the sign-in on the server: it never appears in the widget or on the page, and a connection can only read, never change anything. The AI designer can use and look at these too.

A widget shows its data to everyone it's for, so think about **Who can see it** before putting devices, who's home or lookups on one for everyone.

### Keys and secrets

Put an API key in **Settings → Secrets** and use it in a source as `{{secret:name}}`, in an address, a header or a body. Hearth fills it in on the server. A secret's value is never shown again, never sent to a browser, and hidden from error messages.

### Camera pictures

An image block whose address is on your network is fetched by Hearth and passed to the page, so a camera's snapshot shows up without exposing the camera or its password. When the camera stops answering, the widget keeps its last picture, dimmed, with **Offline** and how long ago it was taken, and shows the new picture as soon as the camera is back. A live video address works too (an MJPEG stream, like motionEye's on port 8081): Hearth takes one picture from it each time. A `.local` name (`http://motioneye.local/…`) works, though Hearth's container can't use the multicast lookup your computer does: Hearth asks the devices on your network directly which one has that name.

## The AI designer

With an [AI server](ai.md) set up, the editor's **AI designer** tab drafts a widget from a sentence, like "Sonarr's download queue with progress bars". Hearth runs each draft, sends the model what went wrong, and repeats until it works, then hands it to you to check and save. It never sees the values of your secrets.

## What widgets may reach

Widget sources reach **only the home network** unless the admin turns on **Settings → General → Network → Let widgets reach the internet**. Every redirect is checked again, and answers are limited in size and time. A source starts when the first page shows its widget and stops a minute after the last one closes.
