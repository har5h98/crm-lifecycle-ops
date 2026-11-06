import { summarize, type CheckReport, type Finding, type Persona, type Platform } from "../core/model.js";
import { applyRules, DEFAULT_RULES, type Rulebook } from "../core/rules.js";
import { checkAccessibility, checkPreheader } from "./a11y.js";
import { checkHouseRules } from "./house.js";
import { checkHtml } from "./html.js";
import { checkLinks, checkLinksLive } from "./links.js";
import { ACCENTED_PERSONA, checkPersonalization } from "./personalization.js";

export interface EmailInput {
  html: string;
  platform: Platform;
  name?: string;
  subject?: string;
  preheader?: string;
  from?: string;
  /** Receipts, password resets and other transactional mail: no unsubscribe required. */
  transactional?: boolean;
  personas?: Persona[];
  /** Also request every static link over the network. Slower; off by default. */
  checkLinksLive?: boolean;
}

function checkSubject(subject: string | undefined, preheader: string | undefined): Finding[] {
  const findings: Finding[] = [];
  if (subject === undefined) return findings;
  if (subject.trim() === "") {
    findings.push({ checkId: "copy.empty-subject", severity: "fail", message: "Subject line is empty." });
  }
  if (preheader !== undefined && preheader.trim() === "") {
    findings.push({ checkId: "copy.empty-preheader", severity: "warn", message: "Preheader is set but empty." });
  }
  return findings;
}

/** The whole /check-email pass: HTML, links, personalization and subject line, in one report. */
export async function checkEmail(
  input: EmailInput,
  rules: Rulebook = DEFAULT_RULES,
): Promise<CheckReport & { variables: string[]; waived: { finding: Finding; reason: string }[] }> {
  const findings: Finding[] = [];
  const notVerified: string[] = [];

  // Personas: explicit ones win; otherwise the team's own (plus an empty profile, always); otherwise auto-generated.
  const personas = input.personas?.length
    ? input.personas
    : rules.personalization.personas.length
      ? [...rules.personalization.personas, { name: "Empty profile", attributes: {} }]
      : undefined;

  findings.push(...checkHtml(input.html));
  findings.push(...checkLinks(input.html, { transactional: input.transactional }));
  if (input.transactional)
    notVerified.push("Treated as transactional: the unsubscribe check was skipped. Transactional mail must not contain marketing content.");

  const p = await checkPersonalization(input.html, input.platform, personas);
  findings.push(...p.findings);
  notVerified.push(...p.notVerified);

  // Subject lines are templates too: run them through the same renderer.
  // Length and style are judged on what people see: the longest rendered subject, not the template.
  let subjectSeen: string | undefined;
  if (input.subject) {
    const s = await checkPersonalization(input.subject, input.platform, personas);
    findings.push(...s.findings.map((f) => ({ ...f, message: `Subject line: ${f.message}` })));
    subjectSeen = s.renders
      .filter((r) => r.persona !== ACCENTED_PERSONA && r.output !== null)
      .map((r) => r.output!.trim())
      .sort((a, b) => b.length - a.length)[0];
  }
  findings.push(...checkSubject(input.subject, input.preheader));
  findings.push(...checkAccessibility(input.html));
  findings.push(...checkPreheader(input.html, { subject: subjectSeen ?? input.subject, preheader: input.preheader }));
  findings.push(...checkHouseRules({ html: input.html, subject: input.subject, subjectSeen, from: input.from }, rules));

  if (input.checkLinksLive) {
    const live = await checkLinksLive(input.html);
    findings.push(...live.findings);
    notVerified.push(...live.notVerified);
  } else {
    notVerified.push("Links were checked for format and host only, not requested over the network (set checkLinksLive to test them).");
  }

  const applied = applyRules(findings, rules);
  const order = { fail: 0, warn: 1, info: 2 } as const;
  applied.findings.sort((a, b) => order[a.severity] - order[b.severity]);

  return {
    target: input.name ?? "Pasted email",
    platform: input.platform,
    findings: applied.findings,
    waived: applied.waived,
    notVerified: [...new Set(notVerified)],
    summary: summarize(applied.findings),
    variables: p.variables,
  };
}
