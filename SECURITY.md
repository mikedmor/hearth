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
| Calendars                     | The CalDAV servers, calendar links and Google accounts people add; the internet only if the admin allows it for calendars |

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
