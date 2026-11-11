# Signing in

Everyone in the house picks their face on **Who's here?**; a PIN keeps a page theirs. On top of that, Hearth can sign people in through your home's own identity provider, and can open each person's page by itself on their own devices.

## Single sign-on

With an identity provider like [Pocket ID](https://pocket-id.org) or Authentik (any OpenID Connect provider), one account and passkey opens Hearth and the family's other apps. **Sign in with Pocket ID** appears on Who's here?; a linked person's page opens with no PIN and stays open on that device, and people in the admin group you name also get the admin's session.

**Setting it up (Pocket ID):**

1. Run Pocket ID at an `https://` address on your network (passkeys need HTTPS), like `https://id.home`.
2. In Pocket ID, **Administration → OIDC Clients → Add**: name it Hearth, make it a **public client** (Hearth uses PKCE, no secret needed), and give the **callback URL** Hearth shows in Settings → People → Single sign-on (`https://start.home/api/sso/callback`). On its **Access** tab, choose the family's group (a new client lets nobody in).
3. Optionally make a group for Hearth's admins (like `hearth_admins`) and put yourself in it.
4. In Hearth, **Settings → People → Single sign-on**: the provider's address, the client ID, and the admin group. Hearth checks the provider answers when you save.
5. **Link each person**: "Link Sam's account" opens the provider, and whoever signs in there is tied to Sam. Do it with them, or each person links their own page.

Hearth checks every sign-in itself: the token's signature against the provider's keys, that it's from your provider and for Hearth, that it hasn't expired, and that it belongs to the sign-in Hearth started. If Hearth reaches the provider with your own certificate authority, give Hearth its root (see [Install](install.md#https-with-your-own-certificate-authority)).

## Your own device opens your page

A device saved as someone's on the **Devices** page opens that person's page by itself: straight away if they have no PIN, or at their PIN pad if they do. On Who's here? it's first, marked **This device**. Choosing someone else, or **Guest**, stops it on that device.

This goes by the device's address and browser, which is fine for choosing whose start page shows, and why a PIN still guards it. For anything private, sign in with your passkey.
