# Troubleshooting and FAQ

## Running Hearth

<details>
<summary><strong>The container won't start, or keeps restarting</strong></summary>

Look at its logs: `docker logs hearth` (or the container's **Log** tab in Container Manager). The usual causes are:

- **Permission denied on `/data`:** the container's user must own the data folder. Run `id` on the host and set `user:` in `compose.yaml` to that uid:gid, or `chown` the folder to it.
- **`set HEARTH_SECRET_KEY in .env`:** make the `.env` file next to `compose.yaml`, exactly as in the [install guide](install.md).
- **Port 8082 is taken:** map another host port in `compose.yaml`, such as `"8090:8082"`.
- **A line about `hearth.json`:** the file was edited and doesn't fit. The log says which part; fix it, and Hearth reloads it.
</details>

<details>
<summary><strong>I lost the setup code</strong></summary>

It's printed each time Hearth starts until the admin password is set. Restart the container and look at its log again.
</details>

<details>
<summary><strong>I forgot the admin password</strong></summary>

There's no reset by email, because Hearth never sends email. Stop the container, open `auth.json` in the data folder, delete the `"admin"` line (keep the rest: it holds people's PINs), and start it again. Hearth prints a new setup code, and the first visit sets a new password.
</details>

<details>
<summary><strong>I lost <code>HEARTH_SECRET_KEY</code></strong></summary>

Your sections, links, people, widgets and calendars are fine: they aren't encrypted. What's encrypted are widget and AI keys and calendar sign-ins. Set a new key, then enter the keys again under **Settings → Secrets** and **Settings → AI**, and reconnect calendar accounts.
</details>

## The page

<details>
<summary><strong>Some sections and links have no settings or edit button</strong></summary>

They're the house's, and only the admin changes them. Edit mode says so, with **Sign in as the admin**. Your own sections and links always have their buttons, unless your page is locked.
</details>

<details>
<summary><strong>Widgets and status dots only change when I reload</strong></summary>

The live connection isn't getting through your reverse proxy. Turn on WebSocket headers for Hearth's name (on Synology: the reverse proxy rule → **Custom Header → Create → WebSocket**). Until then the page asks every 30 seconds instead.
</details>

<details>
<summary><strong>A service I can open shows a red dot</strong></summary>

- **An `https` address with your own certificate authority:** Hearth doesn't trust it yet. Mount the public root certificate and set `NODE_EXTRA_CA_CERTS` (see [HTTPS with your own certificate authority](install.md#https-with-your-own-certificate-authority)), or point the link's check at the service's plain `http` address on the NAS (the link's **More options**).
- **A name only your computer knows** (in its hosts file, say): Hearth's server has to be able to find it too. `.local` names are the exception: Hearth asks the devices on your network for those itself, once it has found your network (a minute or two after it starts). Only plain `http` addresses work this way; for an `https` one, use the device's address or a `.home` name.
- **Anything that answers counts as up**, even a sign-in page. A red dot means no answer at all, twice in a row.
</details>

<details>
<summary><strong>Find services didn't find an app</strong></summary>

It only knocks on the ports each app usually uses. If yours runs on another port, add it with **+ Link**: typing its address still recognises it. If Hearth doesn't know the app at all, you can [teach it](finding-services.md#teaching-hearth-an-app).
</details>

## Calendar

<details>
<summary><strong>"Calendars can't reach the internet yet"</strong></summary>

Google, iCloud and most online calendars are on the internet, and Hearth doesn't call the internet until the admin allows it: **Settings → Calendars → Calendars can reach the internet**.
</details>

<details>
<summary><strong>A CalDAV server won't take my password</strong></summary>

Most services want an **app-specific password**, not your normal one: iCloud (appleid.apple.com), Nextcloud (Settings → Security), Fastmail (Settings → Privacy & Security). See [CalDAV](calendar.md#caldav).
</details>

<details>
<summary><strong>Google says <code>redirect_uri_mismatch</code>, or "Access blocked"</strong></summary>

The client in Google Cloud doesn't match Hearth's setup. **With a return page**, it must be a **Web application** client whose authorized redirect URI is exactly the return page, with the final `/`, and the same address must be in **Settings → Calendars**. **Without a website**, it must be a **Desktop app** client. See [Setting up Google](calendar.md#setting-up-google-the-admin-once).
</details>

<details>
<summary><strong>Google signs us out every week</strong></summary>

The app is still in **Testing** in Google Cloud, and Google ends a test app's sign-ins after 7 days. Publish it with a return page (see [Setting up Google](calendar.md#setting-up-google-the-admin-once)). Until then, signing in again from **Add a calendar → Google Calendar** renews the same account.
</details>

<details>
<summary><strong>An event shows at the wrong time</strong></summary>

Times are shown in the zone of the device you're looking on. If an event from a calendar link is off by a few hours, the calendar probably names a time zone without describing it. [Open an issue](https://github.com/mikedmor/hearth/issues) with the event's lines from the `.ics` file (made-up details are fine).
</details>

---

Still stuck? [Open an issue](https://github.com/mikedmor/hearth/issues) with what you did, what you expected, what happened, and the relevant lines from `docker logs hearth`. Leave out passwords, keys and anything private.
