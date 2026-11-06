// Monthly guide review: prints a Markdown checklist of every build/edit procedure, how long ago each
// platform's guide was checked against the vendor's docs, and the doc links to re-check. The monthly
// workflow files it as an issue. Exits 1 if any guide is past GUIDE_STALE_AFTER_DAYS.
import { GUIDES } from "../src/guides/index.js";
import { GUIDE_STALE_AFTER_DAYS, guideFreshness, TASKS, type TaskId } from "../src/guides/types.js";

let stale = false;
const out: string[] = [
  "Vendors change their UIs and editing rules without changing their APIs, so the weekly API drift check can't see it.",
  `Re-check each procedure against its docs, fix any step that moved, and update \`verifiedAt\` in \`src/guides/<platform>.ts\`. Guides older than ${GUIDE_STALE_AFTER_DAYS} days warn users in every plan.`,
  "",
];
for (const guide of Object.values(GUIDES)) {
  const f = guideFreshness(guide.verifiedAt);
  stale ||= f.stale;
  out.push(`## ${guide.platform}: verified ${f.verifiedAt} (${f.daysAgo} days ago)${f.stale ? " ⚠️ stale" : ""}`, "");
  for (const [id, proc] of Object.entries(guide.tasks)) {
    out.push(`- [ ] ${TASKS[id as TaskId]}: ${proc.docs.map((d, i) => `[doc ${i + 1}](${d})`).join(" · ")}`);
  }
  if (guide.unverified.length) out.push("", "Still unverified:", ...guide.unverified.map((u) => `- ${u}`));
  out.push("");
}
console.log(out.join("\n"));
process.exit(stale ? 1 : 0);
