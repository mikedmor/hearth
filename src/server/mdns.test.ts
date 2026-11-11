import { describe, expect, it } from "vitest";
import { aAnswer, aQuery, hostsOf, LocalNames } from "./mdns";
import { isLocalName, reachable, readFirstJpeg, setLocalResolver } from "./net";

/** An mDNS answer: the question echoed back, then one A record for the name. */
function answer(name: string, ip: string): Buffer {
  const q = aQuery(name);
  const header = Buffer.from(q.subarray(0, 12));
  header.writeUInt16BE(0x8400, 2); // a response, authoritative
  header.writeUInt16BE(1, 6); // one answer
  const question = q.subarray(12);
  const rr = Buffer.concat([
    Buffer.from([0xc0, 12]), // the name, pointing at the question's
    Buffer.from([0, 1, 0x80, 1, 0, 0, 0, 120, 0, 4]), // A, IN (cache flush), TTL 120, 4 bytes
    Buffer.from(ip.split(".").map(Number)),
  ]);
  return Buffer.concat([header, question, rr]);
}

describe(".local names", () => {
  it("knows which names only mDNS can find", () => {
    expect(isLocalName("motioneye.local")).toBe(true);
    expect(isLocalName("cam.garage.local.")).toBe(true);
    expect(isLocalName("start.home")).toBe(false);
    expect(isLocalName("localhost")).toBe(false);
    expect(isLocalName("xlocal")).toBe(false);
  });

  it("asks every address in a /24, and nothing bigger", () => {
    const hosts = hostsOf("192.168.1.0/24");
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("192.168.1.1");
    expect(hosts.at(-1)).toBe("192.168.1.254");
    expect(hostsOf("10.0.0.0/16")).toEqual([]);
  });

  it("reads the address from an answer, and only for the name asked", () => {
    const msg = answer("motioneye.local", "192.168.1.88");
    expect(aAnswer(msg, "motioneye.local")).toBe("192.168.1.88");
    expect(aAnswer(msg, "other.local")).toBeNull();
    expect(aAnswer(Buffer.from([1, 2, 3]), "motioneye.local")).toBeNull();
  });

  it("keeps an answer, and doesn't ask again straight away about a name nobody has", async () => {
    let now = 0;
    const asked: string[] = [];
    const names = new LocalNames({
      networks: () => ["192.168.1.0/24"],
      now: () => now,
      ask: async (name, ips) => {
        asked.push(name);
        expect(ips).toHaveLength(254);
        return name === "motioneye.local" ? "192.168.1.88" : null;
      },
    });
    expect(await names.resolve("MotionEye.local")).toBe("192.168.1.88");
    expect(await names.resolve("motioneye.local")).toBe("192.168.1.88");
    expect(await names.resolve("gone.local")).toBeNull();
    expect(await names.resolve("gone.local")).toBeNull();
    expect(asked).toEqual(["motioneye.local", "gone.local"]);
    now += 3 * 60_000; // past the wait for a missing name, not past a found one's
    await names.resolve("motioneye.local");
    await names.resolve("gone.local");
    expect(asked).toEqual(["motioneye.local", "gone.local", "gone.local"]);
  });

  it("before the network is known, asks nobody and remembers nothing", async () => {
    let networks: string[] = [];
    let asks = 0;
    const names = new LocalNames({
      networks: () => networks,
      ask: async () => {
        asks++;
        return "192.168.1.88";
      },
    });
    expect(await names.resolve("motioneye.local")).toBeNull();
    expect(asks).toBe(0);
    networks = ["192.168.1.0/24"];
    expect(await names.resolve("motioneye.local")).toBe("192.168.1.88");
  });

  it("points plain-http .local addresses at the device, and leaves the rest alone", async () => {
    setLocalResolver(async (host) => (host === "motioneye.local" ? "192.168.1.88" : null));
    try {
      expect(await reachable("http://motioneye.local:8081/x?y=1")).toBe(
        "http://192.168.1.88:8081/x?y=1",
      );
      expect(await reachable("https://motioneye.local/")).toBe("https://motioneye.local/");
      expect(await reachable("http://nas.home/")).toBe("http://nas.home/");
      expect(await reachable("http://unknown.local/")).toBe("http://unknown.local/");
    } finally {
      setLocalResolver(undefined);
    }
    expect(await reachable("http://motioneye.local/")).toBe("http://motioneye.local/");
  });
});

describe("a webcam's stream", () => {
  const jpeg = (n: number) => Buffer.from([0xff, 0xd8, 0xff, 0xe0, n, n, n, 0xff, 0xd9]);
  /** An MJPEG stream that never ends (as a webcam's doesn't), sent in small pieces. */
  const stream = () => {
    const part = (n: number) =>
      Buffer.concat([Buffer.from("--frame\r\nContent-Type: image/jpeg\r\n\r\n"), jpeg(n)]);
    const all = Buffer.concat([part(1), part(2)]);
    let i = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          c.enqueue(all.subarray(i, i + 5));
          i = (i + 5) % all.length;
        },
      }),
    );
  };

  it("gives its first whole picture and stops reading", async () => {
    expect(await readFirstJpeg(stream(), 1024)).toEqual(jpeg(1));
  });

  it("gives up when no picture comes in time", async () => {
    const noise = new Response(new ReadableStream({ pull: (c) => c.enqueue(new Uint8Array(64)) }));
    await expect(readFirstJpeg(noise, 1024)).rejects.toThrow(/No picture/);
  });
});
