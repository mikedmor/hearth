import { describe, expect, it } from "vitest";
import { parseXml } from "./net";

// biome-ignore lint/suspicious/noExplicitAny: reading parsed XML by path
type Any = any;

describe("parseXml", () => {
  it("reads an RSS feed into data", () => {
    const feed = parseXml(`<?xml version="1.0"?>
      <rss version="2.0"><channel><title>News &amp; more</title>
        <item><title><![CDATA[First <b>one</b>]]></title><link>http://a/1</link></item>
        <item><title>Second</title><link>http://a/2</link></item>
      </channel></rss>`) as Any;
    expect(feed.rss["@version"]).toBe("2.0");
    expect(feed.rss.channel.title).toBe("News & more");
    expect(feed.rss.channel.item).toHaveLength(2);
    expect(feed.rss.channel.item[0].title).toBe("First <b>one</b>");
    expect(feed.rss.channel.item[1].link).toBe("http://a/2");
  });

  it("reads Atom links from attributes", () => {
    const feed = parseXml(
      `<feed><entry><title>A</title><link href="http://a/1"/></entry></feed>`,
    ) as Any;
    expect(feed.feed.entry.link["@href"]).toBe("http://a/1");
  });
});
