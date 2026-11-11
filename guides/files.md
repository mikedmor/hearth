# Files

The **Files** page opens your NAS's shared folders from Hearth: browse them, download a file (or a whole folder as a zip), and set up a computer or phone to open a share by itself. It works with **Synology** NAS (DSM) for now.

Each person signs in with **their own NAS account**, and Hearth browses as them. The NAS's own permissions decide what each person sees, so Hearth never shows anyone more than the NAS would.

## Setting it up (the admin)

**Settings → General → Files**:

| Setting | What to put |
| --- | --- |
| **The NAS's address** | DSM's address, like `https://nas.home` or `http://192.168.1.20:5000`. **Check** makes sure it's a Synology NAS with File Station. |
| **Name for mapping shares** | The name devices use to open a share, like `nas.home` (so `\\nas.home\photos`). Empty: the address's own name. |

Then **Save settings**. **Settings → People → What people can use** decides which roles see Files: adults by default, children only when you tick them. Each person's NAS account needs File Station allowed (in DSM: **Control Panel → User → Applications**).

## Using it

1. Open **Files** in the menu.
2. **Connect your NAS account** with the account and password you use for DSM. If your account has two-step sign-in, Hearth asks for the code once and the NAS then trusts Hearth.
3. Open a share, then its folders. **Find in this folder** narrows a long list. Tap a file to download it; the arrow on a folder downloads it as a zip.
4. **Disconnect** forgets your NAS sign-in.

> **Files needs a PIN on your profile.** Anyone in the house can open a profile without one, so without a PIN anyone could open your files from your page. Set a PIN on your profile first. The admin can use Files too.

Your NAS password stays on Hearth's server, encrypted with the other secrets. It never appears in the page, and widgets can never use it.

## Opening a share on a device (Map)

Each share has a **Map** button with the steps for the device you're on:

| Device | How |
| --- | --- |
| **Windows** | **Download the script** and run it: the share shows up as a drive letter (you pick it) in File Explorer, every time you sign in. Or **This PC → Map network drive** and paste `\\nas.home\share`. |
| **Mac** | Finder → **Go → Connect to Server** (⌘K), and paste `smb://nas.home/share`. |
| **iPhone, iPad** | Files app → **Browse** → ⋯ → **Connect to Server**, paste `smb://nas.home/share`, and choose **Registered User**. |
| **Android** | No built-in way: a file manager with network shares (Material Files, CX File Explorer, Solid Explorer) does it. Add an SMB share with the NAS's name and the share. |

Each asks for your NAS account the first time. The device has to be on the home network, and the NAS's SMB service has to be on (DSM: **Control Panel → File Services → SMB**).

## When something's wrong

| What you see | What to do |
| --- | --- |
| "Files isn't set up yet" | The admin adds the NAS's address in Settings. |
| "Files needs a PIN on your profile" | Set a PIN on your profile. |
| "That NAS account or password isn't right" | Use your DSM account, not Hearth's admin password. |
| "isn't allowed to use File Station" | The NAS admin allows File Station for your account in DSM. |
| "The NAS has blocked this address" | Too many wrong passwords: wait, or unblock Hearth's address in DSM (**Control Panel → Security → Protection**). |
| "Hearth doesn't trust …'s certificate" | Use the NAS's `http://` address on port 5000, or give Hearth your root certificate (see [Install](install.md#https-with-your-own-certificate-authority)). |
