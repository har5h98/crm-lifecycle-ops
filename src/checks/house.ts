import type { Finding } from "../core/model.js";
import type { Rulebook } from "../core/rules.js";
import { extractLinks } from "./links.js";

// Checks that only exist because a team told us its conventions (see src/core/rules.ts).
// With an empty rulebook, none of these fire.

const SUFFIX = "(s|ed|ing|ful|er|ers|ation|ations|ite|ites)?";
// [US, GB] stems. Ambiguous pairs (program/programme, check/cheque, tire/tyre) are left out on purpose.
const SPELLING: [string, string][] = [
  ["color", "colour"], ["favor", "favour"], ["flavor", "flavour"], ["honor", "honour"], ["neighbor", "neighbour"],
  ["behavior", "behaviour"], ["labor", "labour"], ["savory", "savoury"], ["center", "centre"], ["theater", "theatre"],
  ["fiber", "fibre"], ["organiz", "organis"], ["personaliz", "personalis"], ["customiz", "customis"], ["realiz", "realis"],
  ["recogniz", "recognis"], ["apologiz", "apologis"], ["prioritiz", "prioritis"], ["optimiz", "optimis"], ["analyz", "analys"],
  ["catalog", "catalogue"], ["traveled", "travelled"], ["traveling", "travelling"], ["canceled", "cancelled"],
  ["canceling", "cancelling"], ["jewelry", "jewellery"], ["gray", "grey"], ["defense", "defence"], ["aluminum", "aluminium"], ["pajamas", "pyjamas"], ["yogurt", "yoghurt"], ["donut", "doughnut"],
  ["mom", "mum"],
];

export function textOf(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const snippet = (text: string, i: number) => text.slice(Math.max(0, i - 25), i + 35).trim();
const TEMPLATE = /\{\{|\{%|\$\{/;

export function spellingVariant(text: string): { US: number; GB: number; examples: Record<"US" | "GB", string[]> } {
  const out = { US: 0, GB: 0, examples: { US: [] as string[], GB: [] as string[] } };
  for (const [us, gb] of SPELLING) {
    for (const [variant, stem] of [["US", us], ["GB", gb]] as const) {
      for (const m of text.matchAll(new RegExp(`\\b${stem}${stem.endsWith("z") || stem.endsWith("s") ? "(e|es|ed|ing|ation|ations|er|ers)" : SUFFIX}\\b`, "gi"))) {
        out[variant]++;
        if (out.examples[variant].length < 3) out.examples[variant].push(m[0]);
      }
    }
  }
  return out;
}

export function checkHouseRules(input: { html: string; subject?: string; from?: string }, rules: Rulebook): Finding[] {
  const findings: Finding[] = [];
  const text = textOf(input.html);
  const copy = `${input.subject ?? ""} ${text}`;

  // Brand names: right letters, wrong casing or spacing ("FernBrook market", "Fern brook").
  for (const name of rules.brand.names) {
    const loose = new RegExp(name.split("").map((c) => (c === " " ? "\\s*" : escape(c))).join("\\s*"), "gi");
    for (const m of copy.matchAll(loose)) {
      if (m[0] !== name) {
        findings.push({ checkId: "house.brand-name", severity: "warn", message: `Brand name written as "${m[0]}"; house style is "${name}".`, evidence: snippet(copy, m.index ?? 0) });
      }
    }
  }
  for (const t of rules.brand.terms) {
    for (const m of copy.matchAll(new RegExp(`\\b${escape(t.wrong)}\\b`, "gi"))) {
      findings.push({ checkId: "house.term", severity: "warn", message: `"${m[0]}" should be "${t.right}" in house style.`, evidence: snippet(copy, m.index ?? 0) });
    }
  }
  for (const phrase of rules.brand.bannedPhrases) {
    for (const m of copy.matchAll(new RegExp(`\\b${escape(phrase)}\\b`, "gi"))) {
      findings.push({ checkId: "house.banned-phrase", severity: "warn", message: `"${m[0]}" is on the team's do-not-use list.`, evidence: snippet(copy, m.index ?? 0) });
    }
  }

  // US vs GB spelling.
  if (rules.locale.spelling !== "any") {
    const wrong = rules.locale.spelling === "US" ? "GB" : "US";
    const v = spellingVariant(copy);
    if (v[wrong] > 0) {
      findings.push({
        checkId: "house.spelling-variant",
        severity: "warn",
        message: `${v[wrong]} ${wrong} spelling(s) in copy that should be ${rules.locale.spelling} English: ${v.examples[wrong].join(", ")}.`,
      });
    }
  }
  if (rules.locale.dateFormat !== "any") {
    for (const m of copy.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g)) {
      const [a, b] = [Number(m[1]), Number(m[2])];
      const wrongOrder = rules.locale.dateFormat === "MM/DD" ? a > 12 && b <= 12 : b > 12 && a <= 12;
      if (wrongOrder) {
        findings.push({ checkId: "house.date-format", severity: "warn", message: `"${m[0]}" reads as ${rules.locale.dateFormat === "MM/DD" ? "DD/MM" : "MM/DD"}; house format is ${rules.locale.dateFormat}.`, evidence: snippet(copy, m.index ?? 0) });
      }
    }
  }

  // Links: allowed domains and required UTMs.
  const links = extractLinks(input.html).filter((l) => /^https?:\/\//i.test(l.href) && !TEMPLATE.test(l.href.split("?")[0] ?? ""));
  for (const l of links) {
    let url: URL;
    try {
      url = new URL(l.href);
    } catch {
      continue;
    }
    const isUnsub = /unsubscrib|preference/i.test(l.href + l.text);
    if (rules.links.domains.length > 0 && !isUnsub) {
      const ok = rules.links.domains.some((d) => url.hostname === d || url.hostname.endsWith(`.${d}`));
      if (!ok) findings.push({ checkId: "house.off-domain-link", severity: "warn", message: `Link "${l.text || l.href}" goes to ${url.hostname}, which isn't one of the team's domains.`, evidence: l.href });
    }
    if (!isUnsub && Object.keys(rules.links.requiredUtm).length > 0) {
      for (const [param, pattern] of Object.entries(rules.links.requiredUtm)) {
        const value = url.searchParams.get(param);
        if (value === null) {
          findings.push({ checkId: "house.utm-missing", severity: "warn", message: `Link "${l.text || l.href}" is missing ${param}.`, evidence: l.href });
        } else if (pattern && !TEMPLATE.test(value) && !new RegExp(pattern).test(value)) {
          findings.push({ checkId: "house.utm-format", severity: "warn", message: `${param}="${value}" doesn't match the team convention (${pattern}).`, evidence: l.href });
        }
      }
    }
  }

  // Compliance text (postal address, legal lines).
  for (const required of rules.compliance.requiredText) {
    if (!text.toLowerCase().includes(required.toLowerCase())) {
      findings.push({ checkId: "house.required-text-missing", severity: "fail", message: `Required text is missing: "${required}".`, fix: "Add it to the footer (or the shared footer content block)." });
    }
  }

  // Sender.
  if (rules.senders.allowed.length > 0 && input.from) {
    const from = input.from.toLowerCase();
    if (!rules.senders.allowed.some((a) => from === a.toLowerCase() || from.endsWith(`@${a.toLowerCase()}`))) {
      findings.push({ checkId: "house.sender-not-allowed", severity: "fail", message: `Sender ${input.from} isn't on the team's approved list.` });
    }
  }

  // Subject style.
  if (input.subject) {
    const s = input.subject;
    if (s.length > rules.style.subjectMaxLength) {
      findings.push({ checkId: "house.subject-length", severity: "warn", message: `Subject is ${s.length} characters; house limit is ${rules.style.subjectMaxLength}.` });
    }
    if (rules.style.emojiInSubject !== "allowed" && /\p{Extended_Pictographic}/u.test(s)) {
      findings.push({ checkId: "house.subject-emoji", severity: rules.style.emojiInSubject === "block" ? "fail" : "warn", message: "Subject contains an emoji; house style doesn't use them." });
    }
    const bangs = (s.match(/!/g) ?? []).length;
    if (rules.style.maxExclamationsInSubject !== undefined && bangs > rules.style.maxExclamationsInSubject) {
      findings.push({ checkId: "house.subject-exclamations", severity: "info", message: `Subject has ${bangs} exclamation mark(s); house limit is ${rules.style.maxExclamationsInSubject}.` });
    }
  }

  // Personalization fallback convention.
  if (rules.personalization.greetingFallback) {
    const want = rules.personalization.greetingFallback;
    const src = `${input.subject ?? ""} ${input.html}`;
    for (const m of src.matchAll(/default:\s*['"]([^'"]*)['"]|defaultIfEmpty\s+\S+\s+"([^"]*)"/g)) {
      const value = m[1] ?? m[2] ?? "";
      if (/name/i.test(src.slice(Math.max(0, (m.index ?? 0) - 40), m.index)) && value !== want) {
        findings.push({ checkId: "house.fallback-style", severity: "info", message: `Name fallback is "${value}"; the team standard is "${want}".`, evidence: m[0] });
      }
    }
  }

  return findings;
}

export function checkCampaignName(name: string, rules: Rulebook): Finding[] {
  const pattern = rules.naming.campaignPattern;
  if (!pattern || new RegExp(pattern).test(name)) return [];
  return [{ checkId: "house.naming", severity: "info", message: `"${name}" doesn't follow the naming convention${rules.naming.example ? ` (e.g. ${rules.naming.example})` : ""}.` }];
}

/** Read a known-good email and propose rules, for /setup's "learn from an example" step. */
export function learnFromEmail(input: { html: string; subject?: string; from?: string }) {
  const text = textOf(input.html);
  const links = extractLinks(input.html).filter((l) => /^https?:\/\//i.test(l.href));
  const domains = new Map<string, number>();
  const utm = new Map<string, Set<string>>();
  for (const l of links) {
    try {
      const u = new URL(l.href.replace(/\{\{[\s\S]*?\}\}/g, "x"));
      const root = u.hostname.split(".").slice(-2).join(".");
      domains.set(root, (domains.get(root) ?? 0) + 1);
      for (const [k, v] of u.searchParams) if (k.startsWith("utm_")) utm.set(k, (utm.get(k) ?? new Set()).add(v));
    } catch {
      /* dynamic link */
    }
  }
  const fallbacks = [...`${input.subject ?? ""} ${input.html}`.matchAll(/default:\s*['"]([^'"]*)['"]|defaultIfEmpty\s+\S+\s+"([^"]*)"/g)].map((m) => m[1] ?? m[2] ?? "");
  const variant = spellingVariant(text);
  const tail = text.slice(-400);
  return {
    linkDomains: [...domains.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d),
    utmParams: Object.fromEntries([...utm.entries()].map(([k, v]) => [k, [...v]])),
    fromAddress: input.from,
    nameFallbacks: [...new Set(fallbacks)],
    spelling: variant.US > variant.GB ? "US" : variant.GB > variant.US ? "GB" : "unclear",
    spellingEvidence: variant.examples,
    subjectLength: input.subject?.length,
    subjectHasEmoji: input.subject ? /\p{Extended_Pictographic}/u.test(input.subject) : undefined,
    footerText: tail,
    addressLike: tail.match(/\d{1,6}\s+[A-Za-z0-9 .'-]+(Street|St|Avenue|Ave|Road|Rd|Blvd|Boulevard|Lane|Ln|Drive|Dr|Way|Suite|Ste)\b[^.]{0,80}/i)?.[0],
  };
}
