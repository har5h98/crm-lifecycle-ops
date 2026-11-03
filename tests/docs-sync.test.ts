import { readdirSync, readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The README and /start-here each carry the command table with a ✅/🧪 status. They drifted once;
// this keeps them, and the skills folder, telling the same story.
const statuses = (file: string) => {
  const rows = new Map<string, string>();
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\|.*?`(\/[a-z-]+)`\s*\|.*\|\s*(✅|🧪)\s*\|\s*$/u);
    if (m?.[1] && m[2]) rows.set(m[1], m[2]);
  }
  return rows;
};

it("README and /start-here list the same commands with the same status", () => {
  const readme = statuses("README.md");
  const startHere = statuses("skills/start-here/SKILL.md");
  expect(readme.size).toBeGreaterThan(0);
  expect(Object.fromEntries(startHere)).toEqual(Object.fromEntries(readme));
});

it("every skill folder appears in the command table", () => {
  const listed = [...statuses("README.md").keys()].map((c) => c.slice(1)).sort();
  const skills = readdirSync("skills").sort();
  expect(listed).toEqual(skills);
});
