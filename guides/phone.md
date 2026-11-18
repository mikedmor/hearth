# Hearth on your phone

Hearth installs like an app on Android (and on computers with Chrome or Edge). Installed, it opens full screen from its own icon, still shows the last page when you're away from home, and can bring the house's alerts to your phone as notifications.

**First:** open Hearth over **https**. Installing, the away-from-home copy and notifications all need it. That means the phone trusts your home's certificate: follow [the trust page](trust.md) once, then open `https://start.home`.

## Installing

| Browser | How |
| --- | --- |
| **Chrome on Android** | Hearth offers it under the top bar: **Install**. Or the browser's **⋮ → Install app** (some versions say **Add to home screen**) |
| **Samsung Internet** | The download icon in the address bar, or **≡ → Add page to → Home screen** |
| **Chrome or Edge on a computer** | The install icon at the right of the address bar |
| **Safari on iPhone and iPad** | **Share → Add to Home Screen** |

The app is named after your Hearth (Settings → General → title) and has shortcuts to **Calendar**, **Family** and **Devices**: press and hold its icon. On phones that show them, the icon carries a number while family requests are waiting.

Installed from Chrome, Hearth is a real app on Android: its own icon, in the app drawer, with its own notification settings. Some browsers (Brave, Firefox) only add a shortcut, with the browser's icon on Hearth's; install it from Chrome for the app.

"Not now" hides Hearth's offer for a month. Hearth updates by itself: there's nothing to update on the phone.

## Away from home

Each time you open Hearth at home, the phone keeps a copy of your page: its sections and links, the widgets' last readings, the status of each service, and your calendar. Away from home (on mobile data, or another Wi-Fi), Hearth opens with that copy and says so: **"Away from home. This is Hearth as of 3:40 pm."** Links to the home's services open once you're back on the home network.

Hearth always asks home first; the copy is only used when home can't be reached.

**What's never kept on the phone:**

| | Why |
| --- | --- |
| **A page with a PIN** | A locked page shouldn't open without its PIN. Open a page with a PIN, and the copy is cleared |
| **Anything while signed in as the admin** | Settings, devices and keys stay at home |

So it's for everyday pages (the family's, a guest's, a child's). Nothing's kept until a page has been opened at home over https.

## Notifications

Parents and the admin can get the house's alerts on their phone: a child asking for more time or a site, someone at the front door, a watched device or service going offline, and (if turned on) a child blocked from a new site.

1. On the phone, open **Family** (as a parent with your PIN, or as the admin).
2. At the bottom, **Notifications on this device → Turn on**, and allow notifications when the phone asks.
3. **Send a test** to check.

Tapping a notification opens the right page: Family for the family's alerts, Devices for the rest. They arrive away from home too.

**How they travel:** through the push service of the phone's browser (Google's, for Chrome on Android; Mozilla's, for Firefox). Each one is encrypted for that one phone, so the push service only sees that something was sent, never what. Turning notifications on for a device is your choice to use it; nothing is sent until you do. They're separate from the **alerts address** in Settings → Internet: use either, or both.

**In the Hearth app for Android** (coming soon) the same card turns them on, and they come through the app instead of a browser: through Google Play services by way of the app's push relay, or through a UnifiedPush app such as ntfy if you chose one in the app's **Server and lock** settings. They're still encrypted for that one phone; the relay and Google only pass on what they can't read. Running Hearth for yourself, you can use your own relay or Firebase key, or turn app notifications off (`HEARTH_PUSH_RELAY` and `HEARTH_FCM_CREDENTIALS` in [Installing](install.md#settings)).

**The admin** sees every device that gets alerts at the bottom of the Family page, and can take one off. A parent who stops being a parent stops getting them.

| Says | What to do |
| --- | --- |
| Needs https | Trust the home's certificate ([the trust page](trust.md)), then open `https://start.home` |
| Blocked | The browser was told no. Allow notifications for Hearth in the site's settings (the padlock by the address) |
| This browser can't | Use Chrome, Edge, Firefox or Samsung Internet. On iPhone, install Hearth to the home screen first |
