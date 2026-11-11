import { describe, expect, it } from "vitest";
import { HubError, hubSwitch, hubThings, hubVersion } from "./hubs";

/** A small openHAB: a Shelly plug with an address, and a leak sensor from a cloud binding. */
function openhab(calls: string[] = [], token = "oh-token") {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const auth = new Headers(init?.headers).get("authorization");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${init?.body ? ` ${init.body}` : ""}`);
    if (url.pathname === "/rest/") return Response.json({ runtimeInfo: { version: "5.1.4" } });
    if (auth !== `Bearer ${token}`) return new Response("", { status: 401 });
    if (url.pathname === "/rest/things")
      return Response.json([
        {
          UID: "shelly:shellyplug-s:abc",
          label: "Kettle plug",
          statusInfo: { status: "ONLINE" },
          configuration: { deviceIp: "192.168.1.70" },
          properties: { vendor: "Shelly", modelId: "SHPLG-S", macAddress: "AA-BB-CC-00-11-22" },
          channels: [{ linkedItems: ["Kettle_Power"] }, { linkedItems: ["Kettle_Watts"] }],
        },
        {
          UID: "dlink:leak:1",
          label: "Laundry leak sensor",
          statusInfo: { status: "ONLINE" },
          configuration: {},
          channels: [{ linkedItems: ["Laundry_Leak"] }],
        },
      ]);
    if (url.pathname === "/rest/items")
      return Response.json([
        { name: "Kettle_Power", label: "Power", type: "Switch", state: "ON" },
        {
          name: "Kettle_Watts",
          label: "Watts",
          type: "Number:Power",
          state: "1200 W",
          stateDescription: { readOnly: true },
        },
        { name: "Laundry_Leak", label: "Leak", type: "Contact", state: "CLOSED" },
      ]);
    if (url.pathname.startsWith("/rest/items/") && init?.method === "POST")
      return new Response(null, { status: 202 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

/** A small Home Assistant: one device with a moisture sensor and a switch. */
function homeAssistant(calls: string[] = []) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(
      `${init?.method ?? "GET"} ${url.pathname}${init?.body && !String(init.body).includes("template") ? ` ${init.body}` : ""}`,
    );
    if (new Headers(init?.headers).get("authorization") !== "Bearer ha-token")
      return new Response("", { status: 401 });
    if (url.pathname === "/api/config") return Response.json({ version: "2026.11.0" });
    if (url.pathname === "/api/template")
      return new Response(
        JSON.stringify([
          [
            "dev1",
            "binary_sensor.basement_leak",
            "Basement leak",
            "D-Link",
            "DCH-S162",
            [["mac", "aa:bb:cc:dd:ee:01"]],
          ],
          [
            "dev1",
            "switch.basement_siren",
            "Basement leak",
            "D-Link",
            "DCH-S162",
            [["mac", "aa:bb:cc:dd:ee:01"]],
          ],
        ]),
      );
    if (url.pathname === "/api/states")
      return Response.json([
        {
          entity_id: "binary_sensor.basement_leak",
          state: "off",
          attributes: { friendly_name: "Basement leak", device_class: "moisture" },
        },
        {
          entity_id: "switch.basement_siren",
          state: "off",
          attributes: { friendly_name: "Siren" },
        },
      ]);
    if (url.pathname.startsWith("/api/services/")) return Response.json([]);
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

describe("openHAB", () => {
  it("lists its things with their readings, and where each is", async () => {
    const things = await hubThings({
      kind: "openhab",
      url: "http://192.168.1.20:8080",
      token: "oh-token",
      fetch: openhab(),
    });
    expect(things[0]).toMatchObject({
      key: "openhab:shelly:shellyplug-s:abc",
      name: "Kettle plug",
      status: "ONLINE",
      hosts: ["192.168.1.70"],
      macs: ["aa:bb:cc:00:11:22"],
      maker: "Shelly",
      model: "SHPLG-S",
    });
    expect(things[0]?.points).toEqual([
      {
        id: "Kettle_Power",
        label: "Power",
        kind: "switch",
        state: "On",
        on: true,
        canControl: true,
      },
      { id: "Kettle_Watts", label: "Watts", kind: "number", state: "1200 W", canControl: false },
    ]);
    expect(things[1]?.points[0]).toMatchObject({ kind: "contact", state: "Closed" });
  });

  it("says when the token is wrong, and switches an item", async () => {
    const calls: string[] = [];
    const conn = {
      kind: "openhab" as const,
      url: "http://192.168.1.20:8080",
      fetch: openhab(calls),
    };
    await expect(hubVersion({ ...conn, token: "wrong" })).rejects.toThrow(/refused the token/);
    expect(await hubVersion({ ...conn, token: "oh-token" })).toBe("5.1.4");
    await hubSwitch({ ...conn, token: "oh-token" }, "Kettle_Power", false);
    expect(calls).toContain("POST /rest/items/Kettle_Power OFF");
    await expect(hubSwitch({ ...conn, token: "oh-token" }, "../rest", true)).rejects.toThrow(
      HubError,
    );
  });

  it("stays on the home network", async () => {
    await expect(
      hubThings({ kind: "openhab", url: "https://example.com", token: "x", fetch: openhab() }),
    ).rejects.toThrow(HubError);
  });
});

describe("Home Assistant", () => {
  it("groups entities by device, in words people use, and switches only what can be", async () => {
    const calls: string[] = [];
    const conn = {
      kind: "homeassistant" as const,
      url: "http://192.168.1.21:8123",
      token: "ha-token",
      fetch: homeAssistant(calls),
    };
    expect(await hubVersion(conn)).toBe("2026.11.0");
    const things = await hubThings(conn);
    expect(things).toHaveLength(1);
    expect(things[0]).toMatchObject({
      key: "homeassistant:dev1",
      name: "Basement leak",
      macs: ["aa:bb:cc:dd:ee:01"],
      model: "DCH-S162",
    });
    expect(things[0]?.points.map((p) => [p.label, p.state, p.canControl])).toEqual([
      ["Basement leak", "Dry", false],
      ["Siren", "Off", true],
    ]);
    await hubSwitch(conn, "switch.basement_siren", true);
    expect(calls).toContain(
      'POST /api/services/switch/turn_on {"entity_id":"switch.basement_siren"}',
    );
    await expect(hubSwitch(conn, "binary_sensor.basement_leak", true)).rejects.toThrow(
      "can't be switched",
    );
  });
});
