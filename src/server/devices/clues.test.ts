import { describe, expect, it } from "vitest";
import {
  baseDomain,
  genericTitle,
  makerFrom,
  makerFromIdentity,
  notADevice,
  tidyName,
  topLookups,
  typeFrom,
} from "./clues";

describe("clues to what a device is", () => {
  it("counts the sites it looks up, busiest first, without the noise", () => {
    expect(baseDomain("e1234.dscb.akamaiedge.net")).toBe("akamaiedge.net");
    expect(baseDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(
      topLookups([
        "gateway.icloud.com",
        "p12-caldav.icloud.com",
        "time.apple.com",
        "api.apple.com",
        "1.8.168.192.in-addr.arpa",
        "nas.home",
        "wpad",
        "captive.apple.com",
      ]),
    ).toEqual(["icloud.com", "apple.com"]);
  });

  it("guesses the maker from what it talks to most", () => {
    expect(makerFrom(["icloud.com", "apple.com"])).toMatch(/Apple/);
    expect(makerFrom(["tuyaus.com"])).toMatch(/Tuya/);
    // A Windows PC that once looked at apple.com is still a Windows PC.
    expect(makerFrom(["windowsupdate.com", "bing.com", "apple.com"])).toMatch(/Windows/);
    expect(makerFrom(["example.org"])).toBeUndefined();
  });

  it("tells a brand from the big company whose servers it uses", () => {
    // A Nest device talks to Google most, but nest.com says more.
    expect(makerFrom(["googleusercontent.com", "google.com", "nest.com"])).toMatch(/Nest/);
    expect(makerFrom(["googleusercontent.com", "google.com"])).toMatch(/Android or Google/);
    expect(makerFrom(["amazonaws.com", "ring.com"])).toMatch(/Ring doorbell/);
    expect(makerFrom(["nanit.com", "amazonaws.com"])).toMatch(/Nanit/);
    // A phone with the baby camera's app is still a phone.
    expect(makerFrom(["icloud.com", "apple.com", "nanit.com"])).toMatch(/Apple/);
  });

  it("tidies a device's own name and guesses its type", () => {
    expect(tidyName("Nanit_N301ABC12345XY_0615S")).toBe("Nanit");
    expect(tidyName("Alexs-iPhone.local")).toBe("Alexs iPhone");
    expect(tidyName("Living Room display")).toBe("Living Room display");
    // A model number isn't a serial number.
    expect(tidyName("RT-AX58U")).toBe("RT AX58U");
    expect(tidyName("Chromecast-Ultra-0a1b2c3d4e5f")).toBe("Chromecast Ultra");
    expect(tidyName("")).toBeUndefined();
    expect(typeFrom("Google Nest Hub", "Living Room display")).toBe("speaker");
    expect(typeFrom("Chromecast")).toBe("tv");
    expect(typeFrom(undefined, "a Nanit baby camera")).toBe("camera");
    expect(typeFrom("Alexs iPhone")).toBe("phone");
    expect(typeFrom()).toBeUndefined();
    // Names the network gives them.
    expect(typeFrom("prusa-mk4s.lan")).toBe("printer3d");
    expect(typeFrom("Roborock-vacuum-a27.lan")).toBe("appliance");
    expect(typeFrom("GEMODULE37D9.lan")).toBe("appliance");
    expect(typeFrom("DCH-S162.lan")).toBe("sensor");
    expect(typeFrom("Sense-N327009715.lan")).toBe("sensor");
    expect(typeFrom("ecobee3")).toBe("thermostat");
    expect(makerFromIdentity({ model: "Google Nest Hub", maker: "Google" })).toBe(
      "Google Nest Hub",
    );
    expect(makerFromIdentity({ model: "Google Nest Hub", maker: "Google Inc." })).toBe(
      "Google Nest Hub",
    );
    expect(makerFromIdentity({ model: "One", maker: "Sonos" })).toBe("Sonos One");
    expect(makerFromIdentity({ name: "Nanit" })).toMatch(/Nanit/);
    expect(makerFromIdentity({ name: "Kitchen" })).toBeUndefined();
  });

  it("knows addresses that aren't devices", () => {
    expect(["127.0.0.1", "::1", "169.254.251.40", "fe80::1"].every(notADevice)).toBe(true);
    expect(notADevice("192.168.1.20")).toBe(false);
  });
});

describe("page titles as names", () => {
  it("skips titles that say nothing about the device", () => {
    for (const t of [
      "Hello! Welcome to Synology Web Station!",
      "Welcome to nginx!",
      "Login",
      "404 Not Found",
      "It works!",
    ])
      expect(genericTitle(t), t).toBe(true);
    for (const t of ["PrusaLink", "HP LaserJet Pro M404", "Living Room Hub"])
      expect(genericTitle(t), t).toBe(false);
  });
});
