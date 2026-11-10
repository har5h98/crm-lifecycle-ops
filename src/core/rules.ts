import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Finding, Severity } from "./model.js";
import { homeDir } from "./snapshot.js";

// The house rulebook: what "right" means for THIS team. Built by /setup, edited by /house-rules,
// and shareable (the "Shared rules file" setting, CLO_RULES, points everyone at one file in a team drive or repo).
//
// Three layers:
//   1. Locked checks: wrong for everyone (no unsubscribe, broken syntax). Can't be turned off.
//   2. Default checks: sensible everywhere, but severity can be changed or turned off.
//   3. House checks: only run when the team has told us their convention.

export const LOCKED_CHECKS = new Set([
  "links.no-unsubscribe",
  "links.malformed",
  "links.broken",
  "personalization.syntax-error",
  "personalization.render-error",
  "personalization.unrendered-syntax",
]);

/** A pattern from the rulebook, compiled; undefined when it isn't a valid regular expression. */
export function safeRegex(pattern: string | undefined, flags = ""): RegExp | undefined {
  if (!pattern) return undefined;
  try {
    return new RegExp(pattern, flags);
  } catch {
    return undefined;
  }
}

// A pattern that can't compile would otherwise throw in the middle of a check, for everyone sharing the file.
const pattern = z.string().superRefine((value, ctx) => {
  if (!value) return;
  try {
    new RegExp(value);
  } catch (e) {
    ctx.addIssue({
      code: "custom",
      message: `"${value}" isn't a valid pattern (${(e as Error).message.replace(/^Invalid regular expression: /, "")})`,
    });
  }
});

const persona = z.object({ name: z.string(), attributes: z.record(z.string(), z.unknown()) });

export const RulebookSchema = z.object({
  version: z.literal(1).default(1),
  team: z.string().optional(),
  locale: z
    .object({
      language: z.string().default("en"),
      /** English spelling convention to enforce: US (color, organize) or GB (colour, organise). */
      spelling: z.enum(["US", "GB", "any"]).default("any"),
      dateFormat: z.enum(["MM/DD", "DD/MM", "any"]).default("any"),
    })
    .default({ language: "en", spelling: "any", dateFormat: "any" }),
  brand: z
    .object({
      /** Exact spellings, e.g. "Fernbrook Market". Wrong casing/spacing variants are flagged. */
      names: z.array(z.string()).default([]),
      /** Specific wrong → right replacements, e.g. {"wrong": "e-mail", "right": "email"}. */
      terms: z.array(z.object({ wrong: z.string(), right: z.string() })).default([]),
      bannedPhrases: z.array(z.string()).default([]),
      tone: z.string().optional(),
    })
    .default({ names: [], terms: [], bannedPhrases: [] }),
  links: z
    .object({
      /** Domains links may point to (subdomains included). Empty = don't check. */
      domains: z.array(z.string()).default([]),
      /** Required UTM params → regex the value must match ("" = must just be present). */
      requiredUtm: z.record(z.string(), pattern).default({}),
    })
    .default({ domains: [], requiredUtm: {} }),
  compliance: z
    .object({
      /** Text that must appear in every email, e.g. the postal address or a legal line. */
      requiredText: z.array(z.string()).default([]),
      regions: z.array(z.enum(["US", "CA", "EU", "UK", "AU", "other"])).default([]),
    })
    .default({ requiredText: [], regions: [] }),
  senders: z.object({ allowed: z.array(z.string()).default([]) }).default({ allowed: [] }),
  personalization: z
    .object({
      /** The team's standard fallback, e.g. "there" in "Hi there". */
      greetingFallback: z.string().optional(),
      /** The team's own test profiles, using their real attribute names (all synthetic values). */
      personas: z.array(persona).default([]),
    })
    .default({ personas: [] }),
  style: z
    .object({
      subjectMaxLength: z.number().int().positive().default(60),
      emojiInSubject: z.enum(["allowed", "warn", "block"]).default("allowed"),
      maxExclamationsInSubject: z.number().int().min(0).optional(),
    })
    .default({ subjectMaxLength: 60, emojiInSubject: "allowed" }),
  push: z
    .object({
      /** Characters before titles/bodies risk truncation on common lock screens (see channels.ts). */
      titleMax: z.number().int().positive().default(40),
      bodyMax: z.number().int().positive().default(120),
      /** The app's deep-link prefixes, e.g. "fernbrook://" or "https://www.fernbrook.example/app/". */
      deepLinkPrefixes: z.array(z.string()).default([]),
      requireDeepLink: z.boolean().default(false),
    })
    .default({ titleMax: 40, bodyMax: 120, deepLinkPrefixes: [], requireDeepLink: false }),
  sms: z
    .object({
      /** Most teams cap marketing texts at 1–2 segments; each extra segment is billed. */
      maxSegments: z.number().int().positive().default(2),
      /** Require opt-out wording ("Reply STOP to opt out") in the message itself. */
      requireOptOut: z.boolean().default(true),
      /** Require the brand name so recipients know who's texting. */
      requireBrandName: z.boolean().default(true),
    })
    .default({ maxSegments: 2, requireOptOut: true, requireBrandName: true }),
  inApp: z
    .object({
      bodyMax: z.number().int().positive().default(150),
      requireButton: z.boolean().default(false),
    })
    .default({ bodyMax: 150, requireButton: false }),
  contentCard: z
    .object({
      /** Braze: "one line of text is ideal" for the header, two to four lines for the message. */
      titleMax: z.number().int().positive().default(45),
      bodyMax: z.number().int().positive().default(150),
    })
    .default({ titleMax: 45, bodyMax: 150 }),
  /** Campaigns/journeys whose name matches this regex are transactional (no unsubscribe needed). */
  transactional: z.object({ namePattern: pattern.optional() }).default({}),
  naming: z.object({ campaignPattern: pattern.optional(), example: z.string().optional() }).default({}),
  /** Per-check severity overrides. Locked checks ignore these. */
  severity: z.record(z.string(), z.enum(["fail", "warn", "info", "off"])).default({}),
  /** "This is fine for us" decisions, each with a reason, so they're auditable later. */
  exceptions: z.array(z.object({ checkId: z.string(), match: z.string().optional(), reason: z.string(), addedAt: z.string() })).default([]),
});

export type Rulebook = z.infer<typeof RulebookSchema>;

export const DEFAULT_RULES: Rulebook = RulebookSchema.parse({});

/** Parses a rulebook; problems come back as one readable line each ("naming.campaignPattern: …"), not raw JSON. */
function parseRules(input: unknown): Rulebook {
  const result = RulebookSchema.safeParse(input);
  if (result.success) return result.data;
  throw new Error(result.error.issues.map((i) => `${i.path.join(".") || "rulebook"}: ${i.message}`).join("; "));
}

/** Where rules are read from, most specific first. */
export function rulesPath(): string {
  // The plugin setting arrives empty (or as an unfilled placeholder) when it isn't set.
  const shared = process.env.CLO_RULES?.trim();
  return shared && !shared.startsWith("${") ? shared : join(homeDir(), "rules.json");
}

export async function loadRules(path = rulesPath()): Promise<{ rules: Rulebook; path: string; exists: boolean }> {
  try {
    return { rules: parseRules(JSON.parse(await readFile(path, "utf8"))), path, exists: true };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { rules: DEFAULT_RULES, path, exists: false };
    throw new Error(`The rulebook at ${path} is invalid: ${(e as Error).message}`);
  }
}

export async function saveRules(input: unknown): Promise<{ rules: Rulebook; path: string }> {
  const rules = parseRules(input);
  for (const id of Object.keys(rules.severity)) {
    if (LOCKED_CHECKS.has(id)) delete rules.severity[id];
  }
  const path = rulesPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(rules, null, 2) + "\n");
  return { rules, path };
}

/** Apply severity overrides and exceptions. Returns kept findings and what was waived (shown, never hidden). */
export function applyRules(findings: Finding[], rules: Rulebook): { findings: Finding[]; waived: { finding: Finding; reason: string }[] } {
  const kept: Finding[] = [];
  const waived: { finding: Finding; reason: string }[] = [];
  for (const f of findings) {
    if (LOCKED_CHECKS.has(f.checkId)) {
      kept.push(f);
      continue;
    }
    const exception = rules.exceptions.find(
      (x) => x.checkId === f.checkId && (!x.match || `${f.message} ${f.evidence ?? ""}`.toLowerCase().includes(x.match.toLowerCase())),
    );
    if (exception) {
      waived.push({ finding: f, reason: exception.reason });
      continue;
    }
    const override = rules.severity[f.checkId];
    if (override === "off") {
      waived.push({ finding: f, reason: "turned off in house rules" });
      continue;
    }
    kept.push(override ? { ...f, severity: override as Severity } : f);
  }
  return { findings: kept, waived };
}
