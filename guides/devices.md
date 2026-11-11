# Devices

**Devices** in the top bar (the admin's only) lists everything on your home network: whether it's on, what runs on it, and whose it is. It's where you keep an eye on the house: the NAS and its services, the computers that lend work to your AI server, a pinball table, and the rest. The [internet controls](internet.md) follow it too: a person's rules apply to the devices saved as theirs. Saving a device here changes nothing on your network by itself.

## The house at a glance

The page is laid out like the house:

| Part | What's in it |
| ---- | ------------ |
| **To sort** | New devices, and ones nobody has said are whose. Tap a person, or **Part of the house** (TVs, plugs, the printer: never limited by the internet controls), and it moves to its place. Open one for more |
| **The network** | The router, access points and servers, side by side: what everything else depends on, each with a dot per service |
| **People** | A card for each person with their devices (and when their phone was last active), and a **Shared** card for devices several people use |
| **Entertainment, Computers and printers, Smart home** | Everything else, by what it's for (from what kind of device it is; change that in its details) |
| **Not sure yet** | Devices you haven't worked out: open one for help (below) |

The counts at the top say what's on the network, how many services are up or down, what you're watching, and your AI computers. Show everything, or only what's online, offline or running services, or type to find a device or service.

Press a device to open its panel beside the page. Everything about it is in one place: whether it's on and trusts the home's certificate, its AI computer or pinball table if it has one, its **details** (name, what it is, whose, addresses; change them and **Save** right there), and what runs on it.

**Needs a look** lists your tiles and AI servers that are down, and anything you watch. A service on a device that's switched off isn't listed (it's off with it; watch the device to hear about that). **Dismiss** takes an item off the list until it's up again.

## The network map

**Network map** (beside **The house**) shows who's connected to what: the router at the top, with a line to each of its links (**Wired**, each Wi-Fi band, the IoT Wi-Fi) and to each mesh node, which has its own. Solid lines are cables, dashed ones Wi-Fi. Each device shows whether it's online and how busy its connection is; press one to open it.

It comes from the router itself: **Devices → Setup → Router**, its address (like `http://192.168.1.1`) and its admin password. For now that's a GL.iNet router (firmware 4) with or without mesh nodes. Hearth signs in the way the router's own admin page does (only a hash of the password crosses the network), reads two lists, and changes nothing. The password is kept encrypted.

A plain network switch between the router and some devices isn't seen: what's behind it shows as wired to the router. As a bonus, the router tells Hearth each device's hardware (MAC) address.

## Whose it is

In a device's details, **It's**:

| Choice | What it means |
| ------ | ------------- |
| **Someone's** | One person's. A child's device follows that child's [internet rules](internet.md) |
| **Shared** | Several people use it (the school PC). Pick who. With a child among them, it follows the strictest of their rules: paused if any of them is, otherwise only the sites every one of them may use. Its sites show in each of those children's history |
| **Part of the house** | TVs, plugs, cameras, the printer, the NAS, the router: never limited, and never asked for a [guest pass](internet.md#guest-pass) |

**What it is** includes phones, computers, TVs, consoles, speakers, cameras, printers and 3D printers, smart plugs and lights, thermostats, smart appliances (vacuums, washers, fridges), sensors and detectors (leak, smoke, energy), routers and servers, or **Not sure yet**.

**Kinds of device** (**Devices → Setup**) lists every kind, the built-in ones too. **Change** any of them (its name, an icon from Hearth's library, the part of the page it shows under), **Reset** a built-in one, or **Delete** the ones you don't need; deleted built-in ones can be brought back. Make your own ("Pinball table", "Home lab") there or with **New kind…** in **What it is**. Deleting a kind makes its devices **Not sure yet**.

**One device, two addresses:** a computer on both a cable and Wi-Fi shows up twice. When both have the same name on the network, its panel says so: **Merge them** keeps one device with both addresses (it must be set up first). Any two can be merged with **Same device as another one on the list?**

## Working out what something is

A device you're not sure about opens with **What is it?**: everything Hearth has noticed (what it calls itself, what the network calls it, what it looks up, which ports answer), and three things to try:

- **Ask it again:** Hearth asks it what it is (Google Cast, Bonjour and the rest).
- **Unplug it and watch:** Hearth knocks on it every few seconds. Unplug (or switch off) the one you suspect: if this one stops answering, that's it. Some devices never answer a knock; the page says so.
- **Open its page,** when it has one.

## What runs on each device

| Where a service comes from | How Hearth knows it's there |
| -------------------------- | --------------------------- |
| **Your tiles** | A tile's address leads to a device. Every `.home` name behind the NAS's web server leads to the NAS, so the services it runs are on the NAS. A `.local` name is the device the network calls by that name |
| **Your AI servers** | Where each one is, with how many models it has and what's loaded |
| **A port check** | **Look for services** tries the usual ports of the apps Hearth knows, and names what answers (Jellyfin, Home Assistant, VPin Studio…). Hearth also checks each saved computer, server and console by itself, once a day, one at a time |

Each service shows **Up**, **Slow** or **Down** and how fast it answered, checked every minute (tiles as often as your status checks; a tile whose status dot you turned off is still checked here). A device's own certificate on its https port is fine for these checks. A tile that leads to a device Hearth hasn't listed adds it (your router, say), marked **Not set up**, named after the tile until it says what it is.

- **One app on two ports** (DSM on 5000 and 5001) is one service, up if either answers.
- **Other open ports:** a port that answers without saying what it is (a TV's casting port, say) is usually part of the device, so it's folded away under the services instead of shown with them.
- **Hide** a found service (the crossed-out eye) if it isn't something you use. It's listed under **hidden**, where **Show** brings it back.
- **Hearth itself** shows on the device it runs on; tiles to Hearth's own pages (like the trust page) aren't services.
- A port a check happened to find shows in **Needs a look** only if you watch it.

The router that runs AdGuard Home never shows up in AdGuard Home's own list (it asks itself, by its own address), so it appears through a tile that leads to it, as **Router**.

## Services, and giving Hearth access

The **Services** tab lists every service Hearth knows is there (from your links, the port checks, Setup, and ones you add) and whether it can read it. **Add a service** adds one the port checks didn't find: its address (**What is it?** asks it which app it is) and the app.

| It says | What it means |
| --- | --- |
| **Hearth can read it** | Hearth has its sign-in. **Change** it or **Forget it** |
| **Needs a sign-in** | **Give access**: pick how (an API key, a user name and password, a token) and press **Check**, then **Save** |
| **No sign-in needed** | Hearth reads it as it is |

AdGuard Home, Home Assistant and openHAB connect here too, with what else they do (devices' names, readings and switches). A key already given to one of an app's widgets is used for it, so it isn't asked for twice. Some apps take more than one kind: PrusaLink takes its **API key** or the printer's **user name and password**. A strip on the Devices page says when apps still need access, and each service in a device's panel has a lock to give or change it.

Access is kept encrypted and used only to read. Widgets for that app (from **Add a widget**) and the designer's **Connected systems** use it through Hearth, so no widget holds the key.

## Who's on the network

A device is **online** when it looked something up through AdGuard Home in the last ten minutes, answered when Hearth knocked (even a "no" means it's there), or one of its services answered. Hearth knocks on saved devices every couple of minutes. One that's quiet and doesn't answer is **offline**; one Hearth can't tell about yet shows grey.

## AI computers

If your AI server shares several computers and lists them for apps (`/api/machines`, with the same key Hearth uses for chat), each computer shows on its own device: ready, answering or not lending right now (and why), the model it has loaded, how many answers it has given and how long they take, its version, and its processor, memory and graphics cards. A computer that's asleep says whether the server can wake it. A plain Ollama server is one computer, and shows as a service on its device.

## Pinball tables

A table running **VPin Studio** is found by a port check of the table's PC (VPin Studio's server answers on port 8089). Its device then shows:

- whether it's on, whether the frontend (PinUP Popper) is running, and the table being played right now;
- the latest high scores and the players' ranking;
- controls: **Start a table**, **Mute** or **Unmute**, **Restart the frontend**, and **Shut down** (it asks twice).

The **Pinball** widget puts the table on the start page: what's being played (or was last) with its wheel art, the latest high scores with each table's art, and the players' podium. The admin gets **Play again** (the tables played lately, one tap each), a search over every table, mute and restart. VPin Studio's API has no password of its own, so Hearth only calls it from the server, and only the admin sees the controls.

## Smart home

Hearth reads the hub that runs your smart home, so each device it knows shows what it's doing: a leak sensor **Dry**, the thermostat's temperature, a plug's power, the vacuum's state. Switches can be turned on and off from the device's panel.

1. **Devices → Services:** **Give access** to the hub, with a token you make in it.

   | Hub | Address | Token |
   | --- | ------- | ----- |
   | **openHAB** | Its page, like `http://192.168.1.20:8080` | Your profile (bottom left) → **API tokens** → Create new API token |
   | **Home Assistant** | Its page, like `http://192.168.1.21:8123` | Your profile → **Security** → **Long-lived access tokens** → Create token |

2. Hearth checks it answers, then matches the hub's devices to the network's by address or hardware id (openHAB often knows a device's address; Home Assistant its hardware id). For the rest, open the device and choose **Which one is it in the hub?**

Hearth talks only to the hub, on your network, never to the internet. The token is kept encrypted and never reaches the page. Devices that only work through their maker's cloud (many leak sensors, appliances and vacuums) show up once the hub has them.

## The home certificate

Each browser that opens Hearth by its name (`start.home`, not an address) checks whether it trusts the [home's certificate](trust.md), and Hearth notes the answer with its device: a closed padlock on the list for yes, an open one for not yet, with a link to the trust page. A device whose browser hasn't opened Hearth (a TV, a plug) can't say, and shows as unknown.

## Watching and alerts

**Watch it** on a device, or the bell on a service, and Hearth tells you when it stops: a device that's been offline, or a service that's been down, for three minutes, then again when it's back. Alerts go to the address in **Settings → Internet → Alerts** (an ntfy topic, Home Assistant…), the same as the family's. Until one is set, the page says so.

## Where the list comes from

- **AdGuard Home**, if it answers your network's DNS (on a GL.iNet router: **Applications → AdGuard Home**, with **Handle Client Requests** on). It knows every device that looks anything up, what the network calls it, and when it was last active.
- **Hearth itself:** every browser that opens Hearth gets its own random id (a cookie, not a sign-in). Hearth remembers where it was and whose page was open, so "opened Hearth as Sam" helps you tell whose it is.
- **The devices you've saved**, with their names and owners.
- **The devices themselves.** Hearth asks each one on the network what it is, and many say, often with the name you gave them in their own app (see below).

The device you're looking at the page on is marked **This device**.

## Telling devices apart

Each row shows what Hearth could find out, best first:

| Clue                 | Where it comes from                                                                                        | Example                             |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| **Its own name**     | The device, when asked (below)                                                                             | "Living Room display", Google Nest Hub |
| **The network's name** | Your router's DHCP list, through AdGuard Home                                                            | "Sams-iPhone"                       |
| **Its browser**      | A browser that opened Hearth on it                                                                         | iPhone · Safari                     |
| **Probably …**       | The sites it looks up most, in AdGuard Home's log                                                          | probably a Google Nest device       |

**Asking devices what they are.** Hearth asks each device on the network, by its private address, the questions these kinds of device answer:

| Answers                                                  | Which devices                                                     |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| **Google Cast**                                          | Nest speakers and displays, Chromecast and Google TV, many TVs     |
| **Bonjour** (mDNS)                                       | Apple devices, many cameras and printers, routers                  |
| **Roku, Sonos, Philips Hue, Shelly, WLED, Tasmota**      | Those, by their own device-info pages                             |
| **Its web page's title**                                 | Printers, cameras and routers with a page of their own, as a last clue |

It asks devices it hasn't asked before when you open the page (the rows fill in over a few seconds), asks again a few hours later if one didn't answer, and a month later if it did. **Ask them again** asks every device now. Only private addresses on your network are asked, read only, and Hearth never signs in to anything.

Some devices don't answer anything (many thermostats, smoke alarms and smart plugs). For those, **Probably …** from what they look up is the clue, and Hearth knows brands that live on a bigger company's servers: a Nest thermostat talks to Google more than to nest.com, but nest.com still says "a Google Nest device".

> [!TIP]
> Still not sure? Unplug it, or turn it off, and see which row stops being **active now**.

## New devices

**Devices → Setup → New devices** says what happens to a device Hearth hasn't seen before:

| Setting                                         | What happens                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Leave it for me to set up** (the default)     | It shows as **Not set up** until you say whose it is                                                           |
| **Save it as always allowed**                   | It's saved by itself as always allowed, named from what it says it is. One that's opened Hearth as someone is left for you, since it's probably theirs |
| **Networks where every device is always allowed** | Everything on these networks (a separate Wi-Fi for smart plugs and cameras, like `192.168.2.0/24`) is saved as always allowed, whatever the setting above says |

Devices saved this way are marked **Added by itself**; change them like any other. Hearth looks for new devices every two minutes, so this works without the page open.

## Connecting AdGuard Home

In **Devices → Setup → AdGuard Home**, give its address: its own page, usually the router's address and port 3000, like `http://192.168.1.1:3000`. Add a username and password only if it asks for them. Hearth checks it answers before saving. The password is stored encrypted. Hearth reads AdGuard Home's devices and query log, and writes only its own block of rules once the [internet controls](internet.md) are on.

## Setting up a device

Press a device to give it:

- **A name and what it is:** phone, tablet, TV, smart plug, and so on. Hearth suggests both from the clues above (the device's own name first, without serial numbers).
- **Whose it is**, or **Always allowed**. Always-allowed devices (smart plugs, TVs, cameras, printers, the NAS, the router) will never be stopped by the internet controls. A person's devices will follow that person's rules; a child's, the child's.
- **Its addresses**, and optionally its hardware (MAC) addresses from your router's device list.

An address belongs to one device at a time. When a saved device's address changes (a phone back from holiday, say), opening Hearth on it moves the address over, since Hearth knows the browser.

> [!TIP]
> Phones and tablets use a private Wi-Fi address by default, which normally stays the same on one network. If one of yours is set to a *rotating* address, set it to **Fixed** (iPhone: Settings → Wi-Fi → ⓘ → Private Wi-Fi Address) so it's always recognised.

## Behind a reverse proxy

Hearth tells devices apart by their address on the network. Behind DSM's reverse proxy (or another proxy on the same machine, or a container bridge), it reads the device's address from the `X-Forwarded-For` header. It trusts that header only from those proxies, so a device can't claim to be another. If your proxy runs on a different machine, add its address under `settings.network.trustedProxies` in `hearth.json` (Settings → Advanced).
