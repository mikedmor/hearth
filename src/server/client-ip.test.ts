import { describe, expect, it } from "vitest";
import { clientIp, isTrustedProxy } from "./client-ip";

describe("who's asking", () => {
  it("believes X-Forwarded-For only from a trusted proxy", () => {
    // DSM's proxy, reaching the container through its bridge.
    expect(clientIp("172.17.0.1", "192.168.1.42")).toBe("192.168.1.42");
    expect(clientIp("::ffff:127.0.0.1", "192.168.1.42")).toBe("192.168.1.42");
    // A device talking to Hearth directly can't claim to be another.
    expect(clientIp("192.168.1.66", "192.168.1.42")).toBe("192.168.1.66");
    expect(clientIp("::ffff:192.168.1.66", undefined)).toBe("192.168.1.66");
    expect(clientIp(undefined, "192.168.1.42")).toBeUndefined();
  });

  it("takes the nearest untrusted hop, and the admin's own proxies", () => {
    expect(clientIp("172.17.0.1", "10.9.9.9, 192.168.1.42")).toBe("192.168.1.42");
    expect(clientIp("172.17.0.1", "192.168.1.42, 172.17.0.5")).toBe("192.168.1.42");
    expect(isTrustedProxy("192.168.1.20", ["192.168.1.20/32"])).toBe(true);
    expect(isTrustedProxy("192.168.1.21", ["192.168.1.20/32"])).toBe(false);
    expect(clientIp("192.168.1.20", "192.168.1.42", ["192.168.1.20"])).toBe("192.168.1.42");
  });
});
