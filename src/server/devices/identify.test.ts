import dgram from "node:dgram";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { identify, mdnsName, privateIp } from "./identify";

const name = (n: string) =>
  Buffer.concat([
    ...n.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])),
    Buffer.from([0]),
  ]);

/** A device that answers "what's your name?" the way Bonjour does: the question, then a PTR answer. */
function bonjour(answer: string | null, ignore = 0) {
  const sock = dgram.createSocket("udp4");
  let heard = 0;
  sock.on("message", (msg, from) => {
    if (++heard <= ignore) return;
    const question = msg.subarray(12);
    const header = Buffer.from(msg.subarray(0, 12));
    header.writeUInt16BE(0x8400, 2);
    header.writeUInt16BE(answer ? 1 : 0, 6);
    if (!answer) return sock.send(header, from.port, from.address);
    const rdata = name(answer);
    const rr = Buffer.alloc(10);
    rr.writeUInt16BE(12, 0); // PTR
    rr.writeUInt16BE(1, 2); // IN
    rr.writeUInt32BE(120, 4);
    rr.writeUInt16BE(rdata.length, 8);
    // The answer's name points back at the question's (DNS name compression).
    sock.send(
      Buffer.concat([header, question, Buffer.from([0xc0, 12]), rr, rdata]),
      from.port,
      from.address,
    );
  });
  return new Promise<{ port: number; close: () => void }>((resolve) =>
    sock.bind(0, "127.0.0.1", () =>
      resolve({ port: (sock.address() as AddressInfo).port, close: () => sock.close() }),
    ),
  );
}

const open: (() => void)[] = [];
afterEach(() => {
  for (const close of open.splice(0)) close();
});

describe("asking a device what it is", () => {
  it("reads the name a device gives itself over Bonjour", async () => {
    const dev = await bonjour("Nanit_N301ABC12345XY_0615S.local");
    open.push(dev.close);
    expect(await mdnsName("127.0.0.1", 1000, dev.port)).toBe("Nanit_N301ABC12345XY_0615S");
  });

  it("asks again when the first question is lost", async () => {
    const dev = await bonjour("Kitchen-speaker.local", 2);
    open.push(dev.close);
    expect(await mdnsName("127.0.0.1", 1000, dev.port)).toBe("Kitchen-speaker");
  });

  it("takes no answer, or silence, as nothing", async () => {
    const dev = await bonjour(null);
    open.push(dev.close);
    expect(await mdnsName("127.0.0.1", 1000, dev.port)).toBeNull();
    const quiet = dgram.createSocket("udp4");
    await new Promise<void>((r) => quiet.bind(0, "127.0.0.1", () => r()));
    open.push(() => quiet.close());
    expect(await mdnsName("127.0.0.1", 200, (quiet.address() as AddressInfo).port)).toBeNull();
  });

  it("only ever asks private addresses on the home network", async () => {
    expect(privateIp("192.168.1.20")).toBe("192.168.1.20");
    expect(privateIp("10.0.0.5")).toBe("10.0.0.5");
    expect(privateIp("172.20.1.2")).toBe("172.20.1.2");
    for (const ip of ["8.8.8.8", "127.0.0.1", "169.254.1.1", "172.32.0.1", "fd00::1", "192.168.1"])
      expect(privateIp(ip), ip).toBeNull();
    expect(await identify("8.8.8.8")).toBeNull();
  });
});
