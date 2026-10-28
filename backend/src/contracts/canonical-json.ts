/** JSON UTF-8 sin espacios; claves ordenadas por código y arrays en su orden original. */
export function canonicalJson(value: unknown): string {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, ordered(child)]));
    }
    return item;
  }
  return JSON.stringify(ordered(value));
}
