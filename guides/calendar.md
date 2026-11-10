# Calendar

Everyone in the house has their own calendar, on the **Calendar** page and in the **Calendar** widget. It's made of the calendars you add and the ones others share with you. Each person sees only their own, so pick who you are first; a guest sees none.

> [!IMPORTANT]
> A page without a PIN opens for anyone on the home network, and so does its calendar. Add a PIN in **Look → PIN** to keep yours to yourself. The Calendar page reminds you until you do.

## Looking at it

- **Month, Week or List**, with **Today** and the arrows to move. A phone starts on the list.
- **On the left** (a drawer on a phone): your calendars, the ones shared with you, and events people tagged you on. Untick one to hide it from your view only.
- **Press an empty day or hour** to add something there, or **+ New event**.
- **The Calendar widget** shows what's on today and the next few days on the start page (add it on the **Widgets** page; see [Widgets](widgets.md)).

## Adding a calendar

**Add a calendar** offers four kinds:

| Kind                         | What it is                                                                                 | Changes made in Hearth |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| **A new calendar in Hearth** | Kept in Hearth: a family calendar, a club's, the bins. Everyone starts with one of their own | Yes                   |
| **Google Calendar**          | Sign in with Google and pick which of your calendars to show                               | Yes                    |
| **A CalDAV account**         | Synology Calendar, iCloud, Nextcloud, Fastmail, Radicale and others                        | Yes                    |
| **A calendar link**          | An address ending in `.ics` (or `webcal://`): a school's, a team's, holidays               | No: read only          |

Passwords, calendar links and Google's sign-in are stored encrypted and never shown again, not even to the admin. Calendars on the internet need the admin to turn on **Settings → Calendars → Calendars can reach the internet** first.

### CalDAV

Give the server's address, your username and a password. Hearth finds your calendars from the server's own address; you don't need each calendar's. Tick the ones to show.

| Service           | Address                                   | Password                                                    |
| ----------------- | ----------------------------------------- | ----------------------------------------------------------- |
| Synology Calendar | `https://<your NAS>:5001/caldav/`         | Your DSM password                                           |
| iCloud            | `https://caldav.icloud.com/`              | An app-specific password from appleid.apple.com             |
| Nextcloud         | `https://<your server>/remote.php/dav/`   | An app password from Settings → Security                    |
| Fastmail          | `https://caldav.fastmail.com/`            | An app password from Settings → Privacy & Security          |

### Calendar links

Paste the address and give it a name. For a Google calendar you only want to read, open it in Google Calendar's settings and copy its **Secret address in iCal format**: no Google sign-in needed. Links are looked at again every hour (change it in the calendar's settings).

## Events

**+ New event**: what, when (or **All day**), whether it repeats (every day, week, month or year, until a day), which calendar it goes in, where, and notes. **Share with** tags people (see below).

Press an event to see it, **Edit** it or **Delete** it. For a repeating event in a Hearth calendar, choose **just this time** or **every time**. A few limits come from the other end:

- **Google:** a change to a repeating event changes that one time. Change the whole series in Google Calendar. Deleting offers this time or every time.
- **CalDAV:** a repeating event is changed in the calendar's own app; Hearth can delete the whole series.
- **Calendar links** can't be changed from Hearth.

Times are set in your device's time zone, and a repeating event keeps its time of day when the clocks change.

## Sharing

- **A whole calendar:** its settings button (on the left) → **Share with**, and pick people. They see it on their calendar and can turn it off for themselves. Turn on **They can add and change events** for a family calendar everyone fills in.
- **One event:** tag people with **Share with** in the event. They see that event, under **From** your name, even if the calendar isn't shared with them. They can't change it.

The admin can't see anyone's calendar. Taking someone out of Hearth removes their calendars and accounts too.

## Setting up Google (the admin, once)

Google needs a sign-in client of your own, set up once in Google Cloud. It's free. **Settings → Calendars** walks you through it, with two setups:

### With a return page (recommended)

Google won't publish a sign-in app without a public home page and privacy policy, and an unpublished app signs everyone out every 7 days. Hearth's [`public-site/`](../public-site/README.md) folder is that site, ready for GitHub Pages or any static host. It's a home page, a privacy policy, and a return page that sends the browser back home to Hearth after Google's sign-in. It only ever forwards to an address on a home network, and the code it passes along is useless without secrets that stay on your server. Nothing at home is opened to the internet.

1. Publish `public-site/` (its README has the steps), for example at `https://you.github.io/hearth/`.
2. In the [Google Cloud console](https://console.cloud.google.com/projectcreate), make a project and turn on the **Google Calendar API**.
3. **Google Auth Platform → Branding:** a name and your email, no logo (a logo needs Google's review), the home page, privacy policy and terms of service addresses, and the site's domain (`you.github.io`) as an authorized domain. If Google asks you to prove the domain is yours, use Search Console's HTML tag method; `public-site/index.html` has a spot for the tag.
4. **Audience → Publish app.**
5. **Clients → Create client → Web application**, with the authorized redirect URI set to the return page, like `https://you.github.io/hearth/google/` (with the final `/`).
6. In Hearth, **Settings → Calendars → With a return page**: the return page's address, the client ID and its secret. Make sure **Calendars can reach the internet** is on.

Then anyone can **Add a calendar → Google Calendar → Sign in with Google**. Google will call the app unverified, which is fine for a home's own app: choose **Advanced**, then continue. They come back to Hearth with their calendars listed.

### Without a website

Make a **Desktop app** client instead, leave the app in **Testing**, and add each person's Google address under **Audience → Test users**. When someone signs in, Google sends them to a `127.0.0.1` address that doesn't open; they copy that address back into Hearth. Google signs them out every 7 days; signing in again renews the same account and keeps its calendars.

## What Hearth sends where

- **Hearth's own calendars** stay in `calendar.json` in the data folder.
- **CalDAV and calendar links:** Hearth asks those servers for the events in the weeks you're looking at, and sends new or changed events to them.
- **Google:** the same, through Google's Calendar API, with the access you allowed (see your calendars and events; add and change events).
- Fetched events are kept in memory for a few minutes, so the page is quick; nothing is copied anywhere else.
