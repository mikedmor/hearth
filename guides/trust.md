# The trust page

If your home has its own certificate authority (step-ca, say) for names like `start.home` and `nas.home`, every device has to trust it once, or those sites show a warning instead of a padlock. **`start.home/trust`** walks each device through it: the steps for the device it's opened on, the download, the fingerprint to compare, a QR code to open it on a phone, and a live check that says when it's done.

## Setting it up

Give Hearth the certificate authority's **public root certificate**, read-only. Hearth looks for it in this order:

| Where                                    | When                                                       |
| ---------------------------------------- | ---------------------------------------------------------- |
| The file in `HEARTH_ROOT_CA`             | If you set that variable                                   |
| `/certs/root_ca.crt`                     | The mount in `compose.yaml` (the line is there, commented out) |
| `data/certs/root_ca.crt`                 | In Hearth's data folder                                    |

For step-ca, it's `root_ca.crt` in its `certs` folder. **Never give Hearth a private key**: Hearth refuses a file that holds one, and refuses a certificate that isn't a certificate authority's, and the trust page says why.

## What the page offers

| Device         | What it gets                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| iPhone, iPad   | A profile to install in Safari, then the one switch iOS also asks for (Certificate Trust Settings)             |
| Android        | The certificate and where to install it (Settings → CA certificate), and Firefox's extra switch               |
| Windows        | The certificate and the Install Certificate steps, or one PowerShell line                                     |
| Mac            | A profile, or the certificate and one Terminal line                                                           |
| Chromebook     | The certificate and Chrome's certificate manager                                                              |
| Linux          | The certificate, the commands for Debian/Ubuntu and Fedora, and each browser's own list                       |

The page picks the device it's opened on; the others are a tap away. The **fingerprint** (SHA-256) lets you check it's your home's certificate before trusting it. The **check** at the top tries the page's own `https://` address: a device that trusts the certificate gets through, one that doesn't is stopped by the browser, so the check turns green the moment it works.

## Moving to https by itself

When someone opens Hearth over plain `http://` by its name, the page quietly tries `https://`. A device that trusts the certificate moves there; one that doesn't sees a small banner leading to the trust page (dismissed for a month with ✕). Pages opened by an address (`http://192.168.1.20:8082`) are never moved. To turn the move off, set `settings.trust.redirect` to `false` (Settings → Advanced).

## Good to know

- **It's done once per device**, and lasts as long as the certificate authority's root (usually years).
- **Firefox** uses the system's certificates on Windows and Mac in recent versions; on Linux and Android it keeps its own, and the page says how.
- **"Network may be monitored"** on Android only means a certificate was added.
- **Opening the trust page needs no certificate**: it works over plain `http://`, and from the QR code on another screen.
