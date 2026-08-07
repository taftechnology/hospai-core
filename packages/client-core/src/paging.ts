export function accumulatePage<T>(
  prev: T[],
  page: { items: T[]; nextCursor: string | null },
  idOf: (t: T) => string,
): { items: T[]; nextCursor: string | null } {
  const seen = new Set(prev.map(idOf));
  const merged = [...prev];
  for (const item of page.items) {
    const id = idOf(item);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(item);
  }
  return { items: merged, nextCursor: page.nextCursor };
}
