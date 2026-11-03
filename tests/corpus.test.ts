import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkEmail } from "../src/checks/email.js";
import type { Platform } from "../src/core/model.js";

const root = join(import.meta.dirname, "corpus");
const cases = readdirSync(root).filter((d) => existsSync(join(root, d, "case.json")));

describe("regression corpus", () => {
  for (const name of cases) {
    it(name, async () => {
      const spec = JSON.parse(readFileSync(join(root, name, "case.json"), "utf8")) as {
        platform: Platform; subject?: string; mustFind: string[]; mustNotFind: string[];
      };
      const html = readFileSync(join(root, name, "email.html"), "utf8");
      const report = await checkEmail({ html, platform: spec.platform, subject: spec.subject });
      const ids = new Set(report.findings.map((f) => f.checkId));
      for (const id of spec.mustFind) expect(ids, `expected ${id}`).toContain(id);
      for (const id of spec.mustNotFind) expect(ids, `did not expect ${id}`).not.toContain(id);
    });
  }
});
