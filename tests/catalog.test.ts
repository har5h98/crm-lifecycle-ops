import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CHECKS } from "../src/checks/catalog.js";

it("every checkId the engine emits is documented in the catalog", () => {
  const dir = join(import.meta.dirname, "../src/checks");
  const emitted = new Set<string>();
  for (const file of readdirSync(dir)) {
    for (const m of readFileSync(join(dir, file), "utf8").matchAll(/checkId: "([\w.-]+)"/g)) emitted.add(m[1]!);
    for (const m of readFileSync(join(dir, file), "utf8").matchAll(/id: "(personalization\.[\w-]+)"/g)) emitted.add(m[1]!);
  }
  const documented = new Set(CHECKS.map((c) => c.id));
  for (const id of emitted) expect(documented, `${id} missing from catalog`).toContain(id);
});
