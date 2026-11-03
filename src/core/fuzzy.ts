// "Did you mean…" for names typed from memory: "Welcom Series", "VIP custmers".

const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** Up to `max` names close to the query (typos, or a word of it), nearest first. */
export function closest(query: string, names: Iterable<string>, max = 3): string[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { name: string; score: number }[] = [];
  for (const name of new Set(names)) {
    const n = norm(name);
    const d = distance(q, n);
    // Allow roughly one typo per four characters; a shared whole word counts as close too.
    const words = q.split(" ").filter((w) => w.length > 2);
    const sharesWord = words.some((w) => n.split(" ").includes(w));
    if (d <= Math.max(2, Math.floor(q.length / 4)) || sharesWord) scored.push({ name, score: sharesWord ? Math.min(d, q.length) : d });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((x) => x.name);
}
