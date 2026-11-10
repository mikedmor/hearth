export function greeting(name: string | undefined, now = new Date()): string {
  const h = now.getHours();
  const part =
    h < 5
      ? "Good night"
      : h < 12
        ? "Good morning"
        : h < 17
          ? "Good afternoon"
          : h < 22
            ? "Good evening"
            : "Good night";
  return name ? `${part}, ${name}` : part;
}

export function monogram(name: string): string {
  const words = name.trim().split(/\s+/);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase();
}

export function bytes(n: number | undefined): string {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v.toFixed(u >= 3 ? 1 : 0)} ${units[u]}`;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "item"
  );
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}
