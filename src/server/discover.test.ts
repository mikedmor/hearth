import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decodeTitle, parseTargets, recognise, scan, scanPorts } from "./discover";

describe("page titles", () => {
  it("read as people read them", () => {
    expect(decodeTitle("HomeNAS&nbsp;-&nbsp;Synology&nbsp;NAS")).toBe("HomeNAS - Synology NAS");
    expect(decodeTitle("A &amp; B &#8211; C &#x2014; D &bogus;")).toBe("A & B – C — D &bogus;");
  });
});

describe("scan targets", () => {
  it("expands private networks and refuses public ones", () => {
    const r = parseTargets("192.168.1.0/30, 10.0.0.5 nas.local 8.8.8.8 192.168.0.0/16");
    expect(r.hosts).toEqual(["192.168.1.1", "192.168.1.2", "10.0.0.5", "nas.local"]);
    expect(r.refused).toEqual(["8.8.8.8", "192.168.0.0/16"]);
  });

  it("caps a scan at 1024 hosts", () => {
    expect(parseTargets("10.0.0.0/22").hosts.length).toBe(1022);
    expect(parseTargets("10.0.0.0/22 10.1.0.0/22").hosts.length).toBe(1024);
  });

  it("knocks on the catalog's ports", () => {
    const ports = scanPorts();
    expect(ports).toContain(8989);
    expect(ports).toContain(32400);
  });
});

describe("recognising a service", () => {
  let base = "";
  const server = createServer((req, res) => {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end("<html><head><title>Sonarr</title></head></html>");
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
  });

  it("names it by its page title, even on an unusual port", async () => {
    const r = await recognise(base);
    expect(r.reachable).toBe(true);
    expect(r.app?.id).toBe("sonarr");
  });

  it("says when nothing answers", async () => {
    expect((await recognise("http://127.0.0.1:1")).reachable).toBe(false);
  });

  it("finds it in a scan", async () => {
    const port = Number(new URL(base).port);
    const found: string[] = [];
    await scan(
      ["127.0.0.1"],
      [port],
      () => {},
      (f) => found.push(f.app?.id ?? f.url),
    );
    expect(found).toEqual(["sonarr"]);
  });
});
