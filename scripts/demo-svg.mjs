#!/usr/bin/env node
// Builds docs/cli-demo.svg: an animated terminal that types `npx crm-lifecycle-ops check examples/emails`
// and reveals the REAL output of the built CLI line by line. Regenerate after changing checks or the
// samples: `npm run build && node scripts/demo-svg.mjs`. Animated SVG plays on GitHub and npm (no GIF tools needed).
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const COMMAND = "npx crm-lifecycle-ops check --demo";
const MAX_MSG = 62; // characters of each finding's message shown, to keep the demo readable
const run = spawnSync(process.execPath, ["dist/mcp-server.js", "check", "--demo"], { encoding: "utf8" });
if (!run.stdout) throw new Error(`CLI produced no output: ${run.stderr}`);

// Keep verdict lines, blocking problems and warnings; fold notes into a count per file.
const lines = [];
let notes = 0;
const flushNotes = () => {
  if (notes) lines.push({ kind: "dim", text: `    + ${notes} note${notes > 1 ? "s" : ""}` });
  notes = 0;
};
for (const raw of run.stdout.split("\n")) {
  if (!raw.trim()) continue;
  const finding = raw.match(/^ {2}([✗!i]) (\S+)\s+(.*)$/u);
  if (finding) {
    const [, icon, id, msg] = finding;
    if (icon === "i") {
      notes++;
      continue;
    }
    const short = msg.length > MAX_MSG ? `${msg.slice(0, MAX_MSG - 1).trimEnd()}…` : msg;
    lines.push({ kind: icon === "✗" ? "fail" : "warn", icon, id, text: short });
    continue;
  }
  flushNotes();
  const file = raw.match(/^(\S+\.html)\s+(✓ Ready|✗ Don't send|! Fix before sending)\s+\((\w+)\)$/u);
  if (file) lines.push({ kind: "file", file: file[1].replace(/^examples\/emails\//, ""), verdict: file[2], platform: file[3] });
  else lines.push({ kind: "summary", text: raw.trim() });
}
flushNotes();

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const C = {
  bg: "#16181D",
  bar: "#22252C",
  text: "#E6E7EA",
  dim: "#8A8F99",
  fail: "#F2545B",
  warn: "#F2C14E",
  ok: "#4CC38A",
  accent: "#F28B5E",
};
const LH = 22;
const TOP = 70;
const W = 1000;
const H = TOP + (lines.length + 2) * LH + 24;
const CYCLE = 16; // seconds per loop
const TYPE_END = 2.2;

// Each line fades in after the command is typed, holds, then everything fades before the loop restarts.
const fade = (i) => {
  const start = (TYPE_END + 0.5 + i * 0.28) / CYCLE;
  const shown = Math.min(start + 0.02, 0.93);
  return `<animate attributeName="opacity" values="0;0;1;1;0" keyTimes="0;${start.toFixed(3)};${shown.toFixed(3)};0.95;1" dur="${CYCLE}s" repeatCount="indefinite"/>`;
};

const rows = lines.map((l, i) => {
  const y = TOP + (i + 1.6) * LH;
  let body;
  if (l.kind === "file") {
    const color = l.verdict.startsWith("✓") ? C.ok : l.verdict.startsWith("✗") ? C.fail : C.warn;
    body = `<tspan fill="${C.text}" font-weight="700">${esc(l.file)}</tspan><tspan fill="${color}" font-weight="700">  ${esc(l.verdict)}</tspan><tspan fill="${C.dim}">  ${esc(l.platform)}</tspan>`;
  } else if (l.kind === "fail" || l.kind === "warn") {
    const color = l.kind === "fail" ? C.fail : C.warn;
    body = `<tspan fill="${color}">  ${esc(l.icon)} ${esc(l.id.padEnd(37))}</tspan><tspan fill="${C.text}">${esc(l.text)}</tspan>`;
  } else if (l.kind === "summary") {
    body = `<tspan fill="${C.accent}" font-weight="700">${esc(l.text)}</tspan>`;
  } else body = `<tspan fill="${C.dim}">${esc(l.text)}</tspan>`;
  return `<text x="24" y="${y}" opacity="0" xml:space="preserve">${body}${fade(i)}</text>`;
});

const typeChars = COMMAND.length + 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Terminal: ${esc(COMMAND)} checks four sample emails and finds a staging link, a missing name fallback and accessibility problems">
<title>crm-lifecycle-ops check, run on the sample emails</title>
<style>text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:14px}</style>
<rect width="${W}" height="${H}" rx="12" fill="${C.bg}"/>
<rect width="${W}" height="36" rx="12" fill="${C.bar}"/><rect y="24" width="${W}" height="12" fill="${C.bar}"/>
<circle cx="22" cy="18" r="6" fill="#F2545B"/><circle cx="42" cy="18" r="6" fill="#F2C14E"/><circle cx="62" cy="18" r="6" fill="#4CC38A"/>
<text x="${W / 2}" y="23" text-anchor="middle" fill="${C.dim}" style="font-size:12px">email-templates — zsh</text>
<clipPath id="type"><rect x="0" y="${TOP - 4}" height="${LH + 4}" width="0"><animate attributeName="width" values="0;0;${24 + typeChars * 8.6};${24 + typeChars * 8.6}" keyTimes="0;${(0.3 / CYCLE).toFixed(3)};${(TYPE_END / CYCLE).toFixed(3)};1" dur="${CYCLE}s" repeatCount="indefinite"/></rect></clipPath>
<text x="24" y="${TOP + 16}" clip-path="url(#type)" xml:space="preserve"><tspan fill="${C.ok}">$ </tspan><tspan fill="${C.text}">${esc(COMMAND)}</tspan></text>
${rows.join("\n")}
</svg>
`;
writeFileSync("docs/cli-demo.svg", svg);
console.log(`docs/cli-demo.svg: ${lines.length} lines, ${W}×${H}`);
