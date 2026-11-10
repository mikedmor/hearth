# Hearth's public site

A tiny static site that Google needs before it lets a home's own Hearth use Google Calendar
without signing everyone out every 7 days (see [Calendar](../guides/calendar.md#setting-up-google-the-admin-once)):

- `index.html`: a home page for the app.
- `privacy.html`: its privacy policy.
- `terms.html`: its terms of service.
- `google/`: the return page. After "Sign in with Google" in Hearth, Google sends the browser
  here. The page sends it straight home, to Hearth's `/calendar`, which finishes the sign-in.

It has no tracking, cookies or outside scripts. The return page only ever forwards to an address
on a home network. The code it passes along is useless without Hearth's client secret and the
one-time PKCE key, which never leave the home server. Nothing at home is opened to the internet.

## From Hearth's own repository

If Hearth's code is on GitHub, the workflow `.github/workflows/public-site.yml` publishes this
folder, and only this folder, whenever it changes on `main`. In the repository's
**Settings → Pages**, set **Source** to **GitHub Actions**. The site is then at
`https://YOU.github.io/<repository>/`, for example `https://YOU.github.io/hearth/`, and the
return page is that address plus `google/`. A private repository needs a paid GitHub plan for
Pages. On a free plan, use a separate public repository, as below.

## Put it on GitHub Pages (free)

1. On GitHub, make a new **public** repository called `hearth-public`.
2. Upload everything in this folder to it (Add file → Upload files, or `git push`), so
   `index.html` is at the top.
3. In the repository's **Settings → Pages**, choose **Deploy from a branch**, branch `main`,
   folder `/ (root)`, and save.
4. After a minute, `https://YOU.github.io/hearth-public/` opens the home page, and
   `https://YOU.github.io/hearth-public/google/` says "Hearth's return page".

Any other static host works too. Just use its addresses in the steps below.

## Then, in Google Cloud

Under Google Auth Platform:

- **Branding:** a name and your email; **no logo** (a logo needs Google's review). Set the home
  page to `https://YOU.github.io/hearth-public/` and the privacy policy to
  `https://YOU.github.io/hearth-public/privacy.html`, and the terms of service to
  `https://YOU.github.io/hearth-public/terms.html`. Add the authorized domain
  `YOU.github.io`, then save.
- If Google asks you to prove the domain is yours: in
  [Search Console](https://search.google.com/search-console), add the URL-prefix property
  `https://YOU.github.io/hearth-public/`, choose **HTML tag**, and paste the tag into
  `index.html` where its comment says. Push, then press Verify.
- **Audience:** Publish app.
- **Clients:** create an OAuth client of type **Web application**, with the authorized redirect
  URI `https://YOU.github.io/hearth-public/google/` (exactly, with the final `/`).

Then, in Hearth: **Settings → Calendars → With a return page**. Paste the return page's address,
the client ID and its secret, and save.

## If Hearth isn't at a home-network name

The return page forwards to names like `start.home`, `*.local`, `*.lan`, or a private IP address.
If your Hearth is at a public-looking name (split DNS), add that name to `ALSO_ALLOWED` in
`google/index.html`.
