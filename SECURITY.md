# Security

Hearth is the front door to a home network. Anyone on that network can open it, so it's built on the assumption that visitors, guests and children will look at it, and that the keys it holds must never reach a browser.

## Supported versions

Hearth is before 1.0. Security fixes go into the newest version on `main`; update with `git pull` and rebuild (see [Updating](guides/install.md#updating)).

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: the repository's **Security** tab → **Report a vulnerability**. Don't open a public issue for a security problem.

Include what you found, how to reproduce it, and what an attacker could do with it. Never include real keys, passwords or a real household's data; a made-up example is always enough. You'll get an acknowledgement, and credit in the changelog if you'd like it.

## Security model

### Where Hearth runs

- **On a home network.** Hearth is a start page for the people on one network, behind your router. It isn't hardened for direct exposure to the internet, so don't port-forward it.
- **Anyone on the network may look.** Guests see only what's for everyone. A person's page opens without a password unless it has a PIN, so anything private belongs behind one.

### People and sign-in

- **The admin** signs in with a password, set on the first visit with a one-time code printed in Hearth's log. Only the admin changes the house's sections, links, widgets, people and settings.
- **People** open their own page by tapping their face, with a PIN if it has one. They can change only their own page, links, sections and calendars, unless the admin locked their page.
- **Passwords and PINs** are hashed with scrypt. Wrong guesses are slowed down, longer after each failure.
- **Sessions** are signed cookies: HttpOnly, SameSite=Strict, and `Secure` over HTTPS. A changed PIN ends that person's sessions.
- **Changes** need a header only Hearth's own page sends and an Origin from the same site, so other websites can't act for you.

### Data

- **Plain files in one data folder** on your disk. No copy goes anywhere else, and there's no telemetry.
- **Secrets encrypted at rest** with AES-256-GCM, using a key from `HEARTH_SECRET_KEY`: widget API keys, AI server keys, calendar passwords, calendar links and Google's sign-in tokens. A secret's value is never sent to a browser, never shown again once saved, and hidden from error messages.
- **Each person's calendar sign-ins are theirs:** they aren't in the admin's secrets list, the admin can't replace them, and widgets can't use them.
- **The page for visitors** never contains passwords, keys or tokens.

### Outbound connections

Hearth calls only the home network by default. Each connection below happens only once you set it up:

| Feature                       | Contacts                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| Status checks                 | The services on your home network that are on your page, every 30 seconds                    |
| Widgets                       | The addresses in each widget's sources; the internet only if the admin allows it              |
| Finding services              | Private addresses you scan, and addresses you type when adding a link                        |
| A site's own icon             | That site, when you ask for its icon                                                          |
| AI                            | The AI servers the admin adds                                                                 |
| Devices                       | AdGuard Home on your router, once the admin connects it; and each device on the network, by its private address: to ask what it is (Google Cast, Bonjour, Roku, Sonos, Hue, Shelly, WLED, Tasmota, its web page), to knock on a few usual ports to see whether it's on, and to check its ports for apps (a computer, server or console once a day by itself, any device when the admin asks). Read only |
| Network map                   | The router the admin connects (a GL.iNet router), on the home network only: it signs in with a challenge (a hash of the admin password, never the password itself) and reads who's connected to what, every minute. It changes nothing; the password is stored encrypted |
| Smart home                    | The openHAB or Home Assistant the admin connects, on the home network only: its devices, items and states every minute, with a token kept encrypted. A switch only when the admin presses it |
| AI computers                  | The AI servers the admin adds: their list of computers, for a server that shares several (with the same key as chat) |
| Pinball tables                | VPin Studio on a table on your network (port 8089, which has no password): its status, scores and players every minute. Its controls (start a table, mute, restart, shut down) only when the admin presses them |
| Internet controls             | AdGuard Home on your router: its query log (read every 20 seconds), its custom filtering rules (only Hearth's own marked lines) and one client per child named "Hearth: …" (safe search, blocked services), once the admin turns the controls on |
| Trust page                    | Nothing: it offers the certificate authority's public root, read from a read-only file. Hearth refuses a file with a private key in it |
| Guest pass                    | AdGuard Home on your router (its own marked rules, once the admin turns guest passes on). The welcome page and the house password are on Hearth; the password is stored encrypted, compared in constant time, and wrong tries slow that device down |
| Single sign-on                | The identity provider the admin sets up (usually on your network, like `https://id.home`): its discovery document, keys and token endpoint. Hearth verifies every ID token's signature, issuer, audience, expiry and nonce itself |
| Alerts                        | The web address the admin gives for alerts (an ntfy topic, Home Assistant…), which may be on the internet. Only the alert is sent: who asked and for what, or which watched device or service stopped or came back |
| Calendars                     | The CalDAV servers, calendar links and Google accounts people add; the internet only if the admin allows it for calendars |
| Files                         | The NAS the admin points Files at (Synology DSM), as each person, with their own NAS sign-in kept encrypted |
| Update check                  | `api.github.com`, once a day, only if the admin turns it on (or presses **Check now**): a plain request for Hearth's newest release that sends nothing about your home. Hearth never installs anything |
| Web search                    | Nothing: the browser goes to the search engine itself, so a search never passes through Hearth |

Every request Hearth makes is checked against those rules, again at every redirect, and limited in size and time. A password or token is never forwarded to a different site by a redirect.

### Pictures and pages

- **Uploads** are checked by their content, not their name, and SVG uploads are refused. Fetched SVG icons are served with a sandboxing policy.
- **A strict Content Security Policy** lets the page load only its own scripts, styles, pictures and connections. A person's own CSS can't load anything from elsewhere.
- **Links** on the page can only be `http` or `https`.

### The public site for Google sign-in

[`public-site/`](public-site/README.md) is static: no scripts from elsewhere, no cookies, no forms. Its return page forwards only to addresses on a home network. The code it passes along is useless without the client secret and the one-time PKCE key, which stay on the Hearth server.

## For contributors

- Never commit real keys, passwords, `.env` files, the data folder, or a real household's addresses and names. Tests and examples use made-up ones (`192.168.1.x`, `nas.home`, "Alex", "Sam").
- Never put a secret's value in a log, an error message or anything sent to a browser.
- A new outbound network call must go through the network guard, be opt-in, and be documented in the guide for its feature.
- Read this file before changing sign-in, sessions, the network guard, secrets or calendar accounts.
