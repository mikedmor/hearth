# Finding services

Hearth knows about 100 self-hosted apps and home devices: their usual ports, how to recognise them, their logos, and, for many, ready-made widgets. You can scan for them, have a link recognised as you type its address, and teach Hearth apps it doesn't know.

## Scanning the network

Press **Edit**, then **Find services** (the admin only). Hearth fills in your network, like `192.168.1.0/24`, or you can type addresses or names (`nas.local`). Then **Scan**:

1. It knocks on each address at the ports the apps it knows use.
2. It looks at what answered: the page's title, its headers, and for some apps a quick question to a known API.

Each app found is one row per machine, with a choice of address when it answers on several (HTTP and HTTPS, say). Rows already on your page say **Already added**. Tick the ones you want and **Add**. With **Put them in sections by kind** on, each goes in a section for its kind (Media, Downloads…); otherwise they all go in Home.

Only private addresses are scanned: Hearth refuses to scan anything on the internet.

## Recognising a link

When the admin adds a link (**+ Link**) and types its address, Hearth asks the address what it is. If it's an app it knows, it fills in the name and logo. It only asks addresses on the home network, unless the admin turned on **Settings → General → Network → Let widgets reach the internet**.

## Teaching Hearth an app

Put a JSON file in the data folder's `catalog/` folder (one app or a list of them) and restart Hearth. Each entry has the same shape as the apps in [`src/shared/catalog.ts`](../src/shared/catalog.ts):

```json
{
  "id": "grocy",
  "name": "Grocy",
  "icon": "lucide:shopping-basket",
  "category": "Home",
  "description": "Groceries and household stock",
  "ports": [9283],
  "match": { "title": "Grocy" }
}
```

| Field         | What it is                                                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| `category`    | Media, Downloads, Photos, Home, Network, Monitoring, Storage, Productivity, Finance, Development, Security, AI, Printing or Dashboards |
| `icon`        | A library logo (`si:plex`), a symbol (`lucide:house`), or an emoji                                                    |
| `match`       | `title`, `body` or `header` patterns (case-insensitive), or a `probe`: `{ "path": "/api/version", "body": "grocy" }` |
| `widgets`     | Optional ready-made widgets: custom-widget documents with `{{base}}`, `{{secret:key}}` and `{{param:<key>}}` in them |

Entries that don't fit are skipped, with the reason in Hearth's log. If an app is missing for everyone, please [open an issue](https://github.com/mikedmor/hearth/issues) or a pull request adding it to the catalog.

## Moving from Heimdall

Hearth can import Heimdall's apps, with their icons. On a computer with Node.js 24 and Hearth's source:

1. Copy `www/app.sqlite` (and `www/icons/`) from Heimdall's config folder. Copying while Heimdall runs is fine.
2. Run `npm run import:heimdall -- path/to/app.sqlite` to see what would be added.
3. Add `--write` to do it, with `--data path/to/hearth/data` pointing at Hearth's data folder.

`hearth.json` is backed up first, a running Hearth picks the change up by itself, and running the import again adds nothing new. Keep Heimdall running until Hearth is set up, then move your name (`start.home`) from Heimdall's port to Hearth's in your reverse proxy.
