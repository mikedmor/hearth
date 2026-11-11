/**
 * Searching the web from the search box. The browser goes to the search engine itself, so Hearth
 * never calls it: nothing leaves the home through Hearth (CLAUDE.md: no outbound calls).
 */

export const ENGINE_IDS = [
  "google",
  "duckduckgo",
  "bing",
  "brave",
  "startpage",
  "ecosia",
  "kagi",
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** Each engine's results page; `%s` is the search. */
export const SEARCH_ENGINES: Record<EngineId, { name: string; url: string }> = {
  google: { name: "Google", url: "https://www.google.com/search?q=%s" },
  duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  bing: { name: "Bing", url: "https://www.bing.com/search?q=%s" },
  brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?query=%s" },
  ecosia: { name: "Ecosia", url: "https://www.ecosia.org/search?q=%s" },
  kagi: { name: "Kagi", url: "https://kagi.com/search?q=%s" },
};

/** The engine a page searches with. */
export interface WebSearch {
  name: string;
  /** An http(s) address with `%s` where the search goes. */
  url: string;
}

/** A search engine address of your own: http(s), with `%s` where the search goes. */
export const isSearchTemplate = (url: string): boolean =>
  /^https?:\/\/[^\s/]+\/?\S*$/i.test(url) && url.includes("%s");

export function webSearchUrl(engine: WebSearch, query: string): string {
  return engine.url.replaceAll("%s", encodeURIComponent(query.trim()));
}

/**
 * Which engine a page uses: the person's own choice, else the home's. Undefined when web search
 * is off (or the home's own engine has no address yet).
 */
export function pickWebSearch(
  home: { engine: EngineId | "custom" | "off"; name?: string; url?: string },
  mine: EngineId | "home" | "off",
): WebSearch | undefined {
  const id = mine === "home" ? home.engine : mine;
  if (id === "off") return undefined;
  if (id === "custom") {
    return home.url && isSearchTemplate(home.url)
      ? { name: home.name?.trim() || "the web", url: home.url }
      : undefined;
  }
  return SEARCH_ENGINES[id];
}
