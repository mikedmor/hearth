# Install

Hearth runs as a single Docker container that keeps everything in one data folder, as plain JSON files. Images for amd64 and arm64 are published on GitHub (`ghcr.io/mikedmor/hearth`), so it runs on a PC, a Raspberry Pi or a NAS.

| Image tag | What you get                                                        |
| --------- | ------------------------------------------------------------------- |
| `1`       | The latest 1.x release. Recommended: updates never break your setup |
| `1.0.0`   | Exactly that version, until you change it                           |
| `latest`  | The newest release, whatever its version                            |

Every install needs the same three things:

- **A data folder** mounted at `/data`. It holds the configuration, encrypted secrets, sign-in hashes, calendars and uploaded pictures.
- **`HEARTH_SECRET_KEY`**: a long random string, such as the output of `openssl rand -base64 32`. Widget keys, AI keys and calendar sign-ins are encrypted with it. **Keep a copy somewhere safe**, like a password manager. Without it you'd have to enter them again.
- **Port 8082**, where Hearth listens.

Then open `http://<host>:8082`. The first visit asks for a **setup code**, printed in the container's log, and then for the admin password you choose.

## Any Docker host (Docker Compose)

```sh
mkdir -p hearth/data && cd hearth
chmod 700 data
curl -fsSLO https://raw.githubusercontent.com/mikedmor/hearth/main/docker/compose.yaml
umask 077; printf "HEARTH_SECRET_KEY=%s\n" "$(openssl rand -base64 32)" > .env
id   # note your uid:gid for compose.yaml
```

Open `compose.yaml` and set `user:` to your uid:gid (it must own `./data`) and `TZ` to your time zone. Then:

```sh
docker compose up -d
docker logs hearth   # the setup code for the first visit
```

Or with plain `docker run`:

```sh
docker run -d --name hearth --restart unless-stopped --user "$(id -u):$(id -g)" \
  -p 8082:8082 --env-file .env -e TZ=America/New_York -v "$PWD/data:/data" ghcr.io/mikedmor/hearth:1
```

**Building from source** instead: clone the repository into `hearth/src`, and in `compose.yaml` swap the `image:` line for the `build:` lines below it (they're there, commented out). Then `docker compose up -d --build`.

## Synology NAS (DSM 7, Container Manager)

1. In **File Station**, create the folder `docker/hearth/data`.
2. **Find your user's ids:** enable SSH (Control Panel → Terminal & SNMP), sign in and run `id`. Note the `uid` and `gid` (often `1026` and `100`).
3. **Get the compose file and make the key** over SSH:

   ```sh
   cd /volume1/docker/hearth
   curl -fsSLO https://raw.githubusercontent.com/mikedmor/hearth/main/docker/compose.yaml
   umask 077; printf "HEARTH_SECRET_KEY=%s\n" "$(openssl rand -base64 32)" > .env
   ```

   Or download [compose.yaml](../docker/compose.yaml) and put it in `docker/hearth` with File Station, and put the key in `.env` beside it.

4. Edit `compose.yaml` (File Station → right-click → Open with Text Editor): set `user:` to your ids from step 2, and `TZ` to your time zone.
5. In **Container Manager → Project → Create**, choose the path `/docker/hearth`. It finds `compose.yaml`; start it.
6. Open the container's **Log** tab for the setup code, then open `http://NAS_IP:8082`.

Hearth's container is the only thing this touches. Nothing on the NAS is restarted.

## A name like `start.home`

A start page is best at an address everyone can remember. Two steps:

1. **Point the name at the machine.** In your router's DNS (or Pi-hole, AdGuard Home, or the router's hosts file), add a record so `start.home` points at the machine running Hearth. Any name on your network works.
2. **Send it to Hearth's port.** On Synology: **Control Panel → Login Portal → Advanced → Reverse Proxy → Create**. Source: protocol HTTP, hostname `start.home`, port 80. Destination: HTTP, `localhost`, port 8082. Then, under **Custom Header**, choose **Create → WebSocket**. Other reverse proxies (Caddy, nginx, Traefik) work the same way; pass WebSocket upgrades through.

> [!TIP]
> Without the WebSocket headers the page still works, but widgets and status dots only refresh every 30 seconds instead of live.

Short links come with the name: `start.home/plex` opens the link called `plex`.

### HTTPS with your own certificate authority

If your home has its own certificate authority (step-ca, say) and serves `https://start.home` from your reverse proxy, also let Hearth trust it. That way, status checks and widgets can reach other `https://*.home` services. In `compose.yaml`, mount the **public root certificate** read-only and point `NODE_EXTRA_CA_CERTS` at it (both lines are there, commented out). Never give Hearth a private key. The same file feeds [the trust page](trust.md) at `start.home/trust`.

## Settings

| Variable              | Default                                  | What it does                                                                                                       |
| --------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `HEARTH_SECRET_KEY`   | (a key made in `data/secret.key`)        | Encrypts secrets. Set it, so the key isn't in the data folder beside what it protects                               |
| `HEARTH_PORT`         | `8082`                                   | The port Hearth listens on                                                                                          |
| `HEARTH_HOST`         | `0.0.0.0`                                | The address it listens on                                                                                           |
| `HEARTH_DATA_DIR`     | `/data` (in the image), `./data` (dev)   | Where its files live                                                                                                |
| `TZ`                  | UTC                                      | The time zone for the server's clock                                                                                |
| `NODE_EXTRA_CA_CERTS` | none                                     | A root certificate to trust, for `https` services that use your own certificate authority                          |

Everything else is set in the page, under **Settings**, by the admin.

## Updating

**Settings → General → Updates** shows which version you're running. Turn on **Check for a new version once a day** (or press **Check now**) and Hearth asks GitHub for its newest release: a plain request that sends nothing about your home. When there's a newer one, the admin's **Settings** link gets a dot, and the Updates panel shows what's new and the steps below. Hearth never updates itself: it would need control of Docker for that, and a start page shouldn't have it.

| How you installed it          | To update                                                                  |
| ----------------------------- | -------------------------------------------------------------------------- |
| Docker Compose                | `docker compose pull && docker compose up -d` in Hearth's folder          |
| Synology Container Manager    | **Project → hearth → Action → Build** (it pulls the newest image)          |
| `docker run`                  | `docker pull ghcr.io/mikedmor/hearth:1`, then remove and run it again    |
| Built from source             | `git -C src pull && docker compose up -d --build`                         |

Watchtower and similar tools work too, if you'd rather updates happen by themselves.

Your data folder isn't touched by an update. When a new version changes the configuration's format, Hearth upgrades it the first time it starts and keeps the old file beside it as `hearth.json.v<old version>`.

## Backups

Everything is in the data folder, so back it up with the rest of your NAS:

| File                         | What it holds                                                               |
| ---------------------------- | --------------------------------------------------------------------------- |
| `hearth.json`                | Sections, links, people, widgets, themes and settings (no secrets)          |
| `calendar.json`              | Everyone's calendars, Hearth's own events and who they're shared with       |
| `secrets.json`               | Widget keys, AI keys and calendar sign-ins, encrypted with the secret key   |
| `auth.json`                  | The admin password and PINs, hashed                                         |
| `icons/`, `backgrounds/`     | Uploaded pictures                                                           |
| `catalog/`                   | Your own app entries (see [Finding services](finding-services.md))          |

Restore by putting the folder back and starting Hearth with the same `HEARTH_SECRET_KEY`. `hearth.json` can also be edited by hand (or in **Settings → Advanced**): Hearth notices the change and reloads it, and if the file breaks, it keeps using the last good version and logs what's wrong.
